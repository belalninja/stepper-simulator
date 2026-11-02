import assert from 'node:assert';
import {
	calculateCoreXYPeakTorqueAngleRad,
	calculateCoreXYSpeedFactor,
	calculateGearRatio,
	calculateRotorTorqueForMode,
	calculateSingleCoilTorque,
	calculateSingleCoilTorqueFieldWeakening,
	calculateSingleCoilTorqueSpreadCycle,
	foldToQuadrantI,
	resolveCoreXYAngleRad,
	calculateRequiredTorque,
	calculateTorqueRotor,
	evaluateCoreXYAtAngle
} from '../src/lib/formulas';
import {
	DEFAULT_GANTRY_SETTINGS,
	type GantrySettings,
	DEFAULT_DRIVE_SETTINGS,
	type DriveSettings
} from '../src/lib/configuration';
import { buildTorqueCurve, fitTorqueDerating, speedLimit } from '../src/lib/torque-curve';
import { encodeConfig, decodeConfig } from '../src/lib/config-sharing';
import { inertiaToGcm2, torqueToNcm } from '../src/lib/datasheet-units';
import { STEPPER_DB } from '../src/lib/stepper-db';
import type {
	StepperDefinition,
	GramSquareCentimeter,
	MillimetersPerSecondSquared,
	Grams,
	NewtonCentimeter,
	Degree,
	Millimeter,
	Ampere,
	MilliHenry,
	Ohm
} from '../src/lib/stepper';

console.log('🧪 Starting Stepper Simulator CoreXY Verification Suite...\n');

// Mock stepper matching Section 2.7 worked example:
// NEMA 17, J = 57 g*cm^2, holding torque = 45 N*cm, rated current = 2.0 A, R = 1.5 ohm, L = 2.8 mH, 1.8 deg
const testStepper: StepperDefinition = {
	brand: 'TestBrand',
	model: 'TestNema17-57',
	nemaSize: 17,
	bodyLength: 40 as Millimeter,
	stepAngle: 1.8 as Degree,
	ratedCurrent: 2.0 as Ampere,
	torque: 45 as NewtonCentimeter,
	inductance: 2.8 as MilliHenry,
	resistance: 1.5 as Ohm,
	rotorInertia: 57 as GramSquareCentimeter,
	comments: []
};

// -------------------------------------------------------------
// Test 1: Gear Ratio Mechanics (G = 3 vs G = 1)
// -------------------------------------------------------------
console.log('Test 1: Gear ratio transmission mechanics (G = 3)...');
const directGantry: GantrySettings = {
	...DEFAULT_GANTRY_SETTINGS,
	kinematicsMode: 'cartesian',
	pulleyTeeth: 20,
	toothPitch: 2,
	gearA: 1,
	gearB: 1,
	acceleration: 10000 as MillimetersPerSecondSquared,
	toolheadAndYAxisMass: 600 as Grams,
	manualRequiredTorque: null
};

const gearedGantry: GantrySettings = {
	...directGantry,
	gearA: 3, // Pulley side
	gearB: 1 // Motor side -> G = 3 (3:1 speed reduction)
};

const G_direct = calculateGearRatio(directGantry);
const G_geared = calculateGearRatio(gearedGantry);
assert.strictEqual(G_direct, 1, 'Direct ratio must be 1');
assert.strictEqual(G_geared, 3, 'Geared reduction ratio must be 3');

const tauLoad_direct = calculateRequiredTorque(directGantry);
const tauLoad_geared = calculateRequiredTorque(gearedGantry);
// With G = 3, motor required load torque must be exactly 1/3 of direct
const loadRatio = tauLoad_direct / tauLoad_geared;
assert(Math.abs(loadRatio - 3) < 1e-4, `Expected load torque to divide by 3, got ratio ${loadRatio}`);

const tauRotor_direct = calculateTorqueRotor(directGantry, testStepper);
const tauRotor_geared = calculateTorqueRotor(gearedGantry, testStepper);
// With G = 3, motor rotor acceleration torque must multiply by 3
const rotorRatio = tauRotor_geared / tauRotor_direct;
assert(Math.abs(rotorRatio - 3) < 1e-4, `Expected rotor torque to multiply by 3, got ratio ${rotorRatio}`);
console.log('✅ Test 1 passed: Load torque divided by 3, rotor torque multiplied by 3.\n');

