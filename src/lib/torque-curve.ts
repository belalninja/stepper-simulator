import {
	calculateDriveCurrent,
	calculateGearRatio,
	calculatePulleyCircumferenceMm,
	calculateRequiredTorque,
	calculateSingleCoilTorque,
	calculateTorqueRotor,
	evaluateCoreXYAtAngle,
	type MotorModel,
	resolveCoreXYAngleRad
} from '@/lib/formulas';
import type { StepperDefinition } from '@/lib/stepper';
import type { DriveSettings, GantrySettings } from '@/lib/configuration';

/** Velocity resolution of the sampled curve, in mm/s */
export const TORQUE_CURVE_STEP_SIZE = 20;
export const DEFAULT_MAX_VELOCITY = 2000;

/** One colour per series, cycled. Shared so the OG image matches the in-app graph. */
export const STEPPER_SERIES_COLORS = [
	'#2563eb', // blue
	'#dc2626', // red
	'#16a34a', // green
	'#ca8a04', // yellow
	'#9333ea', // purple
	'#c2410c', // orange
	'#0891b2', // cyan
	'#be123c', // rose
	'#059669', // emerald
	'#7c3aed' // violet
];

export function stepperSeriesKey(stepper: Pick<StepperDefinition, 'brand' | 'model'>): string {
	return `${stepper.brand} ${stepper.model}`;
}

export function stepperSeriesColor(index: number): string {
	return STEPPER_SERIES_COLORS[index % STEPPER_SERIES_COLORS.length];
}

/** A sampled velocity, plus one torque value per series key */
export type TorqueCurvePoint = { velocity: number } & Record<string, number>;

export type TorqueCurveInput = {
	steppers: StepperDefinition[];
	driveSettings: DriveSettings;
	gantrySettings: GantrySettings;
	maxVelocity: number;
	stepSize?: number;
	/** Draw with this driver model instead of `driveSettings.motorModel` (used for the model band) */
	motorModelOverride?: MotorModel;
};

// 2-degree grid over [0°, 90°] for 'envelope' mode, plus 45° (the maximum motor speed direction,
// which the even grid would otherwise skip): 47 points
const ENVELOPE_ANGLES_RAD = [...Array.from({ length: 46 }, (_, i) => i * 2), 45]
	.sort((a, b) => a - b)
	.map((deg) => (deg * Math.PI) / 180);

/**
 * Samples the torque each stepper can still deliver across the velocity range, after the torque
 * the rotor spends accelerating itself is subtracted.
 *
 * Lives outside the component because the OpenGraph renderer draws the same curves server-side
 * and must not reimplement them.
 */
export function buildTorqueCurve({
	steppers,
	driveSettings,
	gantrySettings,
	maxVelocity,
	stepSize = TORQUE_CURVE_STEP_SIZE,
	motorModelOverride
}: TorqueCurveInput): TorqueCurvePoint[] {
	const motorModel = motorModelOverride ?? driveSettings.motorModel;
	// Real-world correction fitted from a measured skip speed; scales what the motor can deliver
	const derating = driveSettings.torqueDerating > 0 ? driveSettings.torqueDerating : 1;
	const pulleyCircumferenceMm = calculatePulleyCircumferenceMm(gantrySettings);
	const gearRatio = calculateGearRatio(gantrySettings);
	const referenceRequiredTorque = calculateRequiredTorque(gantrySettings);

	const velocityPoints = Array.from(
		{ length: Math.floor((maxVelocity + stepSize) / stepSize) },
		(_, i) => i * stepSize
	);

	return velocityPoints.map((velocity) => {
		const dataPoint: TorqueCurvePoint = { velocity };

		for (const stepper of steppers) {
			const driveCurrent = calculateDriveCurrent(driveSettings);

			if (gantrySettings.kinematicsMode !== 'corexy') {
				// CARTESIAN / LONE MOTOR MODE (with F1 fix: multiply pulley RPS by gearRatio)
				const torqueRotor = calculateTorqueRotor(gantrySettings, stepper);
				const motorRps = (velocity / pulleyCircumferenceMm) * gearRatio;
				const rawTorque =
					derating *
					calculateSingleCoilTorque(
						motorModel,
						stepper.stepAngle,
						stepper.ratedCurrent,
						stepper.torque,
						stepper.inductance,
						stepper.resistance,
						driveSettings.inputVoltage,
						driveCurrent,
						motorRps
					);

				dataPoint[stepperSeriesKey(stepper)] = Math.max(rawTorque - torqueRotor, 0);
			} else {
				// COREXY MODE
				const anglesToTest =
					gantrySettings.corexyDirectionMode === 'envelope'
						? ENVELOPE_ANGLES_RAD
						: [resolveCoreXYAngleRad(gantrySettings, stepper)];

				let worstPlottedValue = Infinity;

				for (const thetaRad of anglesToTest) {
					const state = evaluateCoreXYAtAngle(thetaRad, velocity, gantrySettings, stepper);

					// Motor A strictly limits in Quadrant I
					const availA =
						derating *
						calculateSingleCoilTorque(
							motorModel,
							stepper.stepAngle,
							stepper.ratedCurrent,
							stepper.torque,
							stepper.inductance,
							stepper.resistance,
							driveSettings.inputVoltage,
							driveCurrent,
							state.rpsA
						);

					const tauNetA = Math.max(0, availA - state.rotorTorqueNcmA);
					const tauLoadA = gantrySettings.manualRequiredTorque ?? state.loadTorqueNcmA;
					const marginA = tauNetA - tauLoadA;

					let plottedTheta: number;
					if (marginA >= 0) {
						plottedTheta = referenceRequiredTorque + marginA;
					} else if (tauLoadA > 0) {
						plottedTheta = tauNetA * (referenceRequiredTorque / tauLoadA);
					} else {
						plottedTheta = tauNetA;
					}

					if (plottedTheta < worstPlottedValue) {
						worstPlottedValue = plottedTheta;
					}
				}

				dataPoint[stepperSeriesKey(stepper)] = Math.max(worstPlottedValue, 0);
			}
		}

		return dataPoint;
	});
}

