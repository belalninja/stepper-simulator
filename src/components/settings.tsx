import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { track } from '@/lib/analytics';
import { fitTorqueDerating, stepperSeriesKey } from '@/lib/torque-curve';
import type { CoreXYDirectionMode, KinematicsMode } from '@/lib/configuration';
import { CURRENT_UNIT_LABEL, type CurrentUnit, formatCurrent, peakToUnit, unitToPeak } from '@/lib/current-unit';
import {
	calculateCoreXYPeakTorqueAngleRad,
	calculateGearRatio,
	calculatePulleyRadiusM,
	calculateRequiredTorque,
	type MotorModel
} from '@/lib/formulas';
import type { Ampere, Degree, Grams, MillimetersPerSecondSquared, NewtonCentimeter, Volts } from '@/lib/stepper';
import { currentDebugAtom, currentDriveSettingsAtom, currentGantrySettingsAtom, steppersAtom } from '@/state/atoms';
import { useAtom, useAtomValue } from 'jotai';
import { useState } from 'react';
import {
	ArrowRightFromLineIcon,
	CogIcon,
	CompassIcon,
	CpuIcon,
	GaugeIcon,
	LayersIcon,
	PlugIcon,
	ShieldCheckIcon,
	SlidersHorizontalIcon,
	SplitIcon,
	TriangleAlertIcon,
	WeightIcon,
	ZapIcon
} from 'lucide-react';

export function DriveSettings() {
	const [driveSettings, setDriveSettings] = useAtom(currentDriveSettingsAtom);
	const currentUnit = driveSettings.currentUnit ?? 'peak';

	return (
		<Card className="w-full">
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>Drive Settings</CardTitle>
				</div>
			</CardHeader>
			<CardContent className="space-y-2">
				<div className="flex w-full max-w-sm items-center gap-2">
					<div className="size-5">
						<PlugIcon className="w-5 h-5" />
					</div>
					<NumberInput
						placeholder="Input Voltage"
						min={8}
						value={driveSettings.inputVoltage}
						onValueChange={(v) => setDriveSettings({ ...driveSettings, inputVoltage: v as Volts })}
					/>
					<span>V</span>
				</div>
				<div className="flex w-full max-w-sm flex-col gap-1">
					<div className="flex w-full items-center gap-2">
						<div className="size-5">
							<ZapIcon className="w-5 h-5" />
						</div>
						<NumberInput
							placeholder={`Max Drive Current (${CURRENT_UNIT_LABEL[currentUnit]}, per phase)`}
							min={0}
							max={5}
							step="0.01"
							value={formatCurrent(peakToUnit(driveSettings.maxDriveCurrent, currentUnit))}
							onValueChange={(v) =>
								setDriveSettings({
									...driveSettings,
									maxDriveCurrent: unitToPeak(v as Ampere, currentUnit)
								})
							}
						/>
						<ToggleGroup
							type="single"
							variant="outline"
							size="sm"
							value={currentUnit}
							onValueChange={(value) => {
								if (value === 'peak' || value === 'rms') {
									setDriveSettings({ ...driveSettings, currentUnit: value satisfies CurrentUnit });
									track('Current Unit Changed', { unit: value });
								}
							}}
						>
							<ToggleGroupItem value="peak">Peak</ToggleGroupItem>
							<ToggleGroupItem value="rms">RMS</ToggleGroupItem>
						</ToggleGroup>
					</div>
					<span className="flex items-start gap-1.5 pl-7 text-xs text-muted-foreground">
						<TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-amber-500" />
						{currentUnit === 'rms'
							? 'RMS is what Klipper / TMC drivers take as run_current. Rated currents in the stepper DB are standard datasheet DC/RMS ratings.'
							: 'Peak is 1.414× RMS. TMC run_current is RMS. Switch to RMS to enter your Klipper run_current directly.'}
					</span>
				</div>
				<div className="flex w-full max-w-sm items-start gap-2">
					<div className="size-5 pt-1.5">
						<CpuIcon className="w-5 h-5" />
					</div>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						spacing={1}
						className="flex-1 flex-col"
						value={driveSettings.motorModel}
						onValueChange={(value) => {
							if (value === 'classic' || value === 'spreadCycle' || value === 'fieldWeakening') {
								setDriveSettings({
									...driveSettings,
									motorModel: value satisfies MotorModel
								});
								track('Motor Model Changed', { model: value });
							}
						}}
					>
						<ToggleGroupItem value="classic" className="w-full">
							Classic (naive)
						</ToggleGroupItem>
						<ToggleGroupItem value="spreadCycle" className="w-full gap-1.5">
							SpreadCycle (TMC)
							<span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-muted-foreground/40 rounded px-1 py-px leading-none">
								alpha
							</span>
						</ToggleGroupItem>
						<ToggleGroupItem value="fieldWeakening" className="w-full gap-1.5">
							TMC4671 (FOC)
							<span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-muted-foreground/40 rounded px-1 py-px leading-none">
								alpha
							</span>
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
				<span className="block max-w-sm pl-7 text-[11px] text-muted-foreground">
					{MOTOR_MODEL_HINT[driveSettings.motorModel]}
				</span>

				<label className="flex w-full max-w-sm items-center justify-between gap-2 pl-7 text-sm">
					<span>Show Classic–SpreadCycle range</span>
					<Switch
						checked={driveSettings.showModelBand}
						onCheckedChange={(checked) => setDriveSettings({ ...driveSettings, showModelBand: checked })}
					/>
				</label>

				<Calibration />
			</CardContent>
		</Card>
	);
}

