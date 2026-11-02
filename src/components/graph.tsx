import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { NumberInput } from '@/components/ui/number-input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
	calculateCoreXYSpeedFactor,
	calculateGearRatio,
	calculateRequiredTorque,
	resolveCoreXYAngleRad
} from '@/lib/formulas';
import {
	autoMaxVelocity,
	buildTorqueCurve,
	stepperSeriesKey as generateKey,
	speedLimit,
	stepperSeriesColor
} from '@/lib/torque-curve';
import { usePanZoom } from '@/lib/use-pan-zoom';
import { currentDriveSettingsAtom, currentGantrySettingsAtom, steppersAtom } from '@/state/atoms';
import { useAtomValue } from 'jotai';
import { GrabIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, XAxis, YAxis } from 'recharts';

const Y_AXIS_HEADROOM = 1.05;

/** Data key of a stepper's Classic-to-SpreadCycle range, plotted as a shaded band */
const bandKey = (key: string) => `${key}__band`;

const BAND_MODELS = ['classic', 'spreadCycle'] as const;

function formatLimit(limit: number | 'never' | 'beyond', maxVelocity: number) {
	if (limit === 'never') return 'none';
	if (limit === 'beyond') return `>${Math.round(maxVelocity)}`;
	return String(Math.round(limit));
}

function VisibleSeriesTooltip({
	yBounds,
	hiddenKeys,
	...props
}: React.ComponentProps<typeof ChartTooltipContent> & { yBounds: [number, number]; hiddenKeys: Set<string> }) {
	const payload = props.payload?.filter(
		(item) =>
			typeof item.value === 'number' &&
			item.value >= yBounds[0] &&
			item.value <= yBounds[1] &&
			!hiddenKeys.has(String(item.dataKey ?? item.name))
	);

	if (!payload?.length) return null;

	return <ChartTooltipContent {...props} payload={payload} />;
}