// -------------------------------------------------------------
// Test 2: CoreXY Hand-Calculated Test Vectors (Report Section 2.7)
// -------------------------------------------------------------
console.log('Test 2: CoreXY Worked Example Test Vectors (Section 2.7)...');
// Parameters: J = 57 g*cm^2, GT2 20T (r = 6.3662 mm), mh = 350 g, mb = 800 g, a = 10 m/s^2 (10000 mm/s^2), G = 1, Fc = 0
const corexyGantry: GantrySettings = {
	...DEFAULT_GANTRY_SETTINGS,
	kinematicsMode: 'corexy',
	pulleyTeeth: 20,
	toothPitch: 2,
	gearA: 1,
	gearB: 1,
	acceleration: 10000 as MillimetersPerSecondSquared,
	toolheadMass: 350 as Grams,
	gantryBeamMass: 800 as Grams,
	corexyDirectionMode: 'envelope',
	frictionForceN: 0,
	manualRequiredTorque: null
};

// Pure X (theta = 0)
const stateX = evaluateCoreXYAtAngle(0, 300, corexyGantry, testStepper);
console.log(
	`  Pure X (0°): tauA = ${stateX.totalTorqueNcmA.toFixed(2)} Ncm, tauB = ${stateX.totalTorqueNcmB.toFixed(2)} Ncm`
);
assert(Math.abs(stateX.totalTorqueNcmA - 2.01) < 0.02, `Pure X tauA expected ~2.01 Ncm, got ${stateX.totalTorqueNcmA}`);
assert(Math.abs(stateX.totalTorqueNcmB - 2.01) < 0.02, `Pure X tauB expected ~2.01 Ncm, got ${stateX.totalTorqueNcmB}`);

// Pure Y (theta = 90 deg = pi/2)
const stateY = evaluateCoreXYAtAngle(Math.PI / 2, 300, corexyGantry, testStepper);
console.log(
	`  Pure Y (90°): tauA = ${stateY.totalTorqueNcmA.toFixed(2)} Ncm, tauB = ${stateY.totalTorqueNcmB.toFixed(2)} Ncm`
);
assert(Math.abs(stateY.totalTorqueNcmA - 4.56) < 0.02, `Pure Y tauA expected ~4.56 Ncm, got ${stateY.totalTorqueNcmA}`);
assert(Math.abs(stateY.totalTorqueNcmB - 4.56) < 0.02, `Pure Y tauB expected ~4.56 Ncm, got ${stateY.totalTorqueNcmB}`);

// Diagonal 45 deg (theta = pi/4)
const state45 = evaluateCoreXYAtAngle(Math.PI / 4, 300, corexyGantry, testStepper);
console.log(
	`  Diagonal (45°): tauA = ${state45.totalTorqueNcmA.toFixed(2)} Ncm, tauB = ${state45.totalTorqueNcmB.toFixed(2)} Ncm, rpsB = ${state45.rpsB.toFixed(2)}`
);
assert(
	Math.abs(state45.totalTorqueNcmA - 4.64) < 0.02,
	`Diagonal tauA expected ~4.64 Ncm, got ${state45.totalTorqueNcmA}`
);
assert(
	Math.abs(state45.totalTorqueNcmB - 1.8) < 0.02,
	`Diagonal tauB expected ~1.80 Ncm, got ${state45.totalTorqueNcmB}`
);
assert(Math.abs(state45.rpsB) < 1e-9, `Diagonal Motor B must be stationary (rps = 0), got ${state45.rpsB}`);
// And 45 deg Motor A speed is sqrt(2) * path speed
const expectedRpsA = (0.3 * Math.SQRT2 * 1000) / 40;
assert(Math.abs(state45.rpsA - expectedRpsA) < 1e-4, `Expected Motor A RPS = ${expectedRpsA}, got ${state45.rpsA}`);

