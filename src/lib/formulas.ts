import type { StepperDefinition } from '@/lib/stepper';
import type { DriveSettings, GantrySettings } from '@/lib/configuration';

const PI = Math.PI;
const SQRT2 = Math.SQRT2;

const EPS = 1e-9;

/**
 * Direction of Coulomb friction: the sign of the velocity, or of the acceleration when starting
 * from standstill. Returns 0 when the axis neither moves nor accelerates, so that floating-point
 * residue such as `Math.cos(Math.PI / 2) ≈ 6e-17` cannot switch on friction for an idle axis.
 */
const sgn = (v: number, fallback: number): number =>
	Math.abs(v) > EPS ? Math.sign(v) : Math.abs(fallback) > EPS ? Math.sign(fallback) : 0;

/** G = omega_motor / omega_pulley (> 1 is a speed reduction / torque multiplication) */
export const calculateGearRatio = (gantrySettings: GantrySettings) => gantrySettings.gearA / gantrySettings.gearB;

export const calculatePulleyCircumferenceMm = (gantrySettings: GantrySettings) =>
	gantrySettings.pulleyTeeth * gantrySettings.toothPitch;

export const calculatePulleyRadiusM = (gantrySettings: GantrySettings) =>
	calculatePulleyCircumferenceMm(gantrySettings) / (2 * PI * 1000);

/**
 * Peak phase current the driver is set to regulate. There is deliberately no supply-power cap
 * here: bus power (V x I_supply) is not winding copper loss, and the real supply limit, that the
 * bus cannot push more than V/R through a winding, is enforced by every motor model's voltage
 * constraint (at standstill each one reduces to min(I_drive, V/R)).
 */
export const calculateDriveCurrent = (driveSettings: DriveSettings) => driveSettings.maxDriveCurrent;

/** Highest current the bus voltage can push through one winding at standstill: min(I_drive, V/R) */
export const calculateStandstillCurrent = (driveSettings: DriveSettings, stepper: StepperDefinition) =>
	Math.min(driveSettings.maxDriveCurrent, driveSettings.inputVoltage / stepper.resistance);

export const calculateTorqueRotor = (gantrySettings: GantrySettings, stepper: StepperDefinition) =>
	(gantrySettings.acceleration / (gantrySettings.pulleyTeeth * gantrySettings.toothPitch)) *
	2 *
	PI *
	(stepper.rotorInertia / (1000 * 100 ** 2)) *
	100 *
	calculateGearRatio(gantrySettings);

/**
 * For sinusoidal microstepping where driveCurrent is peak phase current I_pk,
 * total 2-phase copper loss is I_pk^2 * R (or 2 * I_rms^2 * R).
 */
export const calculatePowerAtDriveCurrent = (driveCurrent: number, stepper: StepperDefinition) =>
	driveCurrent ** 2 * stepper.resistance;

/**
 * Closed-form worst-case shaft torque angle theta* = atan2(Q, P) in radians for a given stepper.
 * When stepper is omitted, computes the mass-only peak load angle theta_load* = atan2(Q0, P0).
 */
export function calculateCoreXYPeakTorqueAngleRad(
	gantrySettings: GantrySettings,
	stepper?: StepperDefinition | null
): number {
	const G = calculateGearRatio(gantrySettings);
	const r = calculatePulleyRadiusM(gantrySettings);
	const mh = gantrySettings.toolheadMass / 1000;
	const mb = gantrySettings.gantryBeamMass / 1000;
	const J = stepper ? stepper.rotorInertia * 1e-7 : 0; // g*cm^2 -> kg*m^2
	const mJ = (J * G * G) / (r * r);

	const P = 0.5 * mh + mJ;
	const Q = 0.5 * (mh + mb) + mJ;
	return Math.atan2(Q, P);
}

/**
 * Maps any move direction onto the equivalent Quadrant I angle. CoreXY is symmetric under
 * x -> -x and y -> -y (the two motors swap roles or reverse), so only |cos| and |sin| matter.
 */
export const foldToQuadrantI = (thetaRad: number): number =>
	Math.atan2(Math.abs(Math.sin(thetaRad)), Math.abs(Math.cos(thetaRad)));

/**
 * Ratio of the faster CoreXY motor's belt speed to the toolhead path speed at `thetaRad`:
 * |cos| + |sin|, from 1 (pure X or Y) up to sqrt(2) (45° diagonal).
 */
export const calculateCoreXYSpeedFactor = (thetaRad: number): number =>
	Math.abs(Math.cos(thetaRad)) + Math.abs(Math.sin(thetaRad));

/**
 * Resolves the active Quadrant I evaluation angle in [0, pi/2] for fixed-angle CoreXY modes
 */
