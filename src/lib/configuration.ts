import { CurrentUnit } from '@/lib/current-unit';
import type { MotorModel as MotorModelName } from '@/lib/formulas';
import {
	Ampere,
	Degree,
	Grams,
	MillimetersPerSecondSquared,
	NewtonCentimeter,
	type StepperDefinition,
	Volts
} from '@/lib/stepper';
import z from 'zod/v4';

/**
 * The configuration shape and its defaults, kept free of anything browser-only.
 *
 * `@/state/atoms` touches `localStorage` at module scope, so everything that has to run in Node
 * as well (share-link decoding, the OpenGraph renderer) imports from here instead.
 */

export const MotorModel = z.enum(['classic', 'spreadCycle', 'fieldWeakening']) satisfies z.ZodType<MotorModelName>;

export const KinematicsMode = z.enum(['cartesian', 'corexy']);
export type KinematicsMode = z.infer<typeof KinematicsMode>;

export const CoreXYDirectionMode = z.enum(['envelope', 'peakTorque', 'diagonal45', 'pureY', 'pureX', 'custom']);
export type CoreXYDirectionMode = z.infer<typeof CoreXYDirectionMode>;

export type DriveSettings = {
	inputVoltage: Volts;
	/** stored in peak current */
	maxDriveCurrent: Ampere;
	/** just how it's displayed */
	currentUnit: CurrentUnit;
	motorModel: MotorModelName;
	/**
	 * Fraction of the modeled motor torque the real hardware delivers (1 = trust the model). Fitted from
	 * a measured skip speed, and applied to every curve.
	 */
	torqueDerating: number;
	/** Shade the range between the Classic (pessimistic) and SpreadCycle (optimistic) curves */
	showModelBand: boolean;
};

export type GantrySettings = {
	kinematicsMode: KinematicsMode;
	pulleyTeeth: number;
	toothPitch: number;
	gearA: number;
	gearB: number;
	acceleration: MillimetersPerSecondSquared;
	toolheadAndYAxisMass: Grams;
	toolheadMass: Grams;
	gantryBeamMass: Grams;
	corexyDirectionMode: CoreXYDirectionMode;
	customAngleDeg: Degree;
	frictionForceN: number;
	manualRequiredTorque: NewtonCentimeter | null;
	/** A second reference line at requiredTorque × safetyFactor: curves above it keep (factor − 1) spare */
	safetyFactor: number;
};

export type ShareableConfiguration = {
	driveSettings: DriveSettings;
	gantrySettings: GantrySettings;
	customSteppers: StepperDefinition[];
	debug: boolean;
	selectedSteppers: StepperDefinition[];
};

export const DEFAULT_DEBUG = false;

export const DEFAULT_DRIVE_SETTINGS: DriveSettings = {
	inputVoltage: 24 as Volts,
	maxDriveCurrent: 1 as Ampere,
	currentUnit: 'peak',
	motorModel: 'classic',
	torqueDerating: 1,
	showModelBand: true
};

export const DEFAULT_GANTRY_SETTINGS: GantrySettings = {
	kinematicsMode: 'cartesian',
	pulleyTeeth: 20,
	toothPitch: 2,
	gearA: 1,
	gearB: 1,
	acceleration: 20000 as MillimetersPerSecondSquared,
	toolheadAndYAxisMass: 500 as Grams,
	toolheadMass: 350 as Grams,
	gantryBeamMass: 800 as Grams,
	corexyDirectionMode: 'envelope',
	customAngleDeg: 45 as Degree,
	frictionForceN: 0,
	manualRequiredTorque: null,
	safetyFactor: 1.5
};

export const DriveSettingsSchema = z.object({
	inputVoltage: Volts.catch(DEFAULT_DRIVE_SETTINGS.inputVoltage),
	maxDriveCurrent: Ampere.catch(DEFAULT_DRIVE_SETTINGS.maxDriveCurrent),
	currentUnit: CurrentUnit.catch(DEFAULT_DRIVE_SETTINGS.currentUnit),
	motorModel: MotorModel.catch(DEFAULT_DRIVE_SETTINGS.motorModel),
	torqueDerating: z.number().positive().catch(DEFAULT_DRIVE_SETTINGS.torqueDerating),
	showModelBand: z.boolean().catch(DEFAULT_DRIVE_SETTINGS.showModelBand)
}) satisfies z.ZodType<DriveSettings>;

export const GantrySettingsSchema = z.object({
	kinematicsMode: KinematicsMode.catch(DEFAULT_GANTRY_SETTINGS.kinematicsMode),
	pulleyTeeth: z.number().catch(DEFAULT_GANTRY_SETTINGS.pulleyTeeth),
	toothPitch: z.number().catch(DEFAULT_GANTRY_SETTINGS.toothPitch),
	gearA: z.number().catch(DEFAULT_GANTRY_SETTINGS.gearA),
	gearB: z.number().catch(DEFAULT_GANTRY_SETTINGS.gearB),
	acceleration: MillimetersPerSecondSquared.catch(DEFAULT_GANTRY_SETTINGS.acceleration),
	toolheadAndYAxisMass: Grams.catch(DEFAULT_GANTRY_SETTINGS.toolheadAndYAxisMass),
	toolheadMass: Grams.catch(DEFAULT_GANTRY_SETTINGS.toolheadMass),
	gantryBeamMass: Grams.catch(DEFAULT_GANTRY_SETTINGS.gantryBeamMass),
	corexyDirectionMode: CoreXYDirectionMode.catch(DEFAULT_GANTRY_SETTINGS.corexyDirectionMode),
	customAngleDeg: Degree.catch(DEFAULT_GANTRY_SETTINGS.customAngleDeg),
	frictionForceN: z.number().catch(DEFAULT_GANTRY_SETTINGS.frictionForceN),
	manualRequiredTorque: NewtonCentimeter.nullable().catch(DEFAULT_GANTRY_SETTINGS.manualRequiredTorque),
	safetyFactor: z.number().min(1).catch(DEFAULT_GANTRY_SETTINGS.safetyFactor)
}) satisfies z.ZodType<GantrySettings>;
