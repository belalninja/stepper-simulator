import type { DriveSettings, ZAxisSettings } from '@/lib/configuration';
import { calculateDriveCurrent, calculateSingleCoilTorque, type MotorModel } from '@/lib/formulas';
import type { StepperDefinition } from '@/lib/stepper';
import { fitVelocityRange, stepperSeriesKey, type TorqueCurvePoint } from '@/lib/torque-curve';

/**
 * Z-axis physics: motors lifting, lowering and holding a load against gravity through a
 * trapezoidal leadscrew, a ball screw or a belt. Self-contained, so the Cartesian and CoreXY
 * calculations are untouched by anything here.
 *
 * Sign convention: torques are what the motor must apply in the "up" direction. Every motor is
 * assumed to carry an equal share of the load.
 */

const G_ACCEL = 9.80665; // m/s²
const STEEL_DENSITY = 7850; // kg/m³
/** Trapezoidal (ISO metric, 30°) thread: half-angle 15° */
const TRAPEZOIDAL_HALF_ANGLE = (15 * Math.PI) / 180;

/** Axial travel per motor revolution, mm */
export function zTravelPerMotorRev(z: ZAxisSettings): number {
	const outputTravel = z.drive === 'belt' ? z.pulleyTeeth * z.toothPitch : z.screwLead;
	return outputTravel / z.gearRatio;
}

/** Motor speed (rev/s) for a Z speed in mm/s */
export const zMotorRps = (z: ZAxisSettings, velocityMmPerS: number) => velocityMmPerS / zTravelPerMotorRev(z);

/** Trapezoidal screw mean diameter, m */
const meanDiameter = (z: ZAxisSettings) => Math.max(z.screwDiameter - z.screwPitch / 2, 0.1) / 1000;

/**
 * Torque on the output shaft (screw or pulley) to move an axial load F (N, positive = load pulls
 * down, like gravity) upward ('raise') or let it down ('lower'). A negative 'lower' torque means
 * the load drives the screw backwards and the motor has to hold it back.
 *
 * Trapezoidal screw, standard power-screw equations with thread half-angle α:
 *   raise = F·dm/2 · (L + π·μ·dm·secα) / (π·dm − μ·L·secα)
 *   lower = F·dm/2 · (π·μ·dm·secα − L) / (π·dm + μ·L·secα)
 * Ball screw: raise = F·L / (2π·η), lower = −F·L·η / (2π). Belt: ±F·r.
 */
export function zOutputTorque(z: ZAxisSettings, forceN: number, direction: 'raise' | 'lower'): number {
	if (z.drive === 'belt') {
		const r = (z.pulleyTeeth * z.toothPitch) / (2 * Math.PI) / 1000;
		return direction === 'raise' ? forceN * r : -forceN * r;
	}
	const L = z.screwLead / 1000;
	if (z.drive === 'ballscrew') {
		const eta = z.ballScrewEfficiency;
		return direction === 'raise' ? (forceN * L) / (2 * Math.PI * eta) : (-forceN * L * eta) / (2 * Math.PI);
	}
	const dm = meanDiameter(z);
	const muSec = z.nutFriction / Math.cos(TRAPEZOIDAL_HALF_ANGLE);
	if (direction === 'raise') {
		const denominator = Math.PI * dm - muSec * L;
		// Friction so high the screw locks even when driven: no finite torque lifts it
		if (denominator <= 0) return Number.POSITIVE_INFINITY;
		return ((forceN * dm) / 2) * ((L + Math.PI * muSec * dm) / denominator);
	}
	return ((forceN * dm) / 2) * ((Math.PI * muSec * dm - L) / (Math.PI * dm + muSec * L));
}

/** A trapezoidal screw holds its load unpowered when friction beats the thread slope: μ·secα > tan λ */
export function zIsSelfLocking(z: ZAxisSettings): boolean {
	if (z.drive !== 'leadscrew') return false;
	return zOutputTorque(z, 1, 'lower') >= 0;
}

/** Lifting efficiency of the drive: useful work over input work (belt taken as lossless) */
export function zLiftEfficiency(z: ZAxisSettings): number {
	if (z.drive === 'belt') return 1;
	const L = z.screwLead / 1000;
	return L / (2 * Math.PI * zOutputTorque(z, 1, 'raise'));
}

/** Screw inertia about its axis, kg·m²: solid steel cylinder of the mean diameter */
function screwInertia(z: ZAxisSettings): number {
	if (z.drive === 'belt' || z.screwLength <= 0) return 0;
	const radius = meanDiameter(z) / 2;
	const length = z.screwLength / 1000;
	return 0.5 * STEEL_DENSITY * Math.PI * radius ** 4 * length;
}

/**
 * Torque (N·m) each motor spends accelerating its own rotor and its screw at the Z acceleration.
 * Motor angular acceleration α = 2π·a / travel-per-rev; the screw turns G times slower, so its
 * inertia reflects to the motor divided by G².
 */
export function zInertiaTorque(z: ZAxisSettings, stepper: StepperDefinition): number {
	const alpha = (2 * Math.PI * z.acceleration) / zTravelPerMotorRev(z); // rad/s² (mm/s² over mm)
	const rotor = stepper.rotorInertia * 1e-7; // g·cm² -> kg·m²
	return (rotor + screwInertia(z) / (z.gearRatio * z.gearRatio)) * alpha;
}