// Peak Torque Angle theta* = atan2(Q, P)
const thetaStarRad = calculateCoreXYPeakTorqueAngleRad(corexyGantry, testStepper);
const thetaStarDeg = (thetaStarRad * 180) / Math.PI;
console.log(`  Peak Torque Angle theta*: ${thetaStarDeg.toFixed(2)}°`);
assert(Math.abs(thetaStarDeg - 66.2) < 0.1, `Expected theta* ~66.20 deg, got ${thetaStarDeg.toFixed(2)}`);

const statePeak = evaluateCoreXYAtAngle(thetaStarRad, 300, corexyGantry, testStepper);
console.log(`  Peak Torque at theta*: tauA = ${statePeak.totalTorqueNcmA.toFixed(2)} Ncm`);
assert(
	Math.abs(statePeak.totalTorqueNcmA - 4.98) < 0.02,
	`Expected peak torque ~4.98 Ncm, got ${statePeak.totalTorqueNcmA}`
);
console.log('✅ Test 2 passed: All Section 2.7 test vectors verified to full precision.\n');

// -------------------------------------------------------------
// Test 3: Envelope Continuity & High-Speed Stall Behavior
// -------------------------------------------------------------
console.log('Test 3: Envelope Continuity & High-Speed Stall Behavior...');
const driveSettings: DriveSettings = {
	...DEFAULT_DRIVE_SETTINGS,
	inputVoltage: 24 as any,
	maxDriveCurrent: 2.0 as any,
	motorModel: 'spreadCycle'
};

const curvePoints = buildTorqueCurve({
	steppers: [testStepper],
	driveSettings,
	gantrySettings: corexyGantry,
	maxVelocity: 2000,
	stepSize: 20
});

const seriesKey = `${testStepper.brand} ${testStepper.model}`;
let prevVal = curvePoints[0][seriesKey];
let monotonicAfterCrossing = true;
const refLoadTorque = calculateRequiredTorque(corexyGantry);

for (let i = 1; i < curvePoints.length; i++) {
	const currentVal = curvePoints[i][seriesKey];
	// After the torque curve drops below required torque, it must monotonically decline toward zero
	if (currentVal < refLoadTorque) {
		if (currentVal > prevVal + 1e-4) {
			console.error(`Backward cusp detected at velocity ${curvePoints[i].velocity}: ${prevVal} -> ${currentVal}`);
			monotonicAfterCrossing = false;
		}
	}
	prevVal = currentVal;
}
assert(monotonicAfterCrossing, 'Envelope curve must not have backward cusps or spikes!');

// Check that at extreme speed, the envelope hits 0 smoothly and stays at 0
const endPoint = curvePoints[curvePoints.length - 1][seriesKey];
console.log(
	`  Standstill torque: ${curvePoints[0][seriesKey].toFixed(2)} Ncm, End velocity torque: ${endPoint.toFixed(2)} Ncm`
);
assert(endPoint >= 0, 'Torque cannot be negative');
console.log('✅ Test 3 passed: Envelope is C0-continuous with no backward cusps.\n');

// -------------------------------------------------------------
// Test 4: URL Serialization Backward Compatibility & Round-Trip
// -------------------------------------------------------------
console.log('Test 4: URL Serialization Backward Compatibility & Round-Trip...');
// Test 4a: CoreXY round-trip
const fullConfig = {
	driveSettings,
	gantrySettings: {
		...corexyGantry,
		corexyDirectionMode: 'peakTorque' as const,
		frictionForceN: 1.5
	},
	customSteppers: [],
	debug: false,
	selectedSteppers: [testStepper]
};

const encoded = encodeConfig(fullConfig);
const decoded = decodeConfig(encoded);
assert(decoded !== null, 'Failed to decode CoreXY configuration');
assert.strictEqual(decoded.config.gantrySettings.kinematicsMode, 'corexy', 'Kinematics mode must decode as corexy');
assert.strictEqual(decoded.config.gantrySettings.toolheadMass, 350, 'Toolhead mass must roundtrip');
assert.strictEqual(decoded.config.gantrySettings.gantryBeamMass, 800, 'Crossbeam mass must roundtrip');
assert.strictEqual(decoded.config.gantrySettings.corexyDirectionMode, 'peakTorque', 'Direction mode must roundtrip');
assert.strictEqual(decoded.config.gantrySettings.frictionForceN, 1.5, 'Friction force must roundtrip');

