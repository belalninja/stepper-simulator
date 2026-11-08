import { AttributionCard } from '@/components/attribution';
import { Graph } from '@/components/graph';
import { ImportWarning } from '@/components/import-warning';
import { DriveSettings, GantrySettings, ZAxisSettingsCard } from '@/components/settings';
import { ShareConfigButton } from '@/components/share-config';
import { StepperSpecsCard } from '@/components/specs';
import { StepperSelection } from '@/components/stepper-management';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { track } from '@/lib/analytics';
import { clearUrlConfig, parseConfigFromUrl } from '@/lib/share-url';
import type { StepperDefinition } from '@/lib/stepper';
import {
	currentZAxisSettingsAtom,
	loadImportedConfigurationAtom,
	steppersAtom,
	unresolvedImportedSteppersAtom
} from '@/state/atoms';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

export function App() {
	const steppers = useAtomValue(steppersAtom);
	// XY gantry settings do not apply while the graph shows the Z axis
	const zMode = useAtomValue(currentZAxisSettingsAtom).enabled;
	const loadImportedConfig = useSetAtom(loadImportedConfigurationAtom);
	const setUnresolvedSteppers = useSetAtom(unresolvedImportedSteppersAtom);

	useEffect(() => {
		const imported = parseConfigFromUrl();
		if (imported) {
			loadImportedConfig(imported.config);
			setUnresolvedSteppers(imported.unresolvedSteppers);
			clearUrlConfig();
			track('Shared Config Opened', {
				steppers: imported.config.selectedSteppers.length,
				unresolved: imported.unresolvedSteppers.length
			});
		}
	}, [loadImportedConfig, setUnresolvedSteppers]);

	return (
		// Phones get one column in the order people use it: pick motors, read the graph, tune the
		// settings, then the per-motor details. `max-md:contents` lets the main column's children
		// take part in that order; desktop keeps the two-column layout.
		<div className="flex max-md:flex-col gap-2 p-2 max-w-7xl mx-auto">
			<div className="md:hidden flex flex-col gap-2 max-md:order-1">
				<ImportWarning />
				<StepperSelection />
			</div>
			<div className="md:hidden flex flex-col gap-2 w-full max-md:order-3">
				<DriveSettings />
				<ZAxisSettingsCard />
				{!zMode && <GantrySettings />}
			</div>

			<div className="max-md:contents md:flex md:flex-col gap-2 w-full md:w-2/3">
				<Card className="max-md:order-4">
					<CardHeader className="flex flex-wrap justify-between items-center gap-2">
						<CardTitle>Steppers</CardTitle>
						<ShareConfigButton />
					</CardHeader>
					<CardContent className="flex flex-wrap gap-2">
						{steppers.map((stepper: StepperDefinition) => (
							<StepperSpecsCard
								showRemoveButton
								key={`${stepper.brand}|${stepper.model}`}
								stepper={stepper}
							/>
						))}
					</CardContent>
				</Card>
				<div className="max-md:order-2 min-w-0">
					<Graph />
				</div>
			</div>
			<div className="hidden md:flex flex-row md:flex-col gap-2 w-full md:w-1/3">
				<ImportWarning />

				<StepperSelection />
				<DriveSettings />
				<ZAxisSettingsCard />
				{!zMode && <GantrySettings />}

				<AttributionCard className="max-md:hidden" />
			</div>

			<AttributionCard className="block md:hidden max-md:order-5" />
		</div>
	);
}