export function resolveCoreXYAngleRad(gantrySettings: GantrySettings, stepper?: StepperDefinition | null): number {
	switch (gantrySettings.corexyDirectionMode) {
		case 'pureX':
			return 0;
		case 'pureY':
			return PI / 2;
		case 'diagonal45':
			return PI / 4;
		case 'custom':
			return foldToQuadrantI(((gantrySettings.customAngleDeg ?? 45) * PI) / 180);
		case 'peakTorque':
		case 'envelope':
		default:
			return calculateCoreXYPeakTorqueAngleRad(gantrySettings, stepper);
	}
}

/**
 * Reference load torque (N*cm, excluding rotor inertia) drawn as the red ReferenceLine on the chart.
 * - In 'cartesian' mode: (m * a + F_c) * r / G
 * - In 'corexy' mode: Load torque at the selected direction (or peak mass-load torque for 'envelope' / 'peakTorque')
 */
export const calculateRequiredTorque = (gantrySettings: GantrySettings): number => {
	if (gantrySettings.manualRequiredTorque !== null) return gantrySettings.manualRequiredTorque;

	const G = calculateGearRatio(gantrySettings);
	const r = calculatePulleyRadiusM(gantrySettings); // m
	const a = gantrySettings.acceleration / 1000; // m/s^2
	const Fc = gantrySettings.frictionForceN ?? 0; // N

	if (gantrySettings.kinematicsMode !== 'corexy') {
		const m = gantrySettings.toolheadAndYAxisMass / 1000; // kg
		return (((m * a + Fc) * r) / G) * 100;
	}

	const mh = gantrySettings.toolheadMass / 1000; // kg
	const mb = gantrySettings.gantryBeamMass / 1000; // kg
	const P0 = (r / G) * (0.5 * mh);
	const Q0 = (r / G) * (0.5 * (mh + mb));

	const thetaRad = resolveCoreXYAngleRad(gantrySettings, null);
	const c = Math.abs(Math.cos(thetaRad));
	const s = Math.abs(Math.sin(thetaRad));
	const frictionTerm = (r / G) * 0.5 * Fc * ((c > EPS ? 1 : 0) + (s > EPS ? 1 : 0));

	return (a * (P0 * c + Q0 * s) + frictionTerm) * 100;
};

export interface CoreXYMotorState {
	thetaRad: number;
	rpsA: number;
	rpsB: number;
	totalTorqueNcmA: number;
	totalTorqueNcmB: number;
	loadTorqueNcmA: number;
	loadTorqueNcmB: number;
	rotorTorqueNcmA: number;
	rotorTorqueNcmB: number;
}

/**
 * Evaluates exact CoreXY per-motor shaft speeds (RPS) and signed shaft torques (N*cm) at angle thetaRad
 */
export function evaluateCoreXYAtAngle(
	thetaRad: number,
	velocityMmPerS: number,
	gantrySettings: GantrySettings,
	stepper: StepperDefinition
): CoreXYMotorState {
	const G = calculateGearRatio(gantrySettings);
	const circumferenceMm = calculatePulleyCircumferenceMm(gantrySettings);
	const r = calculatePulleyRadiusM(gantrySettings); // m
	const v = velocityMmPerS / 1000; // m/s
	const a = gantrySettings.acceleration / 1000; // m/s^2
	const mh = gantrySettings.toolheadMass / 1000; // kg
	const mb = gantrySettings.gantryBeamMass / 1000; // kg
	const J = stepper.rotorInertia * 1e-7; // g*cm^2 -> kg*m^2
	const Fc = gantrySettings.frictionForceN ?? 0; // N

	const c = Math.cos(thetaRad);
	const s = Math.sin(thetaRad);
	const vx = v * c;
	const vy = v * s;
	const ax = a * c;
	const ay = a * s;

	const Fx = mh * ax + Fc * sgn(vx, ax);
	const Fy = (mh + mb) * ay + Fc * sgn(vy, ay);

	const FA = 0.5 * (Fx + Fy);
	const FB = 0.5 * (Fx - Fy);
	const vA = vx + vy;
	const vB = vx - vy;
	const aA = ax + ay;
	const aB = ax - ay;

	const k = G / r; // Belt linear to motor shaft angular factor (rad/m)
	const rpsA = (Math.abs(vA) * 1000 * G) / circumferenceMm;
	const rpsB = (Math.abs(vB) * 1000 * G) / circumferenceMm;

	const loadNmA = FA / k;
	const loadNmB = FB / k;
	const rotorNmA = J * aA * k;
	const rotorNmB = J * aB * k;

	return {
		thetaRad,
		rpsA,
		rpsB,
		totalTorqueNcmA: Math.abs(loadNmA + rotorNmA) * 100,
		totalTorqueNcmB: Math.abs(loadNmB + rotorNmB) * 100,
		loadTorqueNcmA: Math.abs(loadNmA) * 100,
		loadTorqueNcmB: Math.abs(loadNmB) * 100,
		rotorTorqueNcmA: Math.abs(rotorNmA) * 100,
		rotorTorqueNcmB: Math.abs(rotorNmB) * 100
	};
}