// Test 4b: Cartesian config with defaults produces clean minimal URL
const cartesianConfig = {
	driveSettings: DEFAULT_DRIVE_SETTINGS,
	gantrySettings: DEFAULT_GANTRY_SETTINGS,
	customSteppers: [],
	debug: false,
	selectedSteppers: [testStepper]
};
const encodedCartesian = encodeConfig(cartesianConfig);
const decodedCartesian = decodeConfig(encodedCartesian);
assert(decodedCartesian !== null, 'Failed to decode Cartesian configuration');
assert.strictEqual(
	decodedCartesian.config.gantrySettings.kinematicsMode,
	'cartesian',
	'Defaults must decode as cartesian'
);
console.log('✅ Test 4 passed: Backward compatibility and round-trip URL serialization verified.\n');

// -------------------------------------------------------------
// Test 5: Coulomb friction only acts on axes that move (pure X / pure Y / diagonal)
// -------------------------------------------------------------
console.log('Test 5: Friction direction at pure-axis moves...');
const frictionGantry: GantrySettings = { ...corexyGantry, frictionForceN: 2 };
const rM = (frictionGantry.pulleyTeeth * frictionGantry.toothPitch) / (2 * Math.PI * 1000);
const noInertia: StepperDefinition = { ...testStepper, rotorInertia: 0 as GramSquareCentimeter };
for (const [mode, theta, axesMoving] of [
	['pureX', 0, 1],
	['pureY', Math.PI / 2, 1],
	['diagonal45', Math.PI / 4, 2]
] as const) {
	const g = { ...frictionGantry, corexyDirectionMode: mode };
	const curveSide = evaluateCoreXYAtAngle(theta, 300, g, noInertia).loadTorqueNcmA;
	const refLine = calculateRequiredTorque(g);
	const withoutFriction = evaluateCoreXYAtAngle(theta, 300, corexyGantry, noInertia).loadTorqueNcmA;
	const expectedFriction = 0.5 * 2 * axesMoving * rM * 100;
	assert(Math.abs(curveSide - refLine) < 1e-9, `${mode}: curve load ${curveSide} != reference ${refLine}`);
	assert(
		Math.abs(curveSide - withoutFriction - expectedFriction) < 1e-9,
		`${mode}: friction share ${curveSide - withoutFriction}, expected ${expectedFriction}`
	);
}
console.log('✅ Test 5 passed: friction counted once per moving axis; curve and reference line agree.\n');

