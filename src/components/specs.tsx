import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator';
import {
	calculateDriveCurrent,
	calculatePowerAtDriveCurrent,
	calculateRotorTorqueForMode,
	calculateSingleCoilTorque,
	calculateStandstillCurrent
} from '@/lib/formulas';
import type { StepperDefinition } from '@/lib/stepper';
import { currentDebugAtom, currentDriveSettingsAtom, currentGantrySettingsAtom, steppersAtom } from '@/state/atoms';
import { useAtomValue, useSetAtom } from 'jotai';
import {
	BicepsFlexedIcon,
	CircuitBoardIcon,
	MessageSquareIcon,
	OmegaIcon,
	RedoDotIcon,
	RulerDimensionLineIcon,
	TriangleAlertIcon,
	TriangleRightIcon,
	XIcon,
	ZapIcon
} from 'lucide-react';

const OVERDRIVE_TOLERANCE = 1.001;

export function StepperSpecs({ stepper }: { stepper: StepperDefinition }) {
	const debug = useAtomValue(currentDebugAtom);
	const driveSettings = useAtomValue(currentDriveSettingsAtom);

	const driveCurrent = calculateDriveCurrent(driveSettings);
	const ratedPeakCurrent = stepper.ratedCurrent * Math.SQRT2;
	const overdriven = driveCurrent > ratedPeakCurrent * OVERDRIVE_TOLERANCE;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<RulerDimensionLineIcon />
				<span>
					NEMA {stepper.nemaSize} x {stepper.bodyLength} mm
				</span>
			</div>
			<div className="flex items-center gap-2">
				<TriangleRightIcon />
				<span>{stepper.stepAngle}°</span>
			</div>
			<div className="flex items-center gap-2">
				<ZapIcon />
				<span>
					{stepper.ratedCurrent.toFixed(1)} A rated ({ratedPeakCurrent.toFixed(2)} A peak)
				</span>
			</div>
			{overdriven && (
				<span className="flex items-start gap-1.5 text-xs text-muted-foreground">
					<TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-amber-500" />
					Out of spec: driven at {driveCurrent.toFixed(2)} A peak (
					{Math.round((driveCurrent / ratedPeakCurrent) * 100)}% of rated). This is extrapolated! Monitor your
					stepper temperatures closely!
				</span>
			)}
			<div className="flex items-center gap-2">
				<BicepsFlexedIcon />
				<span>{stepper.torque.toFixed(1)} Ncm</span>
			</div>
			<div className="flex items-center gap-2">
				<CircuitBoardIcon />
				<span>{stepper.inductance.toFixed(1)} mH</span>
			</div>
			<div className="flex items-center gap-2">
				<OmegaIcon />
				<span>{stepper.resistance.toFixed(1)} Ω</span>
			</div>
			<div className="flex items-center gap-2">
				<RedoDotIcon />
				<span>{stepper.rotorInertia.toFixed(1)} gcm²</span>
			</div>
			{stepper.comments.length > 0 && (
				<div className="flex">
					<MessageSquareIcon />
					<ul className="list-disc list-outside pl-6">
						{stepper.comments.map((comment) => (
							<li key={comment}>{comment}</li>
						))}
					</ul>
				</div>
			)}

			{debug && <DebugStepperSpecs stepper={stepper} />}
		</div>
	);
}

