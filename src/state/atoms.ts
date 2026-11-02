import {
	DEFAULT_DEBUG,
	DEFAULT_DRIVE_SETTINGS,
	DEFAULT_GANTRY_SETTINGS,
	type DriveSettings,
	DriveSettingsSchema,
	type GantrySettings,
	GantrySettingsSchema,
	type ShareableConfiguration
} from '@/lib/configuration';
import { StepperDefinition } from '@/lib/stepper';
import { STEPPER_DB } from '@/lib/stepper-db';
import { atom } from 'jotai';
import z from 'zod/v4';

type SetStateAction<T> = T | ((prev: T) => T);

// The configuration shape itself lives in `@/lib/configuration` so the server can import it
// without pulling in this module's `localStorage` access. Re-exported for the app's convenience
export {
	DEFAULT_DEBUG,
	DEFAULT_DRIVE_SETTINGS,
	DEFAULT_GANTRY_SETTINGS,
	type DriveSettings,
	type GantrySettings,
	type ShareableConfiguration
};

export const isImportedConfigAtom = atom<boolean>(false);
export const showImportWarningAtom = atom<boolean>(false);
/** Ids (`brand|model`) referenced by an imported link that could not be resolved */
export const unresolvedImportedSteppersAtom = atom<string[]>([]);

function atomWithLocalStorage<T>(key: string, initialValue: T, schema?: z.ZodType<T>) {
	const getInitialValue = () => {
		let parsed: unknown;
		try {
			const item = localStorage.getItem(key);
			if (item === null) return initialValue;
			parsed = JSON.parse(item);
		} catch {
			// Blocked storage or a corrupt entry: start from the default instead of crashing
			return initialValue;
		}
		if (schema) {
			const result = schema.safeParse(parsed);
			return result.success ? result.data : initialValue;
		}
		if (typeof initialValue === 'object' && initialValue !== null && !Array.isArray(initialValue)) {
			return { ...initialValue, ...(parsed as T) };
		}
		return parsed as T;
	};
	const baseAtom = atom(getInitialValue());
	const derivedAtom = atom(
		(get) => get(baseAtom),
		(get, set, update) => {
			const nextValue = typeof update === 'function' ? update(get(baseAtom)) : update;
			set(baseAtom, nextValue);
			try {
				localStorage.setItem(key, JSON.stringify(nextValue));
			} catch {
				// Storage full or blocked: the value still lives for this session
			}
		}
	);
	return derivedAtom;
}

export type SearchMode = 'exact' | 'fuzzy';
export const searchModeAtom = atomWithLocalStorage<SearchMode>('searchMode', 'fuzzy');

export type ViewMode = 'table' | 'cards';
export const viewModeAtom = atomWithLocalStorage<ViewMode>('viewMode', 'cards');

export const filtersCollapsedAtom = atomWithLocalStorage<boolean>('filtersCollapsed', false);

// Persisted layer: private on purpose. Components must use the `current*` atoms so
// imported (shared-link) configs are respected
const debugAtom = atomWithLocalStorage<boolean>('debug', DEFAULT_DEBUG);
const driveSettingsAtom = atomWithLocalStorage<DriveSettings>(
	'driveSettings',
	DEFAULT_DRIVE_SETTINGS,
	DriveSettingsSchema
);
const gantrySettingsAtom = atomWithLocalStorage<GantrySettings>(
	'gantrySettings',
	DEFAULT_GANTRY_SETTINGS,
	GantrySettingsSchema
);
/**
 * Loads saved custom steppers one entry at a time, so a single malformed entry (for example from an
 * older version) is dropped instead of wiping the whole list
 */
const SavedCustomSteppers = z.array(z.unknown()).transform((items) =>
	items.flatMap((item) => {
		const result = StepperDefinition.safeParse({ comments: [], ...(item as object) });
		return result.success ? [result.data] : [];
	})
);
const rawCustomSteppersAtom = atomWithLocalStorage<StepperDefinition[]>(
	'customSteppers',
	[],
	SavedCustomSteppers as unknown as z.ZodType<StepperDefinition[]>
);
const customSteppersAtom = atom(
	(get) => {
		const steppers = get(rawCustomSteppersAtom);

		return steppers.map(
			(stepper) => ({ ...stepper, comments: stepper.comments ?? [] }) satisfies StepperDefinition
		);
	},
	(_get, set, value) => set(rawCustomSteppersAtom, value)
);

const tempDriveSettingsAtom = atom<DriveSettings | null>(null);
const tempGantrySettingsAtom = atom<GantrySettings | null>(null);
const tempCustomSteppersAtom = atom<StepperDefinition[] | null>(null);
const tempDebugAtom = atom<boolean | null>(null);

export const currentDriveSettingsAtom = atom(
	(get) => {
		const isImported = get(isImportedConfigAtom);
		const temp = get(tempDriveSettingsAtom);
		return isImported && temp ? temp : get(driveSettingsAtom);
	},
	(get, set, update: SetStateAction<DriveSettings>) => {
		const isImported = get(isImportedConfigAtom);
		const temp = get(tempDriveSettingsAtom);
		const prev = isImported && temp ? temp : get(driveSettingsAtom);
		const nextValue =
			typeof update === 'function' ? (update as (prev: DriveSettings) => DriveSettings)(prev) : update;

		if (isImported) {
			set(tempDriveSettingsAtom, nextValue);
		} else {
			set(driveSettingsAtom, nextValue);
		}
	}
);