export function Graph() {
	const driveSettings = useAtomValue(currentDriveSettingsAtom);
	const gantrySettings = useAtomValue(currentGantrySettingsAtom);
	// `null` until the field is edited: the range follows the selection on its own, but a typed
	// value is never overwritten by it
	const [manualMaxVelocity, setManualMaxVelocity] = useState<number | null>(null);
	const [unit, setUnit] = useState<'mm/s' | 'rpm'>('mm/s');

	const steppers = useAtomValue(steppersAtom);
	// Series hidden from the legend. Kept by key, so a hidden motor stays hidden while settings change
	const [hidden, setHidden] = useState<Set<string>>(() => new Set());
	const toggleHidden = (key: string) =>
		setHidden((previous) => {
			const next = new Set(previous);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	const pulleyCircumferenceMm = gantrySettings.pulleyTeeth * gantrySettings.toothPitch;
	const gearRatio = calculateGearRatio(gantrySettings);
	const isCoreXY = gantrySettings.kinematicsMode === 'corexy';
	const directionMode = gantrySettings.corexyDirectionMode;
	// The RPM axis shows the speed of the faster motor (motor A). In the envelope every direction is
	// checked, so the axis uses the fastest one (45°, √2× path speed). In peak-torque mode θ*
	// depends on each motor's rotor inertia: exact for a single motor, mass-only θ* otherwise.
	const speedFactor = !isCoreXY
		? 1
		: directionMode === 'envelope'
			? Math.SQRT2
			: calculateCoreXYSpeedFactor(
					resolveCoreXYAngleRad(gantrySettings, steppers.length === 1 ? steppers[0] : null)
				);
	const showsMarginScale = isCoreXY && (directionMode === 'envelope' || directionMode === 'peakTorque');
	const mmsToRpm = (mms: number) => (mms * 60 * gearRatio * speedFactor) / pulleyCircumferenceMm;
	const rpmToMms = (rpm: number) => (rpm * pulleyCircumferenceMm) / (60 * gearRatio * speedFactor);

	const requiredTorque = calculateRequiredTorque(gantrySettings);
	const fittedMaxVelocity = useMemo(
		() => autoMaxVelocity({ steppers, driveSettings, gantrySettings, requiredTorque }),
		[steppers, driveSettings, gantrySettings, requiredTorque]
	);
	const maxVelocity = manualMaxVelocity ?? fittedMaxVelocity;
	const displayedMax = unit === 'rpm' ? mmsToRpm(maxVelocity) : maxVelocity;

	const chartData = useMemo(
		() => buildTorqueCurve({ steppers, driveSettings, gantrySettings, maxVelocity }),
		[steppers, driveSettings, gantrySettings, maxVelocity]
	);

	const safetyFactor = Math.max(1, gantrySettings.safetyFactor ?? 1);
	const safeTorque = requiredTorque * safetyFactor;

	// Classic is the pessimistic driver model and SpreadCycle the optimistic one; real TMC hardware
	// usually lands between them, so the band shows how much the answer depends on that choice
	const bandCurves = useMemo(
		() =>
			driveSettings.showModelBand && steppers.length > 0
				? BAND_MODELS.map((model) =>
						buildTorqueCurve({
							steppers,
							driveSettings,
							gantrySettings,
							maxVelocity,
							motorModelOverride: model
						})
					)
				: null,
		[steppers, driveSettings, gantrySettings, maxVelocity]
	);

	const plotData = useMemo(() => {
		if (!bandCurves) return chartData;
		return chartData.map((point, i) => {
			const withBand: Record<string, number | [number, number]> = { ...point };
			for (const stepper of steppers) {
				const key = generateKey(stepper);
				const a = bandCurves[0][i]?.[key] ?? 0;
				const b = bandCurves[1][i]?.[key] ?? 0;
				withBand[bandKey(key)] = [Math.min(a, b), Math.max(a, b)];
			}
			return withBand;
		});
	}, [chartData, bandCurves, steppers]);

	const limits = useMemo(
		() =>
			steppers.map((stepper) => {
				const key = generateKey(stepper);
				return {
					key,
					limit: speedLimit(chartData, key, requiredTorque),
					safe: safetyFactor > 1 ? speedLimit(chartData, key, safeTorque) : null,
					range: bandCurves?.map((curve) => speedLimit(curve, key, requiredTorque)) ?? null
				};
			}),
		[steppers, chartData, bandCurves, requiredTorque, safeTorque, safetyFactor]
	);

	const chartConfig = useMemo(
		() =>
			steppers.reduce(
				(acc, stepper, index) => {
					acc[generateKey(stepper)] = {
						label: generateKey(stepper),
						color: stepperSeriesColor(index)
					};
					return acc;
				},
				{} as Record<string, { label: string; color: string }>
			),
		[steppers]
	);

	const baseBounds = useMemo(() => {
		const keys = steppers.map(generateKey).filter((key) => !hidden.has(key));
		const curves = [chartData, ...(bandCurves ?? [])];
		const peak = curves.reduce(
			(outer, curve) =>
				curve.reduce((max, point) => keys.reduce((inner, key) => Math.max(inner, point[key] ?? 0), max), outer),
			Number.isFinite(safeTorque) ? Math.max(safeTorque, 0) : 0
		);

		return {
			x: [0, maxVelocity] as [number, number],
			y: [0, Math.max(peak * Y_AXIS_HEADROOM, 1)] as [number, number]
		};
	}, [chartData, bandCurves, steppers, hidden, safeTorque, maxVelocity]);

	const { bounds, zoomed, panning, reset, handlers } = usePanZoom(baseBounds);

	return (
		<Card className="pt-0">
			<CardHeader className="flex flex-wrap items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
				<div className="grid flex-1 gap-1">
					<CardTitle>Torque Graph</CardTitle>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{zoomed && (
						<Button variant="outline" size="sm" onClick={reset}>
							Reset view
						</Button>
					)}
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={unit}
						onValueChange={(value) => {
							if (value === 'mm/s' || value === 'rpm') setUnit(value);
						}}
					>
						<ToggleGroupItem value="mm/s">mm/s</ToggleGroupItem>
						<ToggleGroupItem value="rpm">RPM</ToggleGroupItem>
					</ToggleGroup>
					<NumberInput
						value={Number.isFinite(displayedMax) ? Math.round(displayedMax) : 0}
						className="w-24"
						step={100}
						onValueChange={(v) =>
							setManualMaxVelocity(unit === 'rpm' ? rpmToMms(v as number) : (v as number))
						}
					/>
					<span>{unit}</span>
				</div>
			</CardHeader>
			<CardContent className="pt-0">
				{chartData.length === 0 ? (
					<div>No data to display</div>
				) : steppers.length === 0 ? (
					<div>No steppers selected</div>
				) : (
					<div className="flex flex-col gap-2">
						<div
							{...handlers}
							// Until zoomed, a one-finger swipe scrolls the page (an unzoomed chart has nothing to
							// pan) while a pinch still reaches the chart; once zoomed, one finger pans it
							className={`${zoomed ? 'touch-none' : 'touch-pan-y'} select-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
						>
							<ChartContainer config={chartConfig} className="aspect-auto h-80 sm:h-100 w-full">
								<ComposedChart data={plotData}>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="velocity"
										type="number"
										domain={bounds.x}
										allowDataOverflow
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={20}
										tickFormatter={(value) =>
											unit === 'rpm'
												? `${Math.round(mmsToRpm(value))} RPM`
												: `${Math.round(value)} mm/s`
										}
									/>
									<YAxis
										type="number"
										domain={bounds.y}
										allowDataOverflow
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={20}
										tickFormatter={(value) => `${Math.round(value)} Ncm`}
									/>
									<ChartTooltip
										cursor={false}
										content={
											<VisibleSeriesTooltip
												yBounds={bounds.y}
												hiddenKeys={hidden}
												labelFormatter={(_, payload) => {
													const velocity = payload?.[0]?.payload?.velocity;
													if (typeof velocity !== 'number') return null;

													const mms = `${Math.round(velocity)} mm/s`;
													const rpmValue = mmsToRpm(velocity);
													if (!Number.isFinite(rpmValue)) return mms;

													const rpm = `${Math.round(rpmValue)} RPM`;
													return unit === 'rpm' ? `${rpm} · ${mms}` : `${mms} · ${rpm}`;
												}}
												formatter={(value, name) => (
													<>
														<div
															className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
															style={
																{
																	'--color-bg':
																		chartConfig[name as keyof typeof chartConfig]
																			?.color || '#666'
																} as React.CSSProperties
															}
														/>
														{chartConfig[name as keyof typeof chartConfig]?.label || name}

														<div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums text-foreground">
															{typeof value === 'number'
																? `${value.toFixed(2)} Ncm`
																: value}
														</div>
													</>
												)}
											/>
										}
									/>
									{bandCurves &&
										steppers.map((stepper) => {
											const key = generateKey(stepper);
											if (hidden.has(key)) return null;
											return (
												<Area
													key={bandKey(key)}
													dataKey={bandKey(key)}
													type="monotone"
													stroke="none"
													fill={chartConfig[key]?.color}
													fillOpacity={0.12}
													activeDot={false}
													legendType="none"
													isAnimationActive={false}
												/>
											);
										})}
									{steppers.map((stepper) => {
										const key = generateKey(stepper);
										return (
											<Line
												key={key}
												dataKey={key}
												type="monotone"
												dot={false}
												isAnimationActive={false}
												stroke={chartConfig[key]?.color}
												strokeWidth={2}
												hide={hidden.has(key)}
											/>
										);
									})}
									<ReferenceLine
										y={requiredTorque}
										label="Required Torque"
										stroke="red"
										strokeDasharray="6 6"
									/>
									{safetyFactor > 1 && (
										<ReferenceLine
											y={safeTorque}
											label={{
												value: `×${safetyFactor} safety margin`,
												position: 'insideTopRight',
												fill: 'currentColor',
												fontSize: 11
											}}
											stroke="red"
											strokeOpacity={0.55}
											strokeDasharray="2 4"
										/>
									)}
									{/* Where each curve meets the required torque: a column down to the X axis and a dot */}
									{limits.map(({ key, limit }) =>
										typeof limit !== 'number' || hidden.has(key) ? null : (
											<ReferenceLine
												key={`limit-${key}`}
												segment={[
													{ x: limit, y: bounds.y[0] },
													{ x: limit, y: requiredTorque }
												]}
												stroke={chartConfig[key]?.color}
												strokeWidth={3}
												strokeOpacity={0.6}
												ifOverflow="hidden"
											/>
										)
									)}
									{limits
										.filter(
											(entry): entry is typeof entry & { limit: number } =>
												typeof entry.limit === 'number' && !hidden.has(entry.key)
										)
										.sort((a, b) => a.limit - b.limit)
										.map(({ key, limit }, i) => (
											<ReferenceDot
												key={`limit-dot-${key}`}
												x={limit}
												y={requiredTorque}
												r={4.5}
												fill={chartConfig[key]?.color}
												stroke="var(--background)"
												strokeWidth={1.5}
												ifOverflow="hidden"
												label={{
													// Speed where this motor runs out of torque, in the axis unit. Labels are
													// stacked by speed so neighbouring crossings do not overprint each other
													value:
														unit === 'rpm'
															? `${Math.round(mmsToRpm(limit))} RPM`
															: `${Math.round(limit)} mm/s`,
													position: 'top',
													offset: 8 + (i % 3) * 14,
													fill: chartConfig[key]?.color,
													fontSize: 11,
													fontWeight: 600
												}}
											/>
										))}
								</ComposedChart>
							</ChartContainer>
						</div>

						<div className="flex max-h-32 flex-wrap items-start justify-center gap-x-5 gap-y-1.5 overflow-y-auto text-xs">
							{limits.map(({ key, limit, safe, range }) => (
								<button
									type="button"
									key={key}
									onClick={() => toggleHidden(key)}
									aria-pressed={!hidden.has(key)}
									title={hidden.has(key) ? 'Show this motor' : 'Hide this motor'}
									className={`flex cursor-pointer items-start gap-1.5 rounded px-1 text-left transition-opacity hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${hidden.has(key) ? 'opacity-40' : ''}`}
								>
									<div
										className="mt-1 h-2 w-2 shrink-0 rounded-[2px]"
										style={{
											backgroundColor: hidden.has(key) ? 'transparent' : chartConfig[key]?.color,
											outline: `1.5px solid ${chartConfig[key]?.color}`
										}}
									/>
									<div className="flex flex-col">
										<span className={hidden.has(key) ? 'line-through' : ''}>
											{chartConfig[key]?.label}
										</span>
										<span className="tabular-nums text-muted-foreground">
											{safe !== null && <>safe ≤ {formatLimit(safe, maxVelocity)} · </>}
											skips at {formatLimit(limit, maxVelocity)}
											{range && (
												<>
													{' '}
													(models {formatLimit(range[0], maxVelocity)}–
													{formatLimit(range[1], maxVelocity)})
												</>
											)}{' '}
											mm/s
										</span>
									</div>
								</button>
							))}
						</div>

						<p className="text-center text-xs text-muted-foreground">
							{steppers.length > 0 &&
								'Click a motor below the chart to hide or show it. Dots mark where each curve meets the required torque. '}
							{bandCurves && 'Shaded: range between the Classic and SpreadCycle driver models. '}
							{safetyFactor > 1 &&
								`Faint red line: ×${safetyFactor} required torque; above it a motor keeps ${Math.round((safetyFactor - 1) * 100)}% spare. `}
							{driveSettings.torqueDerating !== 1 &&
								`Motor torque scaled by ${driveSettings.torqueDerating.toFixed(2)}× from your calibration.`}
						</p>

						{isCoreXY && (
							<p className="text-center text-xs text-muted-foreground">
								{showsMarginScale
									? 'CoreXY: each curve is drawn as required torque + its worst-case margin, so it crosses the red line exactly where that motor runs out of torque. Above the line, the gap is the spare torque (Ncm).'
									: 'CoreXY: curves show the torque motor A (the faster, more loaded motor) has left after accelerating its own rotor.'}{' '}
								RPM is motor A shaft speed
								{directionMode === 'envelope'
									? ' at the fastest direction (45°).'
									: directionMode === 'peakTorque' && steppers.length > 1
										? ' at the mass-only θ* (each motor uses its own θ*).'
										: '.'}
							</p>
						)}

						{/* Touch screens: pinch and drag. Mouse: wheel with modifier keys */}
						<p className="pointer-fine:hidden text-center text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
							<span className="flex items-center gap-1">
								<SearchIcon className="h-4 w-4" />
								Pinch to zoom
							</span>
							<span className="flex items-center gap-1">
								<GrabIcon className="h-4 w-4" />
								Drag to pan once zoomed
							</span>
						</p>
						<p className="pointer-coarse:hidden text-center text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
							<span className="flex items-center gap-1">
								<GrabIcon className="h-4 w-4" />
								Drag to pan
							</span>
							<span className="flex items-center gap-1">
								<SearchIcon className="h-4 w-4" />
								Scroll to zoom
							</span>
							<span>
								<Kbd>Shift</Kbd> + Scroll to zoom X
							</span>
							<span>
								<Kbd>Alt</Kbd> + Scroll to zoom Y
							</span>
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function Kbd({ children }: { children: ReactNode }) {
	return <kbd className="px-1 py-1 border-border border rounded">{children}</kbd>;
}