function DebugStepperSpecs({ stepper }: { stepper: StepperDefinition }) {
	const driveSettings = useAtomValue(currentDriveSettingsAtom);
	const gantrySettings = useAtomValue(currentGantrySettingsAtom);
	const driveCurrent = calculateDriveCurrent(driveSettings);
	const standstillCurrent = calculateStandstillCurrent(driveSettings, stepper);
	const supplyLimited = standstillCurrent < driveCurrent;
	const rotor = calculateRotorTorqueForMode(gantrySettings, stepper);
	const rotorLabel =
		rotor.thetaRad === null
			? 'torque rotor'
			: `torque rotor (motor A @ ${((rotor.thetaRad * 180) / Math.PI).toFixed(1)}°)`;
	const copperLoss = calculatePowerAtDriveCurrent(standstillCurrent, stepper);
	// Per-phase torque constant from the datasheet: Kt = T_hold / (√2 · I_rated), N·m per A peak.
	// Numerically equal to the back-EMF constant in V·s/rad, so 2π·Kt is volts per rev/s.
	const kt = stepper.torque / 100 / (Math.SQRT2 * stepper.ratedCurrent);
	const derating = driveSettings.torqueDerating;
	const torqueAt = (rps: number) =>
		derating *
		calculateSingleCoilTorque(
			driveSettings.motorModel,
			stepper.stepAngle,
			stepper.ratedCurrent,
			stepper.torque,
			stepper.inductance,
			stepper.resistance,
			driveSettings.inputVoltage,
			driveCurrent,
			rps
		);
	const standstillTorque = torqueAt(0);
	// Highest speed (motor rev/s) that still gets the full standstill torque, by bisection
	const fullTorqueRps = (() => {
		const limit = 200;
		if (torqueAt(limit) >= standstillTorque * 0.999) return null;
		let lo = 0;
		let hi = limit;
		for (let i = 0; i < 50; i++) {
			const mid = (lo + hi) / 2;
			if (torqueAt(mid) >= standstillTorque * 0.999) lo = mid;
			else hi = mid;
		}
		return lo;
	})();

	return (
		<>
			<Separator />

			<div className="flex items-center gap-2">
				<span>drive current</span>
				<span>{driveCurrent.toFixed(2)} A peak</span>
			</div>
			<div className="flex items-center gap-2">
				<span>standstill current (min of drive, V/R)</span>
				<span>
					{standstillCurrent.toFixed(2)} A peak{supplyLimited && ' (supply-limited)'}
				</span>
			</div>
			<div className="flex items-center gap-2">
				<span>{rotorLabel}</span>
				<span>{rotor.torqueNcm.toFixed(2)} Ncm</span>
			</div>
			<div className="flex items-center gap-2">
				<span>copper loss at standstill</span>
				<span>{copperLoss.toFixed(2)} W</span>
			</div>
			<div className="flex items-center gap-2">
				<span>torque constant Kt</span>
				<span>
					{kt.toFixed(4)} N·m/A pk · back-EMF {(2 * Math.PI * kt).toFixed(2)} V per rev/s
				</span>
			</div>
			<div className="flex items-center gap-2">
				<span>available at standstill{derating !== 1 && ` (×${derating.toFixed(2)} calibration)`}</span>
				<span>{standstillTorque.toFixed(2)} Ncm</span>
			</div>
			<div className="flex items-center gap-2">
				<span>full torque up to</span>
				<span>
					{fullTorqueRps === null
						? '> 200 rev/s'
						: `${fullTorqueRps.toFixed(1)} rev/s (${Math.round(fullTorqueRps * 60)} RPM)`}
				</span>
			</div>
		</>
	);
}

export function StepperSpecsCard({
	stepper,
	showRemoveButton = false
}: {
	stepper: StepperDefinition;
	showRemoveButton?: boolean;
}) {
	const setSteppers = useSetAtom(steppersAtom);

	return (
		<Card className="w-full sm:w-[calc(50%-0.25rem)] xl:w-[calc(33.333%-0.5rem)]">
			<CardHeader>
				<CardTitle>
					{stepper.brand} {stepper.model}
				</CardTitle>
			</CardHeader>
			<CardContent className="flex-1">
				<StepperSpecs stepper={stepper} />
			</CardContent>
			<CardFooter className="flex justify-end gap-2">
				{showRemoveButton && (
					<Button
						type="button"
						variant="destructive"
						size="icon"
						onClick={() =>
							setSteppers((previous) =>
								previous.filter((s) => s.brand !== stepper.brand || s.model !== stepper.model)
							)
						}
					>
						<XIcon />
					</Button>
				)}
			</CardFooter>
		</Card>
	);
}
