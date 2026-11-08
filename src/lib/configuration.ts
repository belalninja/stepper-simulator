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
	/** Optional so configurations from before the Z-axis mode stay valid */
	zAxisSettings?: ZAxisSettings;
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

// ---------------------------------------------------------------------------------------------
// Z-axis mode. Fully separate from the XY settings above: switching it on changes which curves are
// drawn, never how the Cartesian or CoreXY curves are calculated.
// ---------------------------------------------------------------------------------------------

export const ZDriveType = z.enum(['leadscrew', 'ballscrew', 'belt']);
export type ZDriveType = z.infer<typeof ZDriveType>;

export type ZAxisSettings = {
	/** Draw Z-axis curves instead of XY */
	enabled: boolean;
	drive: ZDriveType;
	/** Number of Z motors sharing the load equally */
	motorCount: number;
	/** Everything the Z motors lift: gantry, XY motion, toolhead (or the bed, on a moving-bed printer) */
	liftedMass: Grams;
	acceleration: MillimetersPerSecondSquared;
	/** Rail and guide friction opposing the motion, total for the axis */
	guideFrictionN: number;
	/** Motor turns per output turn: 80:16 belt reduction = 5, direct drive = 1 */
	gearRatio: number;
	// Screw drives
	/** Nominal screw diameter, mm (T8 = 8) */
	screwDiameter: number;
	/** Thread pitch, mm (distance between threads) */
	screwPitch: number;
	/** Lead, mm of travel per screw turn (pitch × starts: T8x2 = 2, T8x8 = 8) */
	screwLead: number;
	/** Screw length, mm: adds the screw's own inertia */
	screwLength: number;
	/** Nut-on-screw friction coefficient for trapezoidal screws (brass ~0.15–0.2, POM ~0.1–0.15) */
	nutFriction: number;
	/** Ball screw efficiency, both directions */
	ballScrewEfficiency: number;
	// Belt drive
	pulleyTeeth: number;
	toothPitch: number;
	/** Unpowered detent torque as a share of holding torque (datasheets rarely list it; 0.03–0.08 is typical) */
	detentFraction: number;
};

export const DEFAULT_Z_AXIS_SETTINGS: ZAxisSettings = {
	enabled: false,
	// Voron 2.4-style flying gantry: four belt-driven Z motors, 80:16 reduction, 20T GT2
	drive: 'belt',
	motorCount: 4,
	liftedMass: 3000 as Grams,
	acceleration: 350 as MillimetersPerSecondSquared,
	guideFrictionN: 0,
	gearRatio: 5,
	screwDiameter: 8,
	screwPitch: 2,
	screwLead: 8,
	screwLength: 350,
	nutFriction: 0.18,
	ballScrewEfficiency: 0.9,
	pulleyTeeth: 20,
	toothPitch: 2,
	detentFraction: 0.05
};

const zNum = (fallback: number, min = 0) => z.number().min(min).catch(fallback);

export const ZAxisSettingsSchema = z.object({
	enabled: z.boolean().catch(DEFAULT_Z_AXIS_SETTINGS.enabled),
	drive: ZDriveType.catch(DEFAULT_Z_AXIS_SETTINGS.drive),
	motorCount: z.number().int().min(1).max(8).catch(DEFAULT_Z_AXIS_SETTINGS.motorCount),
	liftedMass: Grams.catch(DEFAULT_Z_AXIS_SETTINGS.liftedMass),
	acceleration: MillimetersPerSecondSquared.catch(DEFAULT_Z_AXIS_SETTINGS.acceleration),
	guideFrictionN: zNum(DEFAULT_Z_AXIS_SETTINGS.guideFrictionN),
	gearRatio: zNum(DEFAULT_Z_AXIS_SETTINGS.gearRatio, 0.01),
	screwDiameter: zNum(DEFAULT_Z_AXIS_SETTINGS.screwDiameter, 1),
	screwPitch: zNum(DEFAULT_Z_AXIS_SETTINGS.screwPitch, 0.1),
	screwLead: zNum(DEFAULT_Z_AXIS_SETTINGS.screwLead, 0.1),
	screwLength: zNum(DEFAULT_Z_AXIS_SETTINGS.screwLength),
	nutFriction: zNum(DEFAULT_Z_AXIS_SETTINGS.nutFriction),
	ballScrewEfficiency: z.number().gt(0).max(1).catch(DEFAULT_Z_AXIS_SETTINGS.ballScrewEfficiency),
	pulleyTeeth: zNum(DEFAULT_Z_AXIS_SETTINGS.pulleyTeeth, 1),
	toothPitch: zNum(DEFAULT_Z_AXIS_SETTINGS.toothPitch, 0.1),
	detentFraction: z.number().min(0).max(1).catch(DEFAULT_Z_AXIS_SETTINGS.detentFraction)
}) satisfies z.ZodType<ZAxisSettings>;
