import React, { useEffect, useState } from 'react';
import { ChassisVisualizer } from '../components/ChassisVisualizer';
import { TyreCrossoverChart } from '../components/TyreCrossoverChart';
import { CircuitMap } from '../components/CircuitMap';
import { useRace } from '../RaceContext';
import {
  api, ApiError,
  type CarTelemetryResponse, type CircuitMapResponse, type DegradationResponse,
  type DriverSectorRow, type PaceDeltaEntry, type WearIndexResponse,
} from '../apiClient';
import { formatCompoundLetter, formatDriverName, formatGap, formatLapTime } from '../format';
import { playPitRadioChirp, playTelemetryBlip } from '../audioEngine.js';

export const OverviewPage: React.FC = () => {
  const { scope, selectedEvent, leaderboard, lap, focalDriverNumber, focalDriver } = useRace();

  const [degradation, setDegradation] = useState<DegradationResponse | null>(null);
  const [wearIndex, setWearIndex] = useState<WearIndexResponse | null>(null);
  const [carTelemetry, setCarTelemetry] = useState<CarTelemetryResponse | null>(null);
  const [paceDelta, setPaceDelta] = useState<PaceDeltaEntry[] | null>(null);
  const [circuit, setCircuit] = useState<CircuitMapResponse | null>(null);
  const [circuitLoading, setCircuitLoading] = useState(false);
  const [sectors, setSectors] = useState<DriverSectorRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [radioTransmitted, setRadioTransmitted] = useState(false);
  const [planBDiscarded, setPlanBDiscarded] = useState(false);
  const [wearDetailOpen, setWearDetailOpen] = useState(false);

  // Race-level: sector splits + circuit map.
  useEffect(() => {
    if (!scope.event || !lap) return;
    let cancelled = false;

    api.sectors(scope, lap).then((r) => !cancelled && setSectors(r.drivers)).catch(() => {});

    setCircuitLoading(true);
    setCircuit(null);
    api.circuit(scope)
      .then((m) => { if (!cancelled) setCircuit(m); })
      .catch(() => { /* best-effort: some races have no position telemetry */ })
      .finally(() => { if (!cancelled) setCircuitLoading(false); });

    return () => { cancelled = true; };
  }, [scope.year, scope.event, lap]);

  // Driver-level data.
  useEffect(() => {
    if (!scope.event || !leaderboard || !lap) return;
    if (!leaderboard.some((d) => d.driver_number === focalDriverNumber)) return;
    let cancelled = false;

    (async () => {
      try {
        const topDrivers = leaderboard.slice(0, 3).map((d) => d.driver_number);
        const paceDriverNumbers = topDrivers.includes(focalDriverNumber)
          ? topDrivers
          : [...topDrivers.slice(0, 2), focalDriverNumber];

        const [deg, wear, car, pace] = await Promise.all([
          api.degradation(focalDriverNumber, scope),
          api.wearIndex(focalDriverNumber, scope),
          api.carTelemetry(focalDriverNumber, scope),
          api.paceDelta(lap, paceDriverNumbers, scope),
        ]);
        if (cancelled) return;
        setDegradation(deg);
        setWearIndex(wear);
        setCarTelemetry(car);
        setPaceDelta(pace.deltas);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'Failed to load driver telemetry.');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [scope.year, scope.event, leaderboard, lap, focalDriverNumber]);

  const nextLapDelta =
    degradation && degradation.projected.length > 0
      ? degradation.projected[0].lap_time_seconds -
        degradation.actual[degradation.actual.length - 1].lap_time_seconds
      : null;

  return (
    <div className="flex flex-col">
      {/* Hero: live wear + radio call */}
      <section className="border-b-2 border-line bg-[#0e0f13] grid grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between border-b-2 lg:border-b-0 lg:border-r-2 border-line">
          <div className="flex justify-between items-start text-xs uppercase tracking-widest text-zinc-500 mb-3">
            <span>[RACE OVERVIEW]</span>
            <span className="text-acid font-bold">
              {nextLapDelta != null
                ? `MODEL NEXT-LAP DELTA: ${nextLapDelta >= 0 ? '+' : ''}${nextLapDelta.toFixed(3)}s`
                : 'MODEL SYNCING'}
            </span>
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-headline font-bold tracking-normal uppercase leading-[0.95] text-white my-3">
            {selectedEvent?.event_name ?? '—'}
          </h1>

          <div className="mt-4 pt-4 border-t-2 border-line flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 bg-ultraviolet" />
              <span className="text-zinc-300 font-bold">
                DRIVER: {focalDriverNumber} {focalDriver ? formatDriverName(focalDriver.driver) : ''}
              </span>
              <span className="text-zinc-500">| {focalDriver?.team.toUpperCase() ?? '--'}</span>
            </div>
            <div className="text-zinc-500">
              {selectedEvent ? `${selectedEvent.location} · ${selectedEvent.country} · ${selectedEvent.year}` : ''}
            </div>
          </div>
          {loadError && <div className="text-red-400 text-[10px] font-mono mt-2">{loadError}</div>}
        </div>

        <div className="lg:col-span-5 bg-card p-6 sm:p-8 flex flex-col justify-between relative">
          <div className="absolute -right-8 -bottom-8 w-44 h-44 rounded-full concentric-vortex opacity-30 pointer-events-none" />
          <div>
            <span className="text-xs uppercase tracking-widest text-zinc-400 font-bold">
              Estimated Tyre Wear
            </span>
            <div className="flex items-baseline gap-3 mb-4 mt-3">
              <div className="text-6xl sm:text-7xl font-headline text-acid tracking-normal font-bold leading-none">
                {wearIndex ? `${wearIndex.estimated_wear_pct}%` : '--'}
              </div>
              <div className="text-xs text-zinc-400 font-mono leading-tight">
                MODELED FROM TYRE AGE
                <br />
                <span className="text-white font-bold text-sm">
                  {wearIndex ? `${wearIndex.compound} // ${wearIndex.tyre_life_laps}L` : 'SYNCING'}
                </span>
              </div>
            </div>
            <div className="w-full bg-zinc-900 h-3 border border-zinc-700 p-0.5 mb-6">
              <div
                className="bg-acid h-full transition-all duration-500"
                style={{ width: `${wearIndex?.estimated_wear_pct ?? 0}%` }}
              />
            </div>
          </div>

          <div className="relative z-10 pt-2">
            <button
              onClick={() => { playPitRadioChirp(); setRadioTransmitted(true); }}
              className={`w-full group ${
                radioTransmitted ? 'bg-white text-black' : 'bg-acid hover:bg-white text-black'
              } p-4 flex items-center justify-between font-headline text-xl uppercase tracking-normal font-bold transition-colors border-2 border-black shadow-[4px_4px_0px_0px_#5e17eb] active:translate-x-0.5 active:translate-y-0.5`}
            >
              <span className="flex items-center gap-3">
                <span className={`w-3 h-3 ${radioTransmitted ? 'bg-red-600' : 'bg-black'} animate-ping`} />
                {radioTransmitted ? "TRANSMITTED: 'BOX BOX'" : `TRANSMIT 'BOX BOX' TO CAR ${focalDriverNumber}`}
              </span>
              <span className="text-2xl font-mono leading-none">↗</span>
            </button>
            <p className="text-[10px] text-zinc-500 font-mono mt-2 text-center uppercase tracking-widest">
              Radio call is a UI action only — it does not send a real transmission.
            </p>
          </div>
        </div>
      </section>

      <section className="flex-1 grid grid-cols-1 lg:grid-cols-12 divide-y-2 lg:divide-y-0 lg:divide-x-2 divide-line">
        {/* Telemetry + degradation */}
        <article className="lg:col-span-8 bg-[#0e0f13] p-5">
          <div className="flex items-center justify-between border-b-2 border-line pb-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-ultraviolet" />
              <span className="font-headline text-lg tracking-normal text-white uppercase">
                Car {focalDriverNumber} Telemetry
              </span>
            </div>
            <span className="text-[11px] font-mono text-acid font-bold">
              {focalDriver ? `${formatCompoundLetter(focalDriver.compound)} // ${focalDriver.tyre_life}L` : '--'}
            </span>
          </div>

          <ChassisVisualizer
            carTelemetry={carTelemetry}
            wearIndex={wearIndex}
            onShowWearDetail={() => setWearDetailOpen((v) => !v)}
          />

          {wearDetailOpen && wearIndex && (
            <div className="mb-3 p-2 bg-zinc-900 border border-acid/60 text-[10px] font-mono text-zinc-300">
              {wearIndex.method}
            </div>
          )}

          {degradation && (
            <TyreCrossoverChart actual={degradation.actual} projected={degradation.projected} />
          )}
        </article>

        {/* Leaderboard, pace, circuit */}
        <article className="lg:col-span-4 bg-panel p-5">
          <div className="flex items-center justify-between border-b-2 border-line pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-acid" />
              <span className="font-headline text-lg tracking-normal text-white uppercase">
                Interval Tracker
              </span>
            </div>
            <span className="text-xs font-headline text-zinc-400">
              {selectedEvent?.location.toUpperCase() ?? '--'}
            </span>
          </div>

          <div className="divide-y-2 divide-line border-2 border-line bg-black mb-4">
            {(leaderboard ?? []).slice(0, 6).map((driver) => {
              const isFocal = driver.driver_number === focalDriverNumber;
              return (
                <div
                  key={driver.driver_number}
                  className={`p-3 flex items-center justify-between ${
                    isFocal ? 'bg-zinc-900 border-l-4 border-l-acid' : 'hover:bg-card'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`font-headline text-xl w-4 ${isFocal ? 'text-acid' : 'text-zinc-500'}`}>
                      {String(driver.position ?? '--').padStart(2, '0')}
                    </span>
                    <div>
                      <div className={`font-headline text-lg leading-none ${isFocal ? 'text-acid' : 'text-white'}`}>
                        {formatDriverName(driver.driver)}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                        {driver.team.toUpperCase()} // {formatCompoundLetter(driver.compound)}
                        {driver.tyre_life != null ? ` (${driver.tyre_life}L)` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-headline text-sm ${driver.position === 1 || isFocal ? 'text-acid' : 'text-white'}`}>
                      {formatGap(driver.gap_to_leader_seconds, driver.position)}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500">
                      {formatLapTime(driver.lap_time_seconds)}
                    </div>
                  </div>
                </div>
              );
            })}
            {!leaderboard && (
              <div className="p-4 text-center text-[10px] font-mono text-zinc-500">SYNCING...</div>
            )}
          </div>

          <div className="border-2 border-line bg-card p-3 mb-4">
            <span className="text-[10px] font-bold text-white uppercase tracking-wider font-mono">
              PACE DELTA @ LAP {lap ?? '--'}
            </span>
            <div className="space-y-1.5 font-mono text-[10px] mt-2">
              {(paceDelta ?? []).map((entry) => (
                <div key={entry.driver_number} className="flex items-center gap-2">
                  <span className={`w-8 text-[9px] ${
                    entry.driver_number === focalDriverNumber ? 'text-acid font-bold' : 'text-zinc-400'
                  }`}>
                    {entry.driver}
                  </span>
                  <div className="flex-1 bg-zinc-800 h-2">
                    <div
                      className={entry.delta_seconds === 0 ? 'bg-blue-400 h-full' : 'bg-amber-500 h-full'}
                      style={{ width: `${Math.min(100, (entry.delta_seconds / 2) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-zinc-300 w-12 text-right">
                    +{entry.delta_seconds.toFixed(3)}s
                  </span>
                </div>
              ))}
              {!paceDelta && <div className="text-zinc-500 text-center">SYNCING...</div>}
            </div>
          </div>

          <CircuitMap
            circuit={circuit}
            circuitLoading={circuitLoading}
            sectors={sectors}
            sectorLap={lap}
            focalDriverNumber={focalDriverNumber}
          />

          <div className="mt-4 pt-3 border-t-2 border-line">
            <div className={`${planBDiscarded ? 'bg-zinc-800 opacity-60' : 'bg-ultraviolet'} text-white p-3 border-2 border-black flex items-center justify-between`}>
              <div>
                <div className="font-headline text-base uppercase leading-tight">
                  {planBDiscarded ? 'PLAN B (DISCARDED)' : 'PLAN B (LONG STINT)'}
                </div>
                <div className="text-[10px] font-mono opacity-80 mt-0.5">
                  {planBDiscarded ? 'STRATEGY ABANDONED' : 'Manual strategist override'}
                </div>
              </div>
              <button
                onClick={() => { playTelemetryBlip(); setPlanBDiscarded(!planBDiscarded); }}
                className="bg-black text-acid font-bold text-xs px-2.5 py-1.5 font-mono hover:bg-white hover:text-black transition-colors cursor-pointer"
              >
                {planBDiscarded ? 'RESTORE' : 'DISCARD'}
              </button>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
};