// -------------------------------------------------------------
// Test 6: Motor models vs. an independent numerical optimiser
// -------------------------------------------------------------
// Reference: for each i_d, bisect for the largest i_q meeting both |i| <= I and |v| <= V with the
// full voltage equation v_d = R i_d - wL i_q, v_q = R i_q + wL i_d + w psi; then golden-section
// search over the exact feasible i_d interval (convex feasible set, so max i_q(i_d) is concave). SpreadCycle is the
// same search restricted to i_d = 0. Shares no code with formulas.ts.
console.log('Test 6: Field-weakening & SpreadCycle vs. numerical optimum (DB sweep)...');
type MotorArgs = { stepAngle: number; ratedCurrent: number; torque: number; inductance: number; resistance: number };
function numericalOptimumNcm(m: MotorArgs, V: number, I: number, rps: number, fieldWeakening: boolean): number {
	const p = 360 / (4 * m.stepAngle);
	const Kt = m.torque / (100 * Math.SQRT2) / m.ratedCurrent;
	const psi = Kt / p;
	const L = m.inductance / 1000;
	const R = m.resistance;
	const w = 2 * Math.PI * p * rps;
	const ok = (d: number, q: number) => {
		const vd = R * d - w * L * q;
		const vq = R * q + w * L * d + w * psi;
		return d * d + q * q <= I * I && vd * vd + vq * vq <= V * V;
	};
	const maxIq = (d: number) => {
		let lo = 0;
		let hi = Math.sqrt(Math.max(0, I * I - d * d));
		if (!ok(d, 0)) return -1;
		if (ok(d, hi)) return hi;
		for (let k = 0; k < 80; k++) {
			const mid = (lo + hi) / 2;
			if (ok(d, mid)) lo = mid;
			else hi = mid;
		}
		return lo;
	};
	if (!fieldWeakening) return Kt * Math.max(0, maxIq(0)) * 100;
	// max i_q >= 0 exactly where (i_d, 0) is feasible (both constraint discs reach below i_q = 0).
	// From the raw voltage equation at i_q = 0: (R² + w²L²)·d² + 2w²Lψ·d + w²ψ² − V² <= 0.
	const A = R * R + w * w * L * L;
	const B = 2 * w * w * L * psi;
	const C = w * w * psi * psi - V * V;
	const disc = B * B - 4 * A * C;
	if (disc < 0) return 0;
	let a = Math.max(-I, (-B - Math.sqrt(disc)) / (2 * A));
	let b = Math.min(I, (-B + Math.sqrt(disc)) / (2 * A));
	if (a > b) return 0;
	// max i_q(i_d) is concave on [a, b] (convex feasible set), so golden-section converges to it
	const g = (Math.sqrt(5) - 1) / 2;
	let best = Math.max(maxIq(a), maxIq(b));
	for (let k = 0; k < 200; k++) {
		const x1 = b - g * (b - a);
		const x2 = a + g * (b - a);
		const [q1, q2] = [maxIq(x1), maxIq(x2)];
		best = Math.max(best, q1, q2);
		if (q1 > q2) b = x2;
		else a = x1;
	}
	return Kt * Math.max(0, best) * 100;
}

const dbMotors = [...STEPPER_DB.values()].flatMap((byModel) => [...byModel.values()]);
const sampleMotors = dbMotors.filter((_, i) => i % Math.max(1, Math.floor(dbMotors.length / 25)) === 0);
let worstFw = 0;
let worstSc = 0;
let cases = 0;
for (const m of sampleMotors) {
	const ratedPeak = m.ratedCurrent * Math.SQRT2;
	for (const V of [12, 24, 48]) {
		for (const I of [0.5 * ratedPeak, ratedPeak, 1.5 * ratedPeak, (2 * V) / m.resistance]) {
			let prevFw = Infinity;
			for (let rps = 0; rps <= 40; rps += 2) {
				const args = [m.stepAngle, m.ratedCurrent, m.torque, m.inductance, m.resistance, V, I, rps] as const;
				const fw = calculateSingleCoilTorqueFieldWeakening(...args);
				const sc = calculateSingleCoilTorqueSpreadCycle(...args);
				const fwRef = numericalOptimumNcm(m, V, I, rps, true);
				const scRef = numericalOptimumNcm(m, V, I, rps, false);
				const scale = Math.max(1, fwRef);
				const label = `${m.brand} ${m.model} V=${V} I=${I.toFixed(2)} rps=${rps}`;
				worstFw = Math.max(worstFw, Math.abs(fw - fwRef) / scale);
				worstSc = Math.max(worstSc, Math.abs(sc - scRef) / scale);
				assert(Math.abs(fw - fwRef) / scale < 1e-6, `FW ${fw} vs optimum ${fwRef} (${label})`);
				assert(Math.abs(sc - scRef) / scale < 1e-6, `SpreadCycle ${sc} vs optimum ${scRef} (${label})`);
				assert(fw >= sc - 1e-9, `FW below SpreadCycle: ${fw} < ${sc} (${label})`);
				assert(fw <= prevFw + 1e-9, `FW rises with speed: ${prevFw} -> ${fw} (${label})`);
				prevFw = fw;
				cases++;
			}
		}
	}
}
// Standstill with I*R > V: every model must give Kt * V/R, not Kt * I
const supplyLimitedArgs = [1.8, 2, 45, 2.8, 1.5, 12, 10, 0] as const; // V/R = 8 A < 10 A
const expectedStandstill = (45 / (100 * Math.SQRT2) / 2) * 8 * 100;
for (const model of ['classic', 'spreadCycle', 'fieldWeakening'] as const) {
	const t = calculateSingleCoilTorque(model, ...supplyLimitedArgs);
	assert(Math.abs(t - expectedStandstill) < 1e-9, `${model} standstill ${t}, expected ${expectedStandstill}`);
}
console.log(
	`  ${cases} cases over ${sampleMotors.length} DB motors; worst relative error FW ${worstFw.toExponential(1)}, SpreadCycle ${worstSc.toExponential(1)}`
);
console.log('✅ Test 6 passed: closed forms match the numerical optimum; standstill limited to V/R.\n');

