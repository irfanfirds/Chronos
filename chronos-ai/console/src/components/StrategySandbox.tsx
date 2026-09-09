import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type SimulationOptions, type SimulationResponse } from '../apiClient';

interface StrategySandboxProps {
  defaultEvent?: string;
}

const VIEW_W = 520;
const VIEW_H = 120;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 22;

/**
 * "What if" panel: every number it shows is a real output of the trained
 * RandomForestRegressor for a scenario the strategist dials in. There is no
 * hand-tuned degradation curve or invented physics behind it - if the model
 * wasn't trained on a condition (e.g. rain at a circuit that stayed dry), the
 * prediction simply won't move, which is honest rather than hidden.
 */
export const StrategySandbox: React.FC<StrategySandboxProps> = ({ defaultEvent }) => {
  const [options, setOptions] = useState<SimulationOptions | null>(null);
  const [event, setEvent] = useState<string>('');
  const [compound, setCompound] = useState<string>('MEDIUM');
  const [tyreLife, setTyreLife] = useState(1);
  const [lapNumber, setLapNumber] = useState(20);
  const [stintLength, setStintLength] = useState(15);
  const [trackTemp, setTrackTemp] = useState<number | null>(null);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.simulationOptions()
      .then((opts) => {
        setOptions(opts);
        if (opts.compounds.includes('MEDIUM')) setCompound('MEDIUM');
        else if (opts.compounds.length) setCompound(opts.compounds[0]);
      })
      .catch(() => setError('Could not load simulation options.'));
  }, []);

  useEffect(() => {
    if (defaultEvent) setEvent(defaultEvent);
  }, [defaultEvent]);

  const runSimulation = async () => {
    if (!event) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.simulate({
        event,
        compound,
        tyre_life: tyreLife,
        lap_number: lapNumber,
        stint_length: stintLength,
        ...(trackTemp != null ? { track_temp: trackTemp } : {}),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Simulation failed.');
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const chart = useMemo(() => {
    if (!result || result.laps.length === 0) return null;
    const times = result.laps.map((l) => l.lap_time_seconds);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const pad = (max - min) * 0.15 || 0.5;
    const x = (i: number) =>
      PAD_L + (i / Math.max(result.laps.length - 1, 1)) * (VIEW_W - PAD_L - PAD_R);
    const y = (t: number) =>
      PAD_T + (1 - (t - (min - pad)) / (max + pad - (min - pad) || 1)) * (VIEW_H - PAD_T - PAD_B);
    return {
      path: result.laps.map((l, i) => `${x(i).toFixed(1)},${y(l.lap_time_seconds).toFixed(1)}`).join(' L '),
      points: result.laps.map((l, i) => ({ x: x(i), y: y(l.lap_time_seconds), lap: l })),
      min, max,
      yMin: y(min), yMax: y(max),
    };
  }, [result]);

  return (
    <div className="border-2 border-line bg-card p-4">
      <div className="flex justify-between items-center mb-3 pb-2 border-b-2 border-line">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-ultraviolet" />
          <span className="font-headline text-lg tracking-normal text-white uppercase">
            Strategy Sandbox
          </span>
        </div>
        <span className="text-[10px] font-mono text-zinc-400">WHAT-IF // REAL MODEL OUTPUT</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3 text-[10px] font-mono">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-400 uppercase tracking-wider">Circuit</span>
          <select
            className="bg-black border border-zinc-700 text-acid px-1.5 py-1 focus:outline-none focus:border-acid"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
          >
            {(options?.events ?? []).map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-zinc-400 uppercase tracking-wider">Compound</span>
          <select
            className="bg-black border border-zinc-700 text-acid px-1.5 py-1 focus:outline-none focus:border-acid"
            value={compound}
            onChange={(e) => setCompound(e.target.value)}
          >
            {(options?.compounds ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-zinc-400 uppercase tracking-wider">Tyre age (laps)</span>
          <input
            type="number" min={0} max={60} value={tyreLife}
            onChange={(e) => setTyreLife(Number(e.target.value))}
            className="bg-black border border-zinc-700 text-white px-1.5 py-1 focus:outline-none focus:border-acid"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-zinc-400 uppercase tracking-wider">Start lap</span>
          <input
            type="number" min={1} max={78} value={lapNumber}
            onChange={(e) => setLapNumber(Number(e.target.value))}
            className="bg-black border border-zinc-700 text-white px-1.5 py-1 focus:outline-none focus:border-acid"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-zinc-400 uppercase tracking-wider">Stint length</span>
          <input
            type="number" min={2} max={40} value={stintLength}
            onChange={(e) => setStintLength(Number(e.target.value))}
            className="bg-black border border-zinc-700 text-white px-1.5 py-1 focus:outline-none focus:border-acid"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-zinc-400 uppercase tracking-wider">Track temp °C</span>
          <input
            type="number" min={0} max={70} value={trackTemp ?? ''}
            placeholder="measured"
            onChange={(e) => setTrackTemp(e.target.value === '' ? null : Number(e.target.value))}
            className="bg-black border border-zinc-700 text-white px-1.5 py-1 focus:outline-none focus:border-acid placeholder:text-zinc-600"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={runSimulation}
          disabled={running || !event}
          className="bg-ultraviolet text-white font-bold font-mono text-xs px-4 py-2 uppercase tracking-wider hover:bg-acid hover:text-black transition-colors border-2 border-black disabled:opacity-50 cursor-pointer"
        >
          {running ? 'SIMULATING...' : 'RUN SIMULATION ↗'}
        </button>
        {result && (
          <div className="flex gap-4 text-[10px] font-mono">
            <span className="text-zinc-400">
              AVG <span className="text-white font-bold">{result.average_seconds.toFixed(3)}s</span>
            </span>
            <span className="text-zinc-400">
              STINT TOTAL <span className="text-white font-bold">{result.total_seconds.toFixed(1)}s</span>
            </span>
            <span className="text-zinc-400">
              DEG OVER STINT{' '}
              <span className={result.degradation_seconds > 0 ? 'text-red-400 font-bold' : 'text-acid font-bold'}>
                {result.degradation_seconds >= 0 ? '+' : ''}{result.degradation_seconds.toFixed(3)}s
              </span>
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-2 bg-red-950/30 border border-red-500/60 text-[10px] font-mono text-red-300 mb-3">
          {error}
        </div>
      )}

      {chart ? (
        <div className="bg-black border border-line p-2">
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-28" preserveAspectRatio="none">
            <line stroke="#1f2127" strokeDasharray="2 2" strokeWidth="1" x1={PAD_L} x2={VIEW_W - PAD_R} y1={chart.yMin} y2={chart.yMin} />
            <text fill="#666" fontFamily="monospace" fontSize="7" x={PAD_L - 6} y={chart.yMin + 3} textAnchor="end">
              {chart.min.toFixed(2)}s
            </text>
            <line stroke="#1f2127" strokeDasharray="2 2" strokeWidth="1" x1={PAD_L} x2={VIEW_W - PAD_R} y1={chart.yMax} y2={chart.yMax} />
            <text fill="#666" fontFamily="monospace" fontSize="7" x={PAD_L - 6} y={chart.yMax + 3} textAnchor="end">
              {chart.max.toFixed(2)}s
            </text>
            <path d={`M ${chart.path}`} fill="none" stroke="#a855f7" strokeWidth="2" />
            {chart.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#a855f7" />
            ))}
            {chart.points.map((p, i) =>
              i === 0 || i === chart.points.length - 1 ? (
                <text key={`l${i}`} fill="#888" fontFamily="monospace" fontSize="7" x={p.x} y={VIEW_H - 8} textAnchor="middle">
                  {p.lap.lap_number != null ? `L${p.lap.lap_number}` : `${p.lap.tyre_life}L`}
                </text>
              ) : null
            )}
          </svg>
        </div>
      ) : (
        <div className="bg-black border border-line p-4 text-center text-[10px] font-mono text-zinc-500">
          Dial in a scenario and run the simulation to project a stint.
        </div>
      )}

      <p className="text-[8px] text-zinc-500 font-mono mt-2 leading-tight">
        Projections come from the same RandomForestRegressor the agent uses, trained on real
        lap, tyre, circuit and measured-weather data. Conditions the model never saw at a
        given circuit (e.g. rain where it stayed dry all weekend) won't move the prediction.
      </p>
    </div>
  );
};
