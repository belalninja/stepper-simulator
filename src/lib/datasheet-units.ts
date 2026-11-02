/**
 * Units that stepper datasheets commonly print, with factors to the units the simulator stores
 * (N·cm for torque, g·cm² for rotor inertia). Lets a custom motor be typed in exactly as printed.
 */

export const TORQUE_UNITS = {
	Ncm: { label: 'N·cm', toNcm: 1 },
	Nm: { label: 'N·m', toNcm: 100 },
	mNm: { label: 'mN·m', toNcm: 0.1 },
	kgfcm: { label: 'kgf·cm (kg·cm)', toNcm: 9.80665 },
	ozfin: { label: 'oz·in (ozf·in)', toNcm: 0.706155181 }
} as const;
export type TorqueUnit = keyof typeof TORQUE_UNITS;

export const INERTIA_UNITS = {
	gcm2: { label: 'g·cm²', toGcm2: 1 },
	kgcm2: { label: 'kg·cm²', toGcm2: 1000 },
	kgm2: { label: 'kg·m²', toGcm2: 1e7 },
	ozin2: { label: 'oz·in²', toGcm2: 182.8997 }
} as const;
export type InertiaUnit = keyof typeof INERTIA_UNITS;

export const torqueToNcm = (value: number, unit: TorqueUnit) => value * TORQUE_UNITS[unit].toNcm;
export const inertiaToGcm2 = (value: number, unit: InertiaUnit) => value * INERTIA_UNITS[unit].toGcm2;