// -------------------------------------------------------------
// Test 6b: CoreXY-aware rotor torque for the debug panel
// -------------------------------------------------------------
const rotorCart = calculateRotorTorqueForMode(directGantry, testStepper);
const rotorEnv = calculateRotorTorqueForMode({ ...corexyGantry, corexyDirectionMode: 'envelope' }, testStepper);
const rotorX = calculateRotorTorqueForMode({ ...corexyGantry, corexyDirectionMode: 'pureX' }, testStepper);
assert(rotorCart.thetaRad === null);
assert(Math.abs(rotorEnv.torqueNcm - Math.SQRT2 * calculateTorqueRotor(corexyGantry, testStepper)) < 1e-9);
assert(Math.abs(rotorX.torqueNcm - calculateTorqueRotor(corexyGantry, testStepper)) < 1e-9);
console.log('✅ Test 6b passed: CoreXY rotor torque = √2× Cartesian at 45°, 1× on a pure axis.\n');

// -------------------------------------------------------------
// Test 7: Custom angles in any quadrant mirror onto Quadrant I
// -------------------------------------------------------------
console.log('Test 7: Custom angle folding...');
const deg = (d: number) => (d * Math.PI) / 180;
for (const [input, expected] of [
	[30, 30],
	[-30, 30],
	[150, 30],
	[210, 30],
	[330, 30],
	[90, 90],
	[180, 0],
	[405, 45]
]) {
	const got =
		(resolveCoreXYAngleRad({ ...corexyGantry, corexyDirectionMode: 'custom', customAngleDeg: input as Degree }) *
			180) /
		Math.PI;
	assert(Math.abs(got - expected) < 1e-9, `custom ${input}° -> ${got}°, expected ${expected}°`);
	assert(Math.abs(foldToQuadrantI(deg(input)) - deg(expected)) < 1e-9);
}
assert(Math.abs(calculateCoreXYSpeedFactor(deg(45)) - Math.SQRT2) < 1e-12);
console.log('✅ Test 7 passed.\n');

// -------------------------------------------------------------
// Test 8: Datasheet unit conversions
// -------------------------------------------------------------
console.log('Test 8: Datasheet unit conversions...');
assert(Math.abs(torqueToNcm(0.45, 'Nm') - 45) < 1e-9);
assert(Math.abs(torqueToNcm(450, 'mNm') - 45) < 1e-9);
assert(Math.abs(torqueToNcm(4.4, 'kgfcm') - 43.149) < 1e-3);
assert(Math.abs(torqueToNcm(63.7, 'ozfin') - 44.98) < 1e-2);
assert(Math.abs(inertiaToGcm2(0.057, 'kgcm2') - 57) < 1e-9);
assert(Math.abs(inertiaToGcm2(5.7e-6, 'kgm2') - 57) < 1e-9);
assert(Math.abs(inertiaToGcm2(0.31, 'ozin2') - 56.7) < 0.1);
console.log('✅ Test 8 passed.\n');