/**
 * Rotor-acceleration torque (N*cm) of the motor that has to work hardest, plus the CoreXY move
 * angle it was evaluated at (null in Cartesian mode).
 * - Cartesian: J * a * G / r.
 * - CoreXY: motor A at the active direction, J * a * (cos + sin) * G / r. In envelope mode every
 *   direction is checked, so this reports the 45° maximum (sqrt(2) times the Cartesian value).
 */
export function calculateRotorTorqueForMode(
	gantrySettings: GantrySettings,
	stepper: StepperDefinition
): { torqueNcm: number; thetaRad: number | null } {
	if (gantrySettings.kinematicsMode !== 'corexy') {
		return { torqueNcm: calculateTorqueRotor(gantrySettings, stepper), thetaRad: null };
	}
	const thetaRad =
		gantrySettings.corexyDirectionMode === 'envelope' ? PI / 4 : resolveCoreXYAngleRad(gantrySettings, stepper);
	return { torqueNcm: evaluateCoreXYAtAngle(thetaRad, 0, gantrySettings, stepper).rotorTorqueNcmA, thetaRad };
}

export type MotorModel = 'classic' | 'spreadCycle' | 'fieldWeakening';

export function calculateSingleCoilTorque(
	model: MotorModel,
	stepAngle: number,
	ratedCurrent: number,
	torque: number,
	inductance: number,
	resistance: number,
	inputVoltage: number,
	driveCurrent: number,
	rotationsPerSecond: number
) {
	const impl =
		model === 'classic'
			? calculateSingleCoilTorqueClassic
			: model === 'spreadCycle'
				? calculateSingleCoilTorqueSpreadCycle
				: calculateSingleCoilTorqueFieldWeakening;
	return impl(
		stepAngle,
		ratedCurrent,
		torque,
		inductance,
		resistance,
		inputVoltage,
		driveCurrent,
		rotationsPerSecond
	);
}

// Naive model: treats back-EMF as a simple voltage subtracted from the bus and
// impedance as a linear sum. Approximates a fixed-zero-lead-angle chopper driver
// (e.g. DRV8825). Produces a hard torque cliff at V_bus = V_bemf_peak.
export function calculateSingleCoilTorqueClassic(
	stepAngle: number,
	ratedCurrent: number,
	torque: number,
	inductance: number,
	resistance: number,
	inputVoltage: number,
	driveCurrent: number,
	rotationsPerSecond: number
) {
	const fCoil = (rotationsPerSecond * (360 / stepAngle)) / 4;
	const xCoil = (2 * PI * fCoil * inductance) / 1000;
	const zCoil = xCoil + resistance;
	const vGen = 2 * PI * rotationsPerSecond * (torque / (100 * SQRT2) / ratedCurrent);
	const vAvail = inputVoltage > vGen ? inputVoltage - vGen : 0;
	const iAvail = vAvail / zCoil;
	const iActual = iAvail > driveCurrent ? driveCurrent : iAvail;
	const torquePercent = iActual / ratedCurrent;
	const t1Coil = (torquePercent * torque) / (100 * SQRT2);

	return t1Coil * 100;
}

// Current-regulated chopper model. Phasor-accurate voltage constraint, but the
// driver has no mechanism to command d-axis current (no phase advance / no
// field weakening). Matches SpreadCycle behavior on TMC2xxx-class chips:
// torque is full until the voltage circle can no longer contain
// (i_d=0, i_q=I_drive); past that point torque falls off smoothly as the
// achievable i_q collapses, hitting zero near V_bus = V_bemf_peak.
export function calculateSingleCoilTorqueSpreadCycle(
	stepAngle: number,
	ratedCurrent: number,
	torque: number,
	inductance: number,
	resistance: number,
	inputVoltage: number,
	driveCurrent: number,
	rotationsPerSecond: number
) {
	const polePairs = 360 / (4 * stepAngle);
	const Kt = torque / (100 * SQRT2) / ratedCurrent;
	const psi = Kt / polePairs;
	const L = inductance / 1000;
	const R = resistance;
	const omegaElec = 2 * PI * polePairs * rotationsPerSecond;
	const vMax = inputVoltage;
	const iMax = driveCurrent;

	const vSqAtIMax = (omegaElec * L * iMax) ** 2 + (R * iMax + omegaElec * psi) ** 2;
	if (vSqAtIMax <= vMax * vMax) {
		return Kt * iMax * 100;
	}

	// Voltage-limited on i_d = 0 line. Solve |V|² = V_max² for max i_q:
	//   (ω²L² + R²)·i_q² + 2·R·ω·ψ·i_q + (ω²·ψ² − V_max²) = 0
	const a = omegaElec * omegaElec * L * L + R * R;
	const halfB = R * omegaElec * psi;
	const cTerm = omegaElec * omegaElec * psi * psi - vMax * vMax;
	const disc = halfB * halfB - a * cTerm;
	if (disc < 0) return 0;
	const iQ = (-halfB + Math.sqrt(disc)) / a;
	if (iQ <= 0) return 0;
	return Kt * Math.min(iQ, iMax) * 100;
}