export const currentGantrySettingsAtom = atom(
	(get) => {
		const isImported = get(isImportedConfigAtom);
		const temp = get(tempGantrySettingsAtom);
		return isImported && temp ? temp : get(gantrySettingsAtom);
	},
	(get, set, update: SetStateAction<GantrySettings>) => {
		const isImported = get(isImportedConfigAtom);
		const temp = get(tempGantrySettingsAtom);
		const prev = isImported && temp ? temp : get(gantrySettingsAtom);
		const nextValue =
			typeof update === 'function' ? (update as (prev: GantrySettings) => GantrySettings)(prev) : update;

		if (isImported) {
			set(tempGantrySettingsAtom, nextValue);
		} else {
			set(gantrySettingsAtom, nextValue);
		}
	}
);

export const currentCustomSteppersAtom = atom(
	(get) => {
		const isImported = get(isImportedConfigAtom);
		const temp = get(tempCustomSteppersAtom);
		return isImported && temp ? temp : get(customSteppersAtom);
	},
	(get, set, update: SetStateAction<StepperDefinition[]>) => {
		const isImported = get(isImportedConfigAtom);
		const temp = get(tempCustomSteppersAtom);
		const prev = isImported && temp ? temp : get(customSteppersAtom);
		const nextValue =
			typeof update === 'function'
				? (update as (prev: StepperDefinition[]) => StepperDefinition[])(prev)
				: update;

		if (isImported) {
			set(tempCustomSteppersAtom, nextValue);
		} else {
			set(customSteppersAtom, nextValue);
		}
	}
);

export const currentDebugAtom = atom(
	(get) => {
		const isImported = get(isImportedConfigAtom);
		const temp = get(tempDebugAtom);
		return isImported && temp !== null ? temp : get(debugAtom);
	},
	(get, set, update: SetStateAction<boolean>) => {
		const isImported = get(isImportedConfigAtom);
		const temp = get(tempDebugAtom);
		const prev = isImported && temp !== null ? temp : get(debugAtom);
		const nextValue = typeof update === 'function' ? (update as (prev: boolean) => boolean)(prev) : update;

		if (isImported) {
			set(tempDebugAtom, nextValue);
		} else {
			set(debugAtom, nextValue);
		}
	}
);

const stepperId = (stepper: Pick<StepperDefinition, 'brand' | 'model'>) => `${stepper.brand}|${stepper.model}`;

/** Ids (`brand|model`) of the selected steppers, so the selection survives a reload */
const savedSelectionAtom = atomWithLocalStorage<string[]>('selectedSteppers', [], z.array(z.string()));

function resolveSelection(ids: string[], customSteppers: StepperDefinition[]): StepperDefinition[] {
	const byId = new Map<string, StepperDefinition>();
	for (const models of STEPPER_DB.values())
		for (const stepper of models.values()) byId.set(stepperId(stepper), stepper);
	// Custom steppers win over database entries with the same name, as in the selection list
	for (const stepper of customSteppers) byId.set(stepperId(stepper), stepper);
	return ids.flatMap((id) => byId.get(id) ?? []);
}

/** `null` until the selection changes this session; until then it is restored from storage */
const sessionSelectionAtom = atom<StepperDefinition[] | null>(null);

export const steppersAtom = atom(
	(get) => get(sessionSelectionAtom) ?? resolveSelection(get(savedSelectionAtom), get(customSteppersAtom)),
	(get, set, update: SetStateAction<StepperDefinition[]>) => {
		const prev = get(steppersAtom);
		const next =
			typeof update === 'function'
				? (update as (prev: StepperDefinition[]) => StepperDefinition[])(prev)
				: update;
		set(sessionSelectionAtom, next);
		// An imported (shared-link) selection is only kept once the user saves that configuration
		if (!get(isImportedConfigAtom)) set(savedSelectionAtom, next.map(stepperId));
	}
);

export const getCurrentConfigurationAtom = atom<ShareableConfiguration>((get) => ({
	driveSettings: get(currentDriveSettingsAtom),
	gantrySettings: get(currentGantrySettingsAtom),
	customSteppers: get(currentCustomSteppersAtom),
	debug: get(currentDebugAtom),
	selectedSteppers: get(steppersAtom)
}));

export const loadImportedConfigurationAtom = atom(null, (_get, set, config: ShareableConfiguration) => {
	set(tempDriveSettingsAtom, config.driveSettings);
	set(tempGantrySettingsAtom, config.gantrySettings);
	set(tempCustomSteppersAtom, config.customSteppers);
	set(tempDebugAtom, config.debug);
	set(sessionSelectionAtom, config.selectedSteppers);

	set(isImportedConfigAtom, true);
	set(showImportWarningAtom, true);
});

export const saveImportedConfigurationAtom = atom(null, (get, set) => {
	const driveSettings = get(tempDriveSettingsAtom);
	const gantrySettings = get(tempGantrySettingsAtom);
	const customSteppers = get(tempCustomSteppersAtom);
	const debug = get(tempDebugAtom);

	if (driveSettings) set(driveSettingsAtom, driveSettings);
	if (gantrySettings) set(gantrySettingsAtom, gantrySettings);
	if (customSteppers) set(customSteppersAtom, customSteppers);
	if (debug !== null) set(debugAtom, debug);
	set(savedSelectionAtom, get(steppersAtom).map(stepperId));

	set(tempDriveSettingsAtom, null);
	set(tempGantrySettingsAtom, null);
	set(tempCustomSteppersAtom, null);
	set(tempDebugAtom, null);

	set(isImportedConfigAtom, false);
	set(showImportWarningAtom, false);
});