const MOTOR_MODEL_HINT: Record<MotorModel, string> = {
	classic:
		'Pessimistic floor. Simple chopper drivers (A4988, DRV8825) behave like this; use it as the lower bound for TMC drivers too.',
	spreadCycle:
		'TMC2209 / 2240 / 5160 in SpreadCycle mode: an optimistic ceiling. StealthChop is not modeled and makes less torque at speed, so run A/B motors in SpreadCycle (stealthchop_threshold: 0).',
	fieldWeakening: 'FOC servo drivers such as the TMC4671 only. TMC2209 / 2240 / 5160 cannot do field weakening.'
};

/**
 * Fits the torque derating factor from a speed test on the real printer: the speed at which the
 * motor started to skip, measured with exactly the settings entered here.
 */
function Calibration() {
	const [driveSettings, setDriveSettings] = useAtom(currentDriveSettingsAtom);
	const gantrySettings = useAtomValue(currentGantrySettingsAtom);
	const steppers = useAtomValue(steppersAtom);
	const [stepperKey, setStepperKey] = useState('');
	const [measured, setMeasured] = useState<number | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const stepper = steppers.find((s) => stepperSeriesKey(s) === stepperKey) ?? steppers[0];
	const factor = driveSettings.torqueDerating;

	const fit = () => {
		if (!stepper || !measured || measured <= 0) return;
		const result = fitTorqueDerating({ stepper, driveSettings, gantrySettings, measuredSkipSpeed: measured });
		if (result.ok) {
			setDriveSettings({ ...driveSettings, torqueDerating: result.factor });
			setMessage(
				`Your hardware makes ${Math.round(result.factor * 100)}% of the torque the ${driveSettings.motorModel === 'classic' ? 'Classic' : driveSettings.motorModel === 'spreadCycle' ? 'SpreadCycle' : 'FOC'} model predicts. Applied to every curve.`
			);
		} else {
			setMessage(
				result.reason === 'tooFast'
					? 'Even twice the modeled torque would skip below that speed. Check that masses, friction, acceleration and current match the test.'
					: 'Even a tenth of the modeled torque would not skip until above that speed. Check that the settings match the test.'
			);
		}
	};

	return (
		<div className="ml-7 flex max-w-sm flex-col gap-2 rounded-md border p-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">Calibrate from a real test</span>
				<Badge variant={factor === 1 ? 'secondary' : 'default'} className="text-xs tabular-nums">
					{factor === 1 ? 'Not calibrated' : `${factor.toFixed(2)}× torque`}
				</Badge>
			</div>
			<span className="text-[11px] text-muted-foreground">
				Run a speed test on the printer (for example Ellis' TEST_SPEED macro) with the settings entered here,
				raise the speed until the motor skips, and enter that speed. On CoreXY, use the worst-case envelope so
				every direction is covered.
			</span>
			{steppers.length === 0 ? (
				<span className="text-xs text-muted-foreground">Select the motor you tested first.</span>
			) : (
				<>
					{steppers.length > 1 && (
						<Select value={stepper ? stepperSeriesKey(stepper) : ''} onValueChange={setStepperKey}>
							<SelectTrigger className="w-full" aria-label="Motor used in the test">
								<SelectValue placeholder="Motor used in the test" />
							</SelectTrigger>
							<SelectContent>
								{steppers.map((s) => (
									<SelectItem key={stepperSeriesKey(s)} value={stepperSeriesKey(s)}>
										{stepperSeriesKey(s)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<div className="flex items-center gap-2">
						<NumberInput
							placeholder="Skip speed"
							aria-label="Measured skip speed"
							min={1}
							allowEmpty
							value={measured}
							onValueChange={(v) => setMeasured(v as number | null)}
						/>
						<span className="text-sm">mm/s</span>
						<Button size="sm" onClick={fit} disabled={!measured || measured <= 0}>
							Fit
						</Button>
					</div>
				</>
			)}
			{message && <span className="text-[11px]">{message}</span>}
			<div className="flex items-center gap-2">
				<span className="text-xs text-muted-foreground">Torque factor</span>
				<NumberInput
					aria-label="Torque derating factor"
					min={0.1}
					max={2}
					step={0.01}
					value={factor}
					onValueChange={(v) => {
						const next = typeof v === 'number' && v > 0 ? v : 1;
						setDriveSettings({ ...driveSettings, torqueDerating: next });
					}}
				/>
				<Button
					variant="ghost"
					size="sm"
					disabled={factor === 1}
					onClick={() => {
						setDriveSettings({ ...driveSettings, torqueDerating: 1 });
						setMessage(null);
					}}
				>
					Reset
				</Button>
			</div>
		</div>
	);
}

export function GantrySettings() {
	const [gantrySettings, setGantrySettings] = useAtom(currentGantrySettingsAtom);
	const debug = useAtomValue(currentDebugAtom);
	const gearRatio = calculateGearRatio(gantrySettings);
	const isCoreXY = gantrySettings.kinematicsMode === 'corexy';
	const pulleyRadiusMm = calculatePulleyRadiusM(gantrySettings) * 1000;
	const steppers = useAtomValue(steppersAtom);
	const toDeg = (rad: number) => (rad * 180) / Math.PI;
	const peakTorqueAngleDeg = toDeg(calculateCoreXYPeakTorqueAngleRad(gantrySettings, null));
	// θ* shifts toward 45° as rotor inertia grows, so show what the selected motors actually use
	const motorAnglesDeg = steppers.map((stepper) => toDeg(calculateCoreXYPeakTorqueAngleRad(gantrySettings, stepper)));
	const peakTorqueAngleLabel =
		motorAnglesDeg.length === 0
			? `${peakTorqueAngleDeg.toFixed(1)}° mass-only`
			: Math.max(...motorAnglesDeg) - Math.min(...motorAnglesDeg) < 0.05
				? `${motorAnglesDeg[0].toFixed(1)}°`
				: `${Math.min(...motorAnglesDeg).toFixed(1)}°–${Math.max(...motorAnglesDeg).toFixed(1)}° per motor`;

	return (
		<Card className="w-full">
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>Gantry Settings</CardTitle>
					<Badge variant={isCoreXY ? 'default' : 'secondary'} className="text-xs">
						{isCoreXY ? 'CoreXY' : 'Cartesian'}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{/* Kinematics Mode Switcher */}
				<div className="flex w-full max-w-sm flex-col gap-1.5">
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						className="w-full"
						value={gantrySettings.kinematicsMode}
						onValueChange={(val) => {
							if (val === 'cartesian' || val === 'corexy') {
								setGantrySettings({ ...gantrySettings, kinematicsMode: val as KinematicsMode });
								track('Kinematics Mode Changed', { mode: val });
							}
						}}
					>
						<ToggleGroupItem value="cartesian" className="flex-1 gap-1.5">
							<LayersIcon className="size-4" />
							<span>Cartesian</span>
						</ToggleGroupItem>
						<ToggleGroupItem value="corexy" className="flex-1 gap-1.5">
							<SplitIcon className="size-4" />
							<span>CoreXY</span>
						</ToggleGroupItem>
					</ToggleGroup>
				</div>

				{/* Pulley Teeth */}
				<div className="flex w-full max-w-sm items-center gap-2">
					<NumberInput
						placeholder="Pulley Teeth"
						value={gantrySettings.pulleyTeeth}
						onValueChange={(v) => setGantrySettings({ ...gantrySettings, pulleyTeeth: v as number })}
					/>
					<span>Teeth</span>
				</div>

				{/* Tooth Pitch */}
				<div className="flex w-full max-w-sm items-center gap-2">
					<Select
						value={String(gantrySettings.toothPitch)}
						onValueChange={(value) =>
							setGantrySettings({
								...gantrySettings,
								toothPitch: Number(value)
							})
						}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Tooth Pitch" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="1.5">GT1.5 (1.5mm)</SelectItem>
							<SelectItem value="2">GT2 (2mm)</SelectItem>
							<SelectItem value="3">GT3 (3mm)</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{/* Gearing: Relabeled with Reduction Badge */}
				<div className="flex w-full max-w-sm flex-col gap-1">
					<div className="flex w-full items-center gap-2">
						<div className="size-5">
							<CogIcon className="w-5 h-5" />
						</div>
						<div className="flex flex-1 items-center gap-1.5">
							<NumberInput
								placeholder="Pulley (Driven)"
								title="Driven gear teeth (pulley side)"
								value={gantrySettings.gearA}
								min={1}
								onValueChange={(v) => setGantrySettings({ ...gantrySettings, gearA: v as number })}
							/>
							<span className="font-bold">:</span>
							<NumberInput
								placeholder="Motor (Drive)"
								title="Drive gear teeth (motor side)"
								value={gantrySettings.gearB}
								min={1}
								onValueChange={(v) => setGantrySettings({ ...gantrySettings, gearB: v as number })}
							/>
						</div>
						<Badge variant="outline" className="text-[11px] whitespace-nowrap">
							{gearRatio === 1 ? '1:1 Direct' : `${gearRatio.toFixed(2)}:1`}
						</Badge>
					</div>
					<span className="pl-7 text-[11px] text-muted-foreground">
						Pulley gear : Motor gear (e.g. 60 : 20 or 3 : 1 for a 3:1 reduction)
					</span>
				</div>

				{/* Acceleration */}
				<div className="flex w-full max-w-sm items-center gap-2">
					<div className="size-5">
						<ArrowRightFromLineIcon className="w-5 h-5" />
					</div>
					<NumberInput
						placeholder="Acceleration"
						value={gantrySettings.acceleration}
						onValueChange={(v) =>
							setGantrySettings({ ...gantrySettings, acceleration: v as MillimetersPerSecondSquared })
						}
					/>
					<span>mm/s²</span>
				</div>

				{/* Mass Inputs (Conditional on Kinematics Mode) */}
				{!isCoreXY ? (
					<div className="flex w-full max-w-sm items-center gap-2">
						<div className="size-5">
							<WeightIcon className="w-5 h-5" />
						</div>
						<NumberInput
							placeholder="Toolhead and Y Axis Mass"
							value={gantrySettings.toolheadAndYAxisMass}
							onValueChange={(v) =>
								setGantrySettings({ ...gantrySettings, toolheadAndYAxisMass: v as Grams })
							}
						/>
						<span>g</span>
					</div>
				) : (
					<div className="flex w-full max-w-sm flex-col gap-2">
						<div className="flex w-full items-start gap-2">
							<div className="size-5 pt-1.5">
								<WeightIcon className="w-5 h-5" />
							</div>
							<div className="grid flex-1 grid-cols-2 gap-2">
								<div className="flex flex-col gap-1">
									<span className="text-[11px] text-muted-foreground">Toolhead (X & Y)</span>
									<NumberInput
										placeholder="Toolhead mh"
										value={gantrySettings.toolheadMass}
										onValueChange={(v) =>
											setGantrySettings({ ...gantrySettings, toolheadMass: v as Grams })
										}
									/>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-[11px] text-muted-foreground">Crossbeam (Y only)</span>
									<NumberInput
										placeholder="Crossbeam mb"
										value={gantrySettings.gantryBeamMass}
										onValueChange={(v) =>
											setGantrySettings({ ...gantrySettings, gantryBeamMass: v as Grams })
										}
									/>
								</div>
							</div>
							<span className="self-end pb-2">g</span>
						</div>
					</div>
				)}

				{/* CoreXY Direction Mode Selector */}
				{isCoreXY && (
					<div className="flex w-full max-w-sm flex-col gap-1.5">
						<div className="flex w-full items-center gap-2">
							<div className="size-5">
								<CompassIcon className="w-5 h-5" />
							</div>
							<Select
								value={gantrySettings.corexyDirectionMode}
								onValueChange={(value) =>
									setGantrySettings({
										...gantrySettings,
										corexyDirectionMode: value as CoreXYDirectionMode
									})
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Direction Mode" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="envelope">⚡ Worst-Case Envelope (0°–90°)</SelectItem>
									<SelectItem value="peakTorque">
										📐 Peak Torque Angle θ* ({peakTorqueAngleLabel})
									</SelectItem>
									<SelectItem value="diagonal45">↗️ 45° Diagonal (Max Motor Speed)</SelectItem>
									<SelectItem value="pureY">⬆️ 90° Pure Y (Toolhead + Beam)</SelectItem>
									<SelectItem value="pureX">➡️ 0° Pure X (Toolhead Only)</SelectItem>
									<SelectItem value="custom">🎛️ Custom Move Angle</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{gantrySettings.corexyDirectionMode === 'custom' && (
							<div className="flex w-full items-center gap-2 pl-7">
								<NumberInput
									placeholder="Angle"
									min={-360}
									max={360}
									value={gantrySettings.customAngleDeg}
									onValueChange={(v) =>
										setGantrySettings({ ...gantrySettings, customAngleDeg: v as Degree })
									}
								/>
								<span className="text-xs text-muted-foreground">
									degrees (0° = X, 90° = Y; other quadrants mirror onto 0°–90°)
								</span>
							</div>
						)}
					</div>
				)}

				{/* Friction Force */}
				<div className="flex w-full max-w-sm items-center gap-2">
					<div className="size-5">
						<SlidersHorizontalIcon className="w-5 h-5" />
					</div>
					<NumberInput
						placeholder="Coulomb Friction (optional)"
						min={0}
						step={0.1}
						value={gantrySettings.frictionForceN}
						onValueChange={(v) =>
							setGantrySettings({ ...gantrySettings, frictionForceN: (v as number) ?? 0 })
						}
					/>
					<span>N (friction)</span>
				</div>

				{/* Required Torque Override */}
				<div className="flex w-full max-w-sm items-center gap-2">
					<div className="size-5">
						<GaugeIcon className="w-5 h-5" />
					</div>
					<NumberInput
						placeholder="Required Torque (auto)"
						min={0}
						allowEmpty
						value={gantrySettings.manualRequiredTorque}
						onValueChange={(v) =>
							setGantrySettings({ ...gantrySettings, manualRequiredTorque: v as NewtonCentimeter | null })
						}
					/>
					<span>Ncm</span>
				</div>

				{/* Safety factor */}
				<div className="flex w-full max-w-sm flex-col gap-1">
					<div className="flex w-full items-center gap-2">
						<div className="size-5">
							<ShieldCheckIcon className="w-5 h-5" />
						</div>
						<NumberInput
							placeholder="Safety factor"
							aria-label="Safety factor"
							min={1}
							step={0.1}
							value={gantrySettings.safetyFactor}
							onValueChange={(v) =>
								setGantrySettings({
									...gantrySettings,
									safetyFactor: typeof v === 'number' && v >= 1 ? v : 1
								})
							}
						/>
						<span>× safety factor</span>
					</div>
					<span className="pl-7 text-[11px] text-muted-foreground">
						Draws a second line at required torque × this factor. 1.5–2 covers resonance, heat and datasheet
						error; 1 hides the line.
					</span>
				</div>

				{debug && (
					<>
						<Separator />

						<div className="flex flex-col w-full max-w-sm gap-2 text-xs">
							<span>{pulleyRadiusMm.toFixed(2)} mm effective pulley radius</span>
							<span>{calculateRequiredTorque(gantrySettings).toFixed(2)} Ncm required load torque</span>
							{gantrySettings.safetyFactor > 1 && (
								<span>
									{(calculateRequiredTorque(gantrySettings) * gantrySettings.safetyFactor).toFixed(2)}{' '}
									Ncm safety line (×{gantrySettings.safetyFactor})
								</span>
							)}
							<span>Gear Ratio: {gearRatio.toFixed(2)}:1</span>
							{isCoreXY && (
								<>
									<span>Peak Load Angle θ* (mass-only): {peakTorqueAngleDeg.toFixed(2)}°</span>
									{steppers.map((stepper, i) => (
										<span key={`${stepper.brand}|${stepper.model}`}>
											θ* {stepper.brand} {stepper.model}: {motorAnglesDeg[i].toFixed(2)}°
										</span>
									))}
									<span>
										Mass Ratio (mb/mh):{' '}
										{(
											gantrySettings.gantryBeamMass / Math.max(gantrySettings.toolheadMass, 1)
										).toFixed(2)}
									</span>
								</>
							)}
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