/**
 * Largest i_q in the intersection of the current disc |i| <= iMax (centred on the origin) and the
 * voltage disc |i - (cd, cq)| <= rV, or null when the two do not overlap.
 *
 * Maximising a linear function over the intersection of two discs is a convex problem, so the
 * optimum is the top of one disc (if it lies inside the other) or an intersection point of the two
 * circles. Checking those four candidates gives the exact answer with no iteration.
 */
export function maxIqInCurrentAndVoltageDiscs(iMax: number, cd: number, cq: number, rV: number): number | null {
	const tol = 1e-12 * Math.max(1, iMax * iMax, rV * rV);
	const feasible = (d: number, q: number) =>
		d * d + q * q <= iMax * iMax + tol && (d - cd) ** 2 + (q - cq) ** 2 <= rV * rV + tol;

	const candidates: [number, number][] = [
		[0, iMax],
		[cd, cq + rV]
	];
	const D = Math.hypot(cd, cq);
	if (D > 0 && D <= iMax + rV && D >= Math.abs(iMax - rV)) {
		const a = (iMax * iMax - rV * rV + D * D) / (2 * D);
		const h = Math.sqrt(Math.max(0, iMax * iMax - a * a));
		const ux = cd / D;
		const uy = cq / D;
		candidates.push([a * ux - h * uy, a * uy + h * ux], [a * ux + h * uy, a * uy - h * ux]);
	}

	let best: number | null = null;
	for (const [d, q] of candidates) {
		if (feasible(d, q) && (best === null || q > best)) best = q;
	}
	return best;
}

// Upper-bound torque curve for a 2-phase hybrid stepper on a TMC4671
// FOC servo. FOC2 mode bypasses Clarke/iClarke, driving each coil from a
// dedicated full H-bridge. Peak U_x = V_bus with no SVPWM sqrt(3) boost,
// since SVPWM applies only to 3-phase drives.
// Treated as a non-salient PMSM with a current circle (|i_dq| <= I_drive) and
// a voltage circle (|u_dq| <= V_bus) matching the iPark default circular
// limiter. The steady-state voltage equation, in complex form with
// i = i_d + j*i_q, is v = (R + j*w*L)*i + j*w*psi, so |v| <= V_bus is the disc
//   |i - c| <= V_bus / sqrt(R^2 + w^2 L^2),
//   c = (-w^2 L psi, -R w psi) / (R^2 + w^2 L^2).
// Winding resistance is kept: for steppers w*L is comparable to R around base
// speed, and dropping R overstates torque by ~8% there. At standstill the disc
// becomes |i| <= V_bus / R, so torque is limited to Kt * min(I_drive, V_bus/R).
// Assumes the optimal i_d (the exact max-i_q point of both constraints). The
// TMC4671 itself does not schedule i_d. It regulates to a PID_FLUX_TARGET
// parameter, so this curve is the ceiling a well-tuned external scheduler
// could reach. Fixed flux-target tunings fall below it off the design speed.
export function calculateSingleCoilTorqueFieldWeakening(
	stepAngle: number,
	ratedCurrent: number,
	torque: number,
	inductance: number,
	resistance: number,
	inputVoltage: number,
	driveCurrent: number,
	rotationsPerSecond: number
) {
	const polePairs = 360 / (4 * stepAngle);
	const Kt = torque / (100 * SQRT2) / ratedCurrent;
	const psi = Kt / polePairs;
	const L = inductance / 1000;
	const R = resistance;
	const omegaElec = 2 * PI * polePairs * rotationsPerSecond;
	const vMax = inputVoltage;
	const iMax = driveCurrent;

	if (iMax <= 0 || vMax <= 0) return 0;

	const zSq = R * R + (omegaElec * L) ** 2;
	// Zero impedance (R = 0 at standstill) drops no voltage, so the current limit alone applies
	if (zSq === 0) return Kt * iMax * 100;

	const cd = (-(omegaElec * omegaElec) * L * psi) / zSq;
	const cq = (-R * omegaElec * psi) / zSq;
	const rV = vMax / Math.sqrt(zSq);

	const iQ = maxIqInCurrentAndVoltageDiscs(iMax, cd, cq, rV);
	if (iQ === null || iQ <= 0) return 0;
	return Kt * Math.min(iQ, iMax) * 100;
}