/** Axial force on each motor's drive (N) for one load case */
function perMotorForce(z: ZAxisSettings, kase: 'liftAccel' | 'hold' | 'lowerDecel'): number {
	const m = z.liftedMass / 1000;
	const a = z.acceleration / 1000;
	const n = Math.max(1, Math.round(z.motorCount));
	switch (kase) {
		// Moving up and speeding up: gravity + acceleration + friction all push down
		case 'liftAccel':
			return (m * (G_ACCEL + a) + z.guideFrictionN) / n;
		case 'hold':
			return (m * G_ACCEL) / n;
		// Moving down and slowing down: gravity + deceleration push down, friction pushes up
		case 'lowerDecel':
			return Math.max(0, m * (G_ACCEL + a) - z.guideFrictionN) / n;
	}
}

/** Load torque (N·cm) each motor needs while lifting at full acceleration, without inertia. The red line. */
export function calculateZRequiredTorque(z: ZAxisSettings): number {
	return (zOutputTorque(z, perMotorForce(z, 'liftAccel'), 'raise') / z.gearRatio) * 100;
}

export type ZCases = {
	/** N·cm, lifting at full acceleration including rotor and screw inertia */
	lift: number;
	/** N·cm, lowering and braking to a stop at full deceleration */
	lower: number;
	/** N·cm the motor must hold with power on (0 when the screw self-locks) */
	holdPowered: number;
	/** N·cm the load applies to an unpowered motor (0 when the screw self-locks) */
	backDrive: number;
	/** N·cm, estimated unpowered detent torque of this motor */
	detent: number;
	/** N·cm the motor makes at standstill with the current drive settings */
	available: number;
	selfLocking: boolean;
	/** Will the axis stay put with the motors off? */
	holdsUnpowered: boolean;
};

export function calculateZCases(z: ZAxisSettings, stepper: StepperDefinition, driveSettings: DriveSettings): ZCases {
	const G = z.gearRatio;
	const inertia = zInertiaTorque(z, stepper);
	const lift = zOutputTorque(z, perMotorForce(z, 'liftAccel'), 'raise') / G + inertia;
	// Braking a descent: the motor holds the load back (or, on a self-locking screw, friction helps)
	const lowerLoad = zOutputTorque(z, perMotorForce(z, 'lowerDecel'), 'lower') / G;
	const lower = Math.max(0, -lowerLoad) + inertia;
	const staticBack = Math.max(0, -zOutputTorque(z, perMotorForce(z, 'hold'), 'lower') / G);
	const selfLocking = zIsSelfLocking(z);
	const detent = (stepper.torque / 100) * z.detentFraction;
	const available =
		driveSettings.torqueDerating *
		calculateSingleCoilTorque(
			driveSettings.motorModel,
			stepper.stepAngle,
			stepper.ratedCurrent,
			stepper.torque,
			stepper.inductance,
			stepper.resistance,
			driveSettings.inputVoltage,
			calculateDriveCurrent(driveSettings),
			0
		);
	return {
		lift: lift * 100,
		lower: lower * 100,
		holdPowered: staticBack * 100,
		backDrive: staticBack * 100,
		detent: detent * 100,
		available,
		selfLocking,
		holdsUnpowered: selfLocking || staticBack <= detent
	};
}

/**
 * Z counterpart of `buildTorqueCurve`: for each stepper, the torque it can deliver at the motor
 * speed a Z speed implies, minus what it spends accelerating its rotor and screw. Plotted against
 * `calculateZRequiredTorque`, like the Cartesian chart.
 */
export function buildZTorqueCurve({
	steppers,
	driveSettings,
	zAxisSettings,
	maxVelocity,
	stepSize,
	motorModelOverride
}: {
	steppers: StepperDefinition[];
	driveSettings: DriveSettings;
	zAxisSettings: ZAxisSettings;
	maxVelocity: number;
	stepSize: number;
	motorModelOverride?: MotorModel;
}): TorqueCurvePoint[] {
	const model = motorModelOverride ?? driveSettings.motorModel;
	const derating = driveSettings.torqueDerating > 0 ? driveSettings.torqueDerating : 1;
	const driveCurrent = calculateDriveCurrent(driveSettings);
	const inertia = steppers.map((stepper) => zInertiaTorque(zAxisSettings, stepper) * 100);
	const count = Math.floor((maxVelocity + stepSize) / stepSize);

	return Array.from({ length: count }, (_, i) => {
		const velocity = i * stepSize;
		const rps = zMotorRps(zAxisSettings, velocity);
		const point: TorqueCurvePoint = { velocity };
		steppers.forEach((stepper, k) => {
			const available =
				derating *
				calculateSingleCoilTorque(
					model,
					stepper.stepAngle,
					stepper.ratedCurrent,
					stepper.torque,
					stepper.inductance,
					stepper.resistance,
					driveSettings.inputVoltage,
					driveCurrent,
					rps
				);
			point[stepperSeriesKey(stepper)] = Math.max(available - inertia[k], 0);
		});
		return point;
	});
}

/** Z speeds are far lower than XY, so the range search is capped lower for finer sampling */
const Z_AUTO_VELOCITY_CAP = 1000;
const Z_DEFAULT_MAX_VELOCITY = 50;

export function autoMaxZVelocity(input: {
	steppers: StepperDefinition[];
	driveSettings: DriveSettings;
	zAxisSettings: ZAxisSettings;
	requiredTorque: number;
}): number {
	if (input.steppers.length === 0) return Z_DEFAULT_MAX_VELOCITY;
	return fitVelocityRange({
		keys: input.steppers.map(stepperSeriesKey),
		requiredTorque: input.requiredTorque,
		cap: Z_AUTO_VELOCITY_CAP,
		fallback: Z_DEFAULT_MAX_VELOCITY,
		build: (maxVelocity, stepSize) => buildZTorqueCurve({ ...input, maxVelocity, stepSize })
	});
}