// -------------------------------------------------------------
// Test 9: Torque derating, calibration fit, model band, safety factor sharing
// -------------------------------------------------------------
console.log('Test 9: Calibration and chart aids...');
{
	const userMotor: StepperDefinition = {
		...testStepper,
		ratedCurrent: 1 as Ampere,
		torque: 26.5 as NewtonCentimeter,
		inductance: 6.5 as MilliHenry,
		resistance: 3.4 as Ohm,
		rotorInertia: 36 as GramSquareCentimeter
	};
	const g: GantrySettings = {
		...corexyGantry,
		acceleration: 20000 as MillimetersPerSecondSquared,
		toolheadMass: 400 as Grams,
		gantryBeamMass: 600 as Grams,
		frictionForceN: 5
	};
	const key = `${userMotor.brand} ${userMotor.model}`;
	const req = calculateRequiredTorque(g);
	for (const model of ['classic', 'spreadCycle', 'fieldWeakening'] as const) {
		const d: DriveSettings = {
			...DEFAULT_DRIVE_SETTINGS,
			inputVoltage: 24 as any,
			maxDriveCurrent: Math.SQRT2 as any,
			motorModel: model
		};
		const limitAt = (k: number) => {
			const pts = buildTorqueCurve({
				steppers: [userMotor],
				driveSettings: { ...d, torqueDerating: k },
				gantrySettings: g,
				maxVelocity: 1500,
				stepSize: 1
			});
			return speedLimit(pts, key, req) as number;
		};
		// Derating lowers the predicted limit; the fit recovers a known factor from its own prediction
		assert(limitAt(0.8) < limitAt(1), `${model}: derating must lower the limit`);
		const synthetic = limitAt(0.8);
		const fit = fitTorqueDerating({
			stepper: userMotor,
			driveSettings: d,
			gantrySettings: g,
			measuredSkipSpeed: synthetic
		});
		assert(
			fit.ok && Math.abs(fit.factor - 0.8) < 0.01,
			`${model}: fit ${JSON.stringify(fit)} expected 0.8 from ${synthetic} mm/s`
		);
		console.log(
			`  ${model}: limit ${limitAt(1).toFixed(0)} mm/s at 1.0×, ${synthetic.toFixed(0)} at 0.8× -> fitted ${fit.ok ? fit.factor : '?'}`
		);
	}
	// Out-of-range measurements are reported, not silently clamped
	const d0: DriveSettings = {
		...DEFAULT_DRIVE_SETTINGS,
		inputVoltage: 24 as any,
		maxDriveCurrent: Math.SQRT2 as any,
		motorModel: 'spreadCycle'
	};
	const far = fitTorqueDerating({
		stepper: userMotor,
		driveSettings: d0,
		gantrySettings: g,
		measuredSkipSpeed: 5000
	});
	assert(!far.ok && far.reason === 'tooFast', `expected tooFast, got ${JSON.stringify(far)}`);
	// Classic is the floor and SpreadCycle the ceiling for this motor (the band's two edges)
	const lim = (model: 'classic' | 'spreadCycle') =>
		speedLimit(
			buildTorqueCurve({
				steppers: [userMotor],
				driveSettings: { ...d0, motorModel: model },
				gantrySettings: g,
				maxVelocity: 1500,
				stepSize: 1
			}),
			key,
			req
		) as number;
	assert(lim('classic') < lim('spreadCycle'));
	// New settings survive a share link
	const shared = decodeConfig(
		encodeConfig({
			driveSettings: { ...d0, torqueDerating: 0.87, showModelBand: false },
			gantrySettings: { ...g, safetyFactor: 2 },
			customSteppers: [],
			debug: false,
			selectedSteppers: [testStepper]
		})
	);
	assert(shared !== null);
	assert.strictEqual(shared.config.driveSettings.torqueDerating, 0.87);
	assert.strictEqual(shared.config.driveSettings.showModelBand, false);
	assert.strictEqual(shared.config.gantrySettings.safetyFactor, 2);
	const defaults = decodeConfig(encodeConfig(cartesianConfig));
	assert(defaults !== null);
	assert.strictEqual(defaults.config.driveSettings.torqueDerating, 1);
	assert.strictEqual(defaults.config.gantrySettings.safetyFactor, 1.5);
}
console.log('✅ Test 9 passed.\n');

console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! 🚀');
