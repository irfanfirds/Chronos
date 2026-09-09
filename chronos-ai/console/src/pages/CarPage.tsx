import React, { useEffect, useMemo, useRef, useState } from 'react';
import { initThreeCarSimulation } from '../threeSimulation.js';
import { useRace } from '../RaceContext';
import { api, type LapDetail, type Stint } from '../apiClient';
import { formatDriverName, formatLapTime } from '../format';

type PartId =
  | 'FRONT_TYRES' | 'REAR_TYRES' | 'FRONT_WING' | 'REAR_WING'
  | 'FRONT_SUSPENSION' | 'CHASSIS' | 'POWER_UNIT';

const PART_LABELS: Record<PartId, string> = {
  FRONT_TYRES: 'Front tyres',
  REAR_TYRES: 'Rear tyres',
  FRONT_WING: 'Front wing / nose',
  REAR_WING: 'Rear wing',
  FRONT_SUSPENSION: 'Front suspension',
  CHASSIS: 'Chassis / sidepods',
  POWER_UNIT: 'Power unit / gearbox',
};

const PART_ORDER: PartId[] = [
  'FRONT_TYRES', 'REAR_TYRES', 'FRONT_WING', 'REAR_WING',
  'FRONT_SUSPENSION', 'CHASSIS', 'POWER_UNIT',
];

function fmt(v: number | null | undefined, unit = '', digits = 3): string {
  return v == null ? '--' : `${v.toFixed(digits)}${unit}`;
}

/** Risk read for a tyre, derived only from real inputs (age + measured track temp). */
function tyreRisk(lap: LapDetail | null): { level: string; tone: string; why: string } {
  if (!lap || lap.estimated_wear_pct == null) {
    return { level: 'UNKNOWN', tone: 'text-zinc-500', why: 'No tyre data for this lap.' };
  }
  const wear = lap.estimated_wear_pct;
  const hot = (lap.track_temp ?? 0) >= 45;
  if (wear >= 85) {
    return {
      level: 'CRITICAL',
      tone: 'text-red-400',
      why: `Past the ${wear.toFixed(0)}% cliff threshold${hot ? ' with a hot track amplifying degradation' : ''}.`,
    };
  }
  if (wear >= 60) {
    return {
      level: 'ELEVATED',
      tone: 'text-amber-400',
      why: `${wear.toFixed(0)}% of typical ${lap.compound} stint life used${hot ? '; track above 45°C' : ''}.`,
    };
  }
  return { level: 'NOMINAL', tone: 'text-acid', why: `${wear.toFixed(0)}% of typical stint life used.` };
}