/**
 * Tick spacings that read well on an axis; the range is always five of one of them. Kept dense
 * enough that rounding up to the next one cannot inflate the range by much.
 */
const NICE_TICK_STEPS = [
	10, 20, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000
];
/** Nothing sensible needs a wider range, and it bounds the work `autoMaxVelocity` does */
const AUTO_MAX_VELOCITY_CAP = NICE_TICK_STEPS[NICE_TICK_STEPS.length - 1] * 5;
/** Fraction of the range left past the point where the last motor stops being useful */
const AUTO_VELOCITY_HEADROOM = 1.15;
/** A series below this fraction of its own standstill torque has nothing left to show */
const AUTO_VELOCITY_FLOOR_FRACTION = 0.05;

function roundToNiceRange(velocity: number): number {
	const step = NICE_TICK_STEPS.find((candidate) => candidate * 5 >= velocity);
	return step === undefined ? AUTO_MAX_VELOCITY_CAP : step * 5;
}

/**
 * Picks a velocity range that fits every selected stepper: wide enough that each curve is shown
 * falling off, but not so wide that they all collapse into the left edge.
 *
 * Each series gets its own cutoff. A motor that starts *below* the required torque never crosses
 * it, and thresholding the whole chart on the required torque would leave that motor as a flat
 * line running off the right edge, which is exactly the shape that says "nothing was fitted here".
 * Such a series is instead followed down to a fraction of its own standstill torque.
 *
 * Sampled coarsely on purpose. This only decides the axis, and the fine curve is built afterwards.
 */
export function autoMaxVelocity({
	requiredTorque,
	...input
}: Omit<TorqueCurveInput, 'maxVelocity' | 'stepSize'> & { requiredTorque: number }): number {
	if (input.steppers.length === 0) return DEFAULT_MAX_VELOCITY;

	return fitVelocityRange({
		keys: input.steppers.map(stepperSeriesKey),
		requiredTorque,
		cap: AUTO_MAX_VELOCITY_CAP,
		fallback: DEFAULT_MAX_VELOCITY,
		build: (maxVelocity, stepSize) => buildTorqueCurve({ ...input, maxVelocity, stepSize })
	});
}

/**
 * The range-fitting core of `autoMaxVelocity`, for any curve builder. `cap` bounds the search and
 * the sampling is `cap / 500`, so an axis with lower speeds (Z) passes a smaller cap for resolution.
 */
