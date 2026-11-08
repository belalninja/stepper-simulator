import assert from 'node:assert';
import { decodeConfig, encodeConfig } from '../src/lib/config-sharing';
import {
	DEFAULT_DRIVE_SETTINGS,
	DEFAULT_GANTRY_SETTINGS,
	DEFAULT_Z_AXIS_SETTINGS,
	type DriveSettings,
	type ZAxisSettings
} from '../src/lib/configuration';
import { calculateSingleCoilTorque } from '../src/lib/formulas';
import type { StepperDefinition } from '../src/lib/stepper';
import { speedLimit } from '../src/lib/torque-curve';
import {
	buildZTorqueCurve,
	calculateZCases,
	calculateZRequiredTorque,
	zInertiaTorque,
	zIsSelfLocking,
	zMotorRps
} from '../src/lib/z-axis';

/**
 * Z-axis checks against hand calculations. Screw torques are recomputed in the tan(λ ± φ') form,
 * independent of the fraction form the code uses:
 *   raise = F·dm/2·tan(λ + φ'),  lower = F·dm/2·tan(φ' − λ),
 *   tan λ = L / (π·dm),  tan φ' = μ / cos 15°.
 */

const g = 9.80665;
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const motor = {
	brand: 'Test',
	model: 'Z',
	nemaSize: 17,
	bodyLength: 48,
	stepAngle: 1.8,
	ratedCurrent: 2,
	torque: 55,
	inductance: 2.8,
	resistance: 1.4,
	rotorInertia: 54,
	comments: []
} as unknown as StepperDefinition;
const drive: DriveSettings = {
	...DEFAULT_DRIVE_SETTINGS,
	inputVoltage: 24 as never,
	maxDriveCurrent: 1.4 as never,
	motorModel: 'spreadCycle'
};

console.log('🧪 Z-axis checks\n');

// 1. Belt, Voron 2.4 defaults: 3 kg, 4 motors, 80:16, 20T GT2, 350 mm/s²
{
	const z: ZAxisSettings = { ...DEFAULT_Z_AXIS_SETTINGS, enabled: true };
	const r = 0.04 / (2 * Math.PI);
	const F = (3 * (g + 0.35)) / 4;
	const expected = ((F * r) / 5) * 100;
	assert(close(calculateZRequiredTorque(z), expected), `belt lift ${calculateZRequiredTorque(z)} vs ${expected}`);
	// Rotor: α = 2π·a / (travel per motor turn) = 2π·350 / 8 rad/s²
	assert(close(zInertiaTorque(z, motor), 54e-7 * ((2 * Math.PI * 350) / 8)));
	assert(close(zMotorRps(z, 16), 2), '16 mm/s at 8 mm per motor turn is 2 rev/s');
	const c = calculateZCases(z, motor, drive);
	const back = ((((3 * g) / 4) * r) / 5) * 100;
	assert(close(c.backDrive, back), `belt back-drive ${c.backDrive} vs ${back}`);
	assert(close(c.detent, 55 * 0.05));
	assert(c.holdsUnpowered === back <= 55 * 0.05 && !c.selfLocking);
	console.log(
		`✅ belt: lift ${expected.toFixed(3)} N·cm/motor, back-drive ${back.toFixed(3)} vs detent ${(55 * 0.05).toFixed(2)} → ${c.holdsUnpowered ? 'holds' : 'drops'}`
	);
}

// 2. Trapezoidal leadscrews: T8x2 self-locks, T8x8 back-drives
for (const [lead, locks] of [
	[2, true],
	[8, false]
] as const) {
	const z: ZAxisSettings = {
		...DEFAULT_Z_AXIS_SETTINGS,
		enabled: true,
		drive: 'leadscrew',
		motorCount: 2,
		liftedMass: 2000 as never,
		acceleration: 200 as never,
		gearRatio: 1,
		screwDiameter: 8,
		screwPitch: 2,
		screwLead: lead,
		nutFriction: 0.18,
		guideFrictionN: 2
	};
	const dm = 0.007;
	const lambda = Math.atan(lead / 1000 / (Math.PI * dm));
	const phi = Math.atan(0.18 / Math.cos((15 * Math.PI) / 180));
	const Fup = (2 * (g + 0.2) + 2) / 2;
	const raise = ((Fup * dm) / 2) * Math.tan(lambda + phi) * 100;
	assert(close(calculateZRequiredTorque(z), raise), `T8x${lead} raise ${calculateZRequiredTorque(z)} vs ${raise}`);
	assert.strictEqual(zIsSelfLocking(z), locks, `T8x${lead} self-locking should be ${locks}`);
	const c = calculateZCases(z, motor, drive);
	const holdBack = Math.max(0, -((((2 * g) / 2) * dm) / 2) * Math.tan(phi - lambda)) * 100;
	assert(close(c.holdPowered, holdBack), `T8x${lead} hold ${c.holdPowered} vs ${holdBack}`);
	assert.strictEqual(c.holdsUnpowered, locks || holdBack <= c.detent);
	console.log(
		`✅ T8x${lead}: λ ${((lambda * 180) / Math.PI).toFixed(1)}° vs friction angle ${((phi * 180) / Math.PI).toFixed(1)}° → ${locks ? 'self-locks' : 'back-drives'}, lift ${raise.toFixed(3)} N·cm, hold ${holdBack.toFixed(3)} N·cm`
	);
}