export const CarPage: React.FC = () => {
  const { scope, focalDriverNumber, focalDriver } = useRace();
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<{
    destroy: () => void;
    resetRotation: () => void;
    updateWear: (pct: number | null) => void;
    setSelectedPart: (p: string | null) => void;
  } | null>(null);

  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<PartId>('FRONT_TYRES');
  const [laps, setLaps] = useState<LapDetail[] | null>(null);
  const [stints, setStints] = useState<Stint[] | null>(null);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const controller = initThreeCarSimulation(containerRef.current, {
      onLoadingChange: setModelLoading,
      onError: setModelError,
      onPartClick: (part: string) => setSelectedPart(part as PartId),
    });
    controllerRef.current = controller;
    return () => { controllerRef.current?.destroy(); };
  }, []);

  useEffect(() => {
    controllerRef.current?.setSelectedPart(selectedPart);
  }, [selectedPart, modelLoading]);

  useEffect(() => {
    if (!scope.event) return;
    let cancelled = false;
    setLaps(null);
    setSelectedLap(null);
    api.laps(focalDriverNumber, scope)
      .then((r) => {
        if (cancelled) return;
        setLaps(r.laps);
        setSelectedLap(r.laps.length ? r.laps[r.laps.length - 1].lap : null);
      })
      .catch(() => { if (!cancelled) setLaps([]); });
    api.stints(focalDriverNumber, scope).then((r) => !cancelled && setStints(r.stints)).catch(() => {});
    return () => { cancelled = true; };
  }, [scope.year, scope.event, focalDriverNumber]);

  const currentLap = useMemo(
    () => laps?.find((l) => l.lap === selectedLap) ?? null,
    [laps, selectedLap]
  );

  useEffect(() => {
    controllerRef.current?.updateWear(currentLap?.estimated_wear_pct ?? null);
  }, [currentLap?.estimated_wear_pct]);

  const isTyre = selectedPart === 'FRONT_TYRES' || selectedPart === 'REAR_TYRES';
  const risk = tyreRisk(currentLap);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 divide-y-2 xl:divide-y-0 xl:divide-x-2 divide-line min-h-[calc(100vh-9rem)]">
      {/* 3D model + part picker */}
      <section className="xl:col-span-7 bg-[#0e0f13] p-5">
        <div className="flex items-center justify-between border-b-2 border-line pb-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-ultraviolet" />
            <span className="font-headline text-lg tracking-normal text-white uppercase">
              Car {focalDriverNumber} — {focalDriver ? formatDriverName(focalDriver.driver) : ''}
            </span>
          </div>
          <button
            onClick={() => controllerRef.current?.resetRotation()}
            className="text-[9px] font-mono text-acid bg-zinc-900 border border-zinc-700 px-2 py-1 hover:bg-acid hover:text-black transition-colors"
          >
            RESET CAM
          </button>
        </div>

        <div className="border-2 border-line bg-black relative p-2 mb-3">
          <div className="relative w-full h-[22rem] bg-black/40 overflow-hidden" ref={containerRef}>
            <div className="absolute top-2 left-2 bg-black/85 border border-line px-2 py-1 text-[10px] font-mono z-10 pointer-events-none">
              <span className="text-zinc-400">SELECTED: </span>
              <span className="text-acid font-bold">{PART_LABELS[selectedPart]}</span>
            </div>
            {modelLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="bg-black/85 border border-line px-3 py-1.5 text-[10px] font-mono text-acid animate-pulse">
                  LOADING CHASSIS MODEL...
                </div>
              </div>
            )}
            {modelError && !modelLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="bg-black/85 border border-red-500 px-3 py-1.5 text-[10px] font-mono text-red-400">
                  CHASSIS MODEL UNAVAILABLE
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 bg-black/85 border border-line px-2 py-1 text-[9px] font-mono text-zinc-400 z-10 pointer-events-none">
              CLICK A COMPONENT TO INSPECT · DRAG TO ROTATE
            </div>
          </div>
          <div className="px-1 pt-1.5 text-[8px] font-mono text-zinc-600">
            3D model: "2026 F1 Car V3 Redesign" by Abu Saif (Sketchfab, CC BY 4.0)
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PART_ORDER.map((p) => (
            <button
              key={p}
              onClick={() => setSelectedPart(p)}
              className={`border-2 p-2 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                selectedPart === p
                  ? 'bg-acid text-black border-black font-bold'
                  : 'bg-card border-line text-zinc-400 hover:border-acid hover:text-acid'
              }`}
            >
              {PART_LABELS[p]}
            </button>
          ))}
        </div>

        <p className="text-[9px] text-zinc-500 font-mono mt-3 leading-relaxed">
          The chassis model merges left and right wheels into single front/rear meshes, so tyre
          data is reported per axle rather than per corner — public F1 telemetry doesn't publish
          per-corner tyre data either.
        </p>
      </section>

      {/* Part detail + lap browser */}
      <section className="xl:col-span-5 bg-panel p-5 space-y-4">
        <div className="flex items-center justify-between border-b-2 border-line pb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-acid" />
            <span className="font-headline text-lg tracking-normal text-white uppercase">
              {PART_LABELS[selectedPart]}
            </span>
          </div>
          <span className="text-[10px] font-mono text-zinc-400">LAP {selectedLap ?? '--'}</span>
        </div>

        {isTyre ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="border-2 border-line bg-card p-2.5">
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider mb-1">Compound</div>
                <div className="font-headline text-xl text-acid">{currentLap?.compound ?? '--'}</div>
                <div className="text-zinc-500">
                  {currentLap?.fresh_tyre ? 'fitted fresh' : 'scrubbed set'}
                </div>
              </div>
              <div className="border-2 border-line bg-card p-2.5">
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider mb-1">Tyre age</div>
                <div className="font-headline text-xl text-white">
                  {currentLap?.tyre_life != null ? `${currentLap.tyre_life}L` : '--'}
                </div>
                <div className="text-zinc-500">stint {currentLap?.stint ?? '--'}</div>
              </div>
            </div>

            <div className="border-2 border-line bg-card p-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Estimated usage
                </span>
                <span className={`text-[10px] font-mono font-bold ${risk.tone}`}>{risk.level}</span>
              </div>
              <div className="w-full bg-zinc-800 h-3 border border-zinc-700 p-0.5 mb-1">
                <div
                  className={`h-full ${
                    (currentLap?.estimated_wear_pct ?? 0) >= 85 ? 'bg-red-500'
                      : (currentLap?.estimated_wear_pct ?? 0) >= 60 ? 'bg-amber-500' : 'bg-acid'
                  }`}
                  style={{ width: `${currentLap?.estimated_wear_pct ?? 0}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-white font-bold">
                  {currentLap?.estimated_wear_pct != null ? `${currentLap.estimated_wear_pct}%` : '--'}
                </span>
                <span className="text-zinc-500">cliff threshold 85%</span>
              </div>
              <div className={`text-[9px] font-mono mt-1.5 ${risk.tone}`}>RISK: {risk.why}</div>
              <div className="text-[8px] font-mono text-zinc-600 mt-1 leading-tight">
                Modeled from tyre age vs. typical compound stint length. Carcass wear and tyre
                core temperature are proprietary team telemetry and are not published — this is
                an estimate, not a sensor reading.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="border-2 border-line bg-card p-2.5">
                <div className="text-[9px] text-zinc-400 uppercase mb-1">Track temp (measured)</div>
                <div className="font-headline text-lg text-yellow-400">
                  {fmt(currentLap?.track_temp, '°C', 1)}
                </div>
              </div>
              <div className="border-2 border-line bg-card p-2.5">
                <div className="text-[9px] text-zinc-400 uppercase mb-1">Air temp (measured)</div>
                <div className="font-headline text-lg text-white">
                  {fmt(currentLap?.air_temp, '°C', 1)}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="border-2 border-line bg-card p-3 text-[10px] font-mono text-zinc-400 leading-relaxed">
              Public F1 timing does not publish component-level telemetry for the{' '}
              <span className="text-white">{PART_LABELS[selectedPart].toLowerCase()}</span> — no
              wing loads, ERS state, or gearbox data is released. Rather than invent numbers,
              this panel shows the real per-lap measures that reflect how this part of the car
              was performing.
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="border-2 border-line bg-card p-2.5">
                <div className="text-[9px] text-zinc-400 uppercase mb-1">Speed trap</div>
                <div className="font-headline text-lg text-yellow-400">
                  {fmt(currentLap?.speed_trap_kph, ' kph', 0)}
                </div>
              </div>
              <div className="border-2 border-line bg-card p-2.5">
                <div className="text-[9px] text-zinc-400 uppercase mb-1">Finish-line speed</div>
                <div className="font-headline text-lg text-acid">
                  {fmt(currentLap?.speed_finish_line_kph, ' kph', 0)}
                </div>
              </div>
              <div className="border-2 border-line bg-card p-2.5">
                <div className="text-[9px] text-zinc-400 uppercase mb-1">
                  {selectedPart === 'REAR_WING' || selectedPart === 'POWER_UNIT' ? 'Sector 3' : 'Sector 1'}
                </div>
                <div className="font-headline text-lg text-white">
                  {fmt(
                    selectedPart === 'REAR_WING' || selectedPart === 'POWER_UNIT'
                      ? currentLap?.sector_3_seconds
                      : currentLap?.sector_1_seconds,
                    's'
                  )}
                </div>
              </div>
              <div className="border-2 border-line bg-card p-2.5">
                <div className="text-[9px] text-zinc-400 uppercase mb-1">Lap time</div>
                <div className="font-headline text-lg text-white">
                  {formatLapTime(currentLap?.lap_time_seconds)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sector splits for the selected lap */}
        <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="border-2 border-line bg-card p-2">
              <div className="text-[9px] text-zinc-400 uppercase">Sector {n}</div>
              <div className="font-headline text-base text-white">
                {fmt(
                  n === 1 ? currentLap?.sector_1_seconds
                    : n === 2 ? currentLap?.sector_2_seconds : currentLap?.sector_3_seconds,
                  's'
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Lap browser - inspect this part's condition on any past lap */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
              // Lap history — select a lap
            </span>
            <span className="text-[9px] font-mono text-zinc-500">
              {laps ? `${laps.length} laps` : 'syncing…'}
            </span>
          </div>

          {laps && laps.length > 0 && (
            <>
              <input
                type="range"
                min={laps[0].lap}
                max={laps[laps.length - 1].lap}
                value={selectedLap ?? laps[laps.length - 1].lap}
                onChange={(e) => setSelectedLap(Number(e.target.value))}
                className="w-full accent-acid mb-2"
              />
              <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                {laps.map((l) => {
                  const wear = l.estimated_wear_pct ?? 0;
                  const active = l.lap === selectedLap;
                  return (
                    <button
                      key={l.lap}
                      onClick={() => setSelectedLap(l.lap)}
                      title={`Lap ${l.lap} · ${l.compound} ${l.tyre_life}L · ${formatLapTime(l.lap_time_seconds)}`}
                      className={`w-8 h-7 text-[9px] font-mono border transition-colors ${
                        active
                          ? 'bg-acid text-black border-black font-bold'
                          : wear >= 85
                          ? 'bg-red-950/50 border-red-500/60 text-red-300 hover:border-red-400'
                          : wear >= 60
                          ? 'bg-amber-950/40 border-amber-600/50 text-amber-300 hover:border-amber-400'
                          : 'bg-black border-line text-zinc-400 hover:border-acid'
                      }`}
                    >
                      {l.lap}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {laps?.length === 0 && (
            <div className="text-[10px] font-mono text-zinc-500">No laps recorded for this driver.</div>
          )}
        </div>

        {/* Stint context */}
        {stints && stints.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold mb-2">
              // Tyre sets used
            </div>
            <div className="space-y-1">
              {stints.map((s) => (
                <div
                  key={`${s.stint}-${s.start_lap}`}
                  className={`flex justify-between border-2 px-2 py-1 text-[10px] font-mono ${
                    currentLap && currentLap.lap >= s.start_lap && currentLap.lap <= s.end_lap
                      ? 'border-acid bg-zinc-900 text-acid'
                      : 'border-line bg-card text-zinc-400'
                  }`}
                >
                  <span>STINT {s.stint} · {s.compound}</span>
                  <span>L{s.start_lap}–L{s.end_lap} · best {s.best_lap_seconds.toFixed(3)}s</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
