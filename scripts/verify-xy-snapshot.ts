import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DRIVE_SETTINGS, DEFAULT_GANTRY_SETTINGS } from '../src/lib/configuration';
import { calculateRequiredTorque } from '../src/lib/formulas';
import { STEPPER_DB } from '../src/lib/stepper-db';
import { autoMaxVelocity, buildTorqueCurve, fitTorqueDerating } from '../src/lib/torque-curve';

/**
 * Regression guard for the XY (Cartesian and CoreXY) calculations: fingerprints their outputs over
 * every motor model, kinematics and direction mode, with gearing, friction and calibration set.
 * It fails on any change to an XY result, so changes elsewhere (the Z-axis mode, the UI) cannot
 * alter them unnoticed.
 *
 * After an intentional change to the XY physics, update the stored fingerprint:
 *   pnpm tsx scripts/verify-xy-snapshot.ts --update
 */

const SNAPSHOT_FILE = path.join(import.meta.dirname, 'xy-snapshot.txt');

const motors = [...STEPPER_DB.values()].flatMap((models) => [...models.values()]).filter((_, i) => i % 15 === 0);
const outputs: unknown[] = [];

for (const motorModel of ['classic', 'spreadCycle', 'fieldWeakening'] as const) {
	for (const kinematicsMode of ['cartesian', 'corexy'] as const) {
		const directionModes = kinematicsMode === 'corexy' ? (['envelope', 'peakTorque', 'pureY', 'custom'] as const) : (['envelope'] as const);
		for (const corexyDirectionMode of directionModes) {
			const driveSettings = { ...DEFAULT_DRIVE_SETTINGS, inputVoltage: 24, maxDriveCurrent: 1.8, motorModel, torqueDerating: 0.9 } as never;
			const gantrySettings = {
				...DEFAULT_GANTRY_SETTINGS,
				kinematicsMode,
				corexyDirectionMode,
				customAngleDeg: 30,
				frictionForceN: 3,
				gearA: 2,
				gearB: 1
			} as never;
			const requiredTorque = calculateRequiredTorque(gantrySettings);
			outputs.push(requiredTorque, autoMaxVelocity({ steppers: motors, driveSettings, gantrySettings, requiredTorque }));
			outputs.push(buildTorqueCurve({ steppers: motors, driveSettings, gantrySettings, maxVelocity: 800, stepSize: 40 }));
			outputs.push(fitTorqueDerating({ stepper: motors[1], driveSettings, gantrySettings, measuredSkipSpeed: 150 }));
		}
	}
}

const fingerprint = createHash('sha256').update(JSON.stringify(outputs)).digest('hex');

if (process.argv.includes('--update')) {
	writeFileSync(SNAPSHOT_FILE, `${fingerprint}\n`);
	console.log(`Updated XY snapshot: ${fingerprint}`);
} else {
	const expected = readFileSync(SNAPSHOT_FILE, 'utf8').trim();
	if (fingerprint !== expected) {
		console.error(`❌ XY results changed.\n   expected ${expected}\n   got      ${fingerprint}`);
		console.error('   If the XY physics was changed on purpose, run: pnpm tsx scripts/verify-xy-snapshot.ts --update');
		process.exit(1);
	}
	console.log(`✅ XY results unchanged (${motors.length} motors, all models and modes): ${fingerprint.slice(0, 12)}…`);
}
