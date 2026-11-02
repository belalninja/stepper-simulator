import type { Ampere } from '@/lib/stepper';
import z from 'zod/v4';

/**
 * Two current conventions live in the app:
 * - Drive current (`DriveSettings.maxDriveCurrent`) is stored as the per-phase sine **peak**
 *   amplitude. Firmware (TMC `run_current` in Klipper, etc.) uses RMS, so the UI converts at the
 *   boundary with the helpers below.
 * - Motor rated current (`StepperDefinition.ratedCurrent`) is the datasheet "rated current per
 *   phase", entered as printed. It is the DC current both phases carry in the holding-torque test,
 *   which is thermally equivalent to the same value in RMS. Its sine peak is `ratedCurrent * √2`.
 */
export const CurrentUnit = z.enum(['peak', 'rms']);
export type CurrentUnit = z.infer<typeof CurrentUnit>;

export const CURRENT_UNIT_LABEL: Record<CurrentUnit, string> = {
	peak: 'A peak',
	rms: 'A RMS'
};

export const peakToUnit = (peak: Ampere, unit: CurrentUnit): Ampere =>
	(unit === 'rms' ? peak / Math.SQRT2 : peak) as Ampere;

export const unitToPeak = (value: Ampere, unit: CurrentUnit): Ampere =>
	(unit === 'rms' ? value * Math.SQRT2 : value) as Ampere;

export const formatCurrent = (value: number, digits = 2) => Number(value.toFixed(digits));
