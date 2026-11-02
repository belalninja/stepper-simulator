import assert from 'node:assert';
import type { StepperDefinition } from '../src/lib/stepper';

/**
 * Checks that custom steppers and the stepper selection survive a reload, that deleting works,
 * that bad storage never crashes the app, and that a shared link does not overwrite saved state.
 * A "reload" is a fresh import of the atoms module against the same fake localStorage.
 */

const storage = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => void storage.set(key, String(value)),
	removeItem: (key: string) => void storage.delete(key),
	clear: () => storage.clear()
};

let generation = 0;
async function openApp() {
	// A query string makes Node load a fresh copy of the module, like a page reload
	const atoms = (await import(`../src/state/atoms.ts?reload=${generation++}`)) as typeof import('../src/state/atoms');
	const { createStore } = await import('jotai');
	return { atoms, store: createStore() };
}

const custom = (brand: string, model: string, torque = 40): StepperDefinition =>
	({
		brand,
		model,
		nemaSize: 17,
		bodyLength: 40,
		stepAngle: 1.8,
		ratedCurrent: 1.5,
		torque,
		inductance: 3,
		resistance: 1.5,
		rotorInertia: 54,
		comments: []
	}) as unknown as StepperDefinition;

const ids = (list: StepperDefinition[]) => list.map((s) => `${s.brand}|${s.model}`).sort();

console.log('🧪 Persistence checks\n');

// 1. Add two custom steppers of the same brand, select one, reload
{
	const { atoms, store } = await openApp();
	store.set(atoms.currentCustomSteppersAtom, [custom('LDO', 'MyA'), custom('LDO', 'MyB')]);
	store.set(atoms.steppersAtom, [custom('LDO', 'MyA')]);
}
{
	const { atoms, store } = await openApp();
	assert.deepStrictEqual(ids(store.get(atoms.currentCustomSteppersAtom)), ['LDO|MyA', 'LDO|MyB']);
	assert.deepStrictEqual(ids(store.get(atoms.steppersAtom)), ['LDO|MyA'], 'selection must be restored');
	console.log('✅ custom steppers and selection survive a reload');

	// 2. Delete MyA only (the old filter removed every LDO entry)
	store.set(atoms.currentCustomSteppersAtom, (prev: StepperDefinition[]) =>
		prev.filter((s) => !(s.brand === 'LDO' && s.model === 'MyA'))
	);
	store.set(atoms.steppersAtom, (prev: StepperDefinition[]) => prev.filter((s) => s.model !== 'MyA'));
}
{
	const { atoms, store } = await openApp();
	assert.deepStrictEqual(ids(store.get(atoms.currentCustomSteppersAtom)), ['LDO|MyB']);
	assert.deepStrictEqual(ids(store.get(atoms.steppersAtom)), []);
	console.log('✅ deleting one custom stepper keeps the others, and stays deleted after a reload');
}

// 3. A selected custom stepper that was deleted in another tab simply drops out of the selection
storage.set('selectedSteppers', JSON.stringify(['LDO|Gone', 'LDO|MyB']));
{
	const { atoms, store } = await openApp();
	assert.deepStrictEqual(ids(store.get(atoms.steppersAtom)), ['LDO|MyB']);
	console.log('✅ selection ignores steppers that no longer exist');
}

// 4. A malformed entry is dropped without losing the valid ones; invalid JSON does not crash
storage.set('customSteppers', JSON.stringify([{ brand: 'Broken' }, custom('Moons', 'Good')]));
{
	const { atoms, store } = await openApp();
	assert.deepStrictEqual(ids(store.get(atoms.currentCustomSteppersAtom)), ['Moons|Good']);
}
storage.set('customSteppers', '{not json');
{
	const { atoms, store } = await openApp();
	assert.deepStrictEqual(store.get(atoms.currentCustomSteppersAtom), []);
	console.log('✅ bad storage is tolerated: malformed entries dropped, invalid JSON falls back to empty');
}

// 5. Opening a shared link does not overwrite saved custom steppers or selection until saved
storage.set('customSteppers', JSON.stringify([custom('Mine', 'Saved')]));
storage.set('selectedSteppers', JSON.stringify(['Mine|Saved']));
{
	const { atoms, store } = await openApp();
	const { DEFAULT_DRIVE_SETTINGS, DEFAULT_GANTRY_SETTINGS } = await import('../src/lib/configuration');
	store.set(atoms.loadImportedConfigurationAtom, {
		driveSettings: DEFAULT_DRIVE_SETTINGS,
		gantrySettings: DEFAULT_GANTRY_SETTINGS,
		customSteppers: [custom('Theirs', 'Shared')],
		debug: false,
		selectedSteppers: [custom('Theirs', 'Shared')]
	});
	assert.deepStrictEqual(ids(store.get(atoms.steppersAtom)), ['Theirs|Shared']);
	store.set(atoms.steppersAtom, []);
}
{
	const { atoms, store } = await openApp();
	assert.deepStrictEqual(ids(store.get(atoms.currentCustomSteppersAtom)), ['Mine|Saved']);
	assert.deepStrictEqual(ids(store.get(atoms.steppersAtom)), ['Mine|Saved']);
	console.log('✅ a shared link leaves saved custom steppers and selection alone');
}

console.log('\n🎉 Persistence checks passed');