// 3. Ball screw: raise = F·L/(2π·η), always back-drives with F·L·η/(2π)
{
	const z: ZAxisSettings = {
		...DEFAULT_Z_AXIS_SETTINGS,
		enabled: true,
		drive: 'ballscrew',
		motorCount: 1,
		liftedMass: 5000 as never,
		acceleration: 100 as never,
		screwLead: 5,
		gearRatio: 1,
		ballScrewEfficiency: 0.9
	};
	const F = 5 * (g + 0.1);
	assert(close(calculateZRequiredTorque(z), ((F * 0.005) / (2 * Math.PI * 0.9)) * 100));
	const c = calculateZCases(z, motor, drive);
	assert(close(c.backDrive, ((5 * g * 0.005 * 0.9) / (2 * Math.PI)) * 100));
	assert(!c.selfLocking);
	console.log(
		`✅ ball screw: lift ${calculateZRequiredTorque(z).toFixed(3)} N·cm, back-drive ${c.backDrive.toFixed(3)} N·cm`
	);
}

// 4. Screw inertia: solid steel cylinder of the mean diameter, reflected through the gearing
{
	const z: ZAxisSettings = {
		...DEFAULT_Z_AXIS_SETTINGS,
		drive: 'leadscrew',
		screwLead: 2,
		screwLength: 350,
		gearRatio: 2
	};
	const Js = 0.5 * 7850 * Math.PI * 0.0035 ** 4 * 0.35;
	const alpha = (2 * Math.PI * 350) / (2 / 2);
	assert(close(zInertiaTorque(z, motor), (54e-7 + Js / 4) * alpha));
	console.log(`✅ screw inertia ${(Js * 1e7).toFixed(1)} g·cm² reflected ÷ G²`);
}

// 5. Curve = available torque at the motor speed minus inertia; limit sits where it meets the line
{
	const z: ZAxisSettings = {
		...DEFAULT_Z_AXIS_SETTINGS,
		enabled: true,
		drive: 'leadscrew',
		motorCount: 2,
		liftedMass: 2500 as never,
		screwLead: 8,
		gearRatio: 1
	};
	const pts = buildZTorqueCurve({
		steppers: [motor],
		driveSettings: drive,
		zAxisSettings: z,
		maxVelocity: 200,
		stepSize: 0.5
	});
	const at = (i: number) => pts[i]['Test Z'];
	const inertia = zInertiaTorque(z, motor) * 100;
	for (const i of [0, 40, 200]) {
		const rps = zMotorRps(z, pts[i].velocity);
		const av = calculateSingleCoilTorque('spreadCycle', 1.8, 2, 55, 2.8, 1.4, 24, 1.4, rps);
		assert(close(at(i), Math.max(av - inertia, 0)), `curve point ${i}`);
	}
	const limit = speedLimit(pts, 'Test Z', calculateZRequiredTorque(z));
	assert(typeof limit === 'number' && limit > 0);
	console.log(`✅ Z curve matches the motor model; T8x8 2-motor lift limit ${(limit as number).toFixed(1)} mm/s`);
}

// 6. Share links: Z settings round-trip, and an untouched Z setup adds nothing to the link
{
	const base = {
		driveSettings: DEFAULT_DRIVE_SETTINGS,
		gantrySettings: DEFAULT_GANTRY_SETTINGS,
		customSteppers: [],
		debug: false,
		selectedSteppers: [motor]
	};
	const plain = encodeConfig({ ...base, zAxisSettings: DEFAULT_Z_AXIS_SETTINGS });
	assert.strictEqual(plain, encodeConfig(base), 'default Z settings must not change the link');
	const z = { ...DEFAULT_Z_AXIS_SETTINGS, enabled: true, drive: 'leadscrew' as const, screwLead: 2, motorCount: 2 };
	const decoded = decodeConfig(encodeConfig({ ...base, zAxisSettings: z }));
	assert(decoded);
	assert.deepStrictEqual(decoded.config.zAxisSettings, z);
	console.log('✅ share links carry Z settings; old links unchanged');
}

console.log('\n🎉 Z-axis checks passed');