export function fitVelocityRange({
	keys,
	requiredTorque,
	cap,
	fallback,
	build
}: {
	keys: string[];
	requiredTorque: number;
	cap: number;
	fallback: number;
	build: (maxVelocity: number, stepSize: number) => TorqueCurvePoint[];
}): number {
	const stepSize = cap / 500;
	const points = build(cap, stepSize);
	const required = Number.isFinite(requiredTorque) ? Math.max(requiredTorque, 0) : 0;

	const thresholds = new Map(
		keys.map((key) => {
			const floor = points[0][key] * AUTO_VELOCITY_FLOOR_FRACTION;
			return [key, points[0][key] > required ? Math.max(required, floor) : floor];
		})
	);

	// One step past the last sample where a series is still above its own threshold, so the point
	// where it gives up stays on screen
	let lastRelevant = 0;
	for (const point of points) {
		for (const key of keys) {
			if (point[key] > thresholds.get(key)!) lastRelevant = Math.max(lastRelevant, point.velocity + stepSize);
		}
	}

	if (lastRelevant === 0) return roundToNiceRange(fallback);

	return roundToNiceRange(Math.min(lastRelevant * AUTO_VELOCITY_HEADROOM, cap));
}

/**
 * Velocity (mm/s) at which a series drops below the required torque, linearly interpolated between
 * samples. `null` when the series never crosses inside the sampled range: either it is already
 * below the line at standstill, or it stays above it all the way to `maxVelocity`.
 */
export function crossingVelocity(points: TorqueCurvePoint[], seriesKey: string, requiredTorque: number): number | null {
	if (points.length === 0 || points[0][seriesKey] < requiredTorque) return null;

	for (let i = 1; i < points.length; i++) {
		const previous = points[i - 1];
		const current = points[i];
		if (current[seriesKey] >= requiredTorque) continue;

		const span = previous[seriesKey] - current[seriesKey];
		const ratio = span === 0 ? 0 : (previous[seriesKey] - requiredTorque) / span;

		return previous.velocity + ratio * (current.velocity - previous.velocity);
	}

	return null;
}

/**
 * Speed at which a series drops below `requiredTorque`, with the two cases `crossingVelocity` leaves
 * open told apart: `'never'` when it is already below at standstill, `'beyond'` when it stays above
 * across the whole sampled range.
 */
export function speedLimit(
	points: TorqueCurvePoint[],
	seriesKey: string,
	requiredTorque: number
): number | 'never' | 'beyond' {
	if (points.length === 0 || points[0][seriesKey] < requiredTorque) return 'never';
	return crossingVelocity(points, seriesKey, requiredTorque) ?? 'beyond';
}

export type DeratingFit = { ok: true; factor: number } | { ok: false; reason: 'tooFast' | 'tooSlow' };

const DERATING_RANGE: [number, number] = [0.1, 2];

/**
 * Finds the torque derating factor at which `stepper`, on the current settings, would start to skip
 * at `measuredSkipSpeed` (mm/s): the factor by which real hardware falls short of (or beats) the
 * model. The predicted skip speed only grows with the factor, so a bisection finds it.
 *
 * `tooFast`: even at 2× the modeled torque the prediction stays below the measurement (check the
 * masses, friction and acceleration). `tooSlow`: even at 0.1× it stays above it.
 */
export function fitTorqueDerating({
	stepper,
	driveSettings,
	gantrySettings,
	measuredSkipSpeed
}: {
	stepper: StepperDefinition;
	driveSettings: DriveSettings;
	gantrySettings: GantrySettings;
	measuredSkipSpeed: number;
}): DeratingFit {
	const requiredTorque = calculateRequiredTorque(gantrySettings);
	const maxVelocity = measuredSkipSpeed * 1.5 + TORQUE_CURVE_STEP_SIZE;
	const stepSize = Math.max(1, measuredSkipSpeed / 400);
	const key = stepperSeriesKey(stepper);

	const predicted = (factor: number) => {
		const points = buildTorqueCurve({
			steppers: [stepper],
			driveSettings: { ...driveSettings, torqueDerating: factor },
			gantrySettings,
			maxVelocity,
			stepSize
		});
		const limit = speedLimit(points, key, requiredTorque);
		return limit === 'never' ? 0 : limit === 'beyond' ? Infinity : limit;
	};

	let [lo, hi] = DERATING_RANGE;
	if (predicted(hi) < measuredSkipSpeed) return { ok: false, reason: 'tooFast' };
	if (predicted(lo) > measuredSkipSpeed) return { ok: false, reason: 'tooSlow' };
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (predicted(mid) < measuredSkipSpeed) lo = mid;
		else hi = mid;
	}
	return { ok: true, factor: Math.round(((lo + hi) / 2) * 1000) / 1000 };
}
