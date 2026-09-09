import React, { useEffect, useMemo, useState } from 'react';
import { useRace } from '../RaceContext';
import { api, type LapDetail, type Stint, type DriverSectorRow } from '../apiClient';
import { formatDriverName, formatLapTime } from '../format';

const VIEW_W = 900;
const VIEW_H = 240;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 26;

const COMPOUND_COLOR: Record<string, string> = {
  SOFT: '#ef4444',
  MEDIUM: '#facc15',
  HARD: '#e5e7eb',
  INTERMEDIATE: '#22c55e',
  WET: '#3b82f6',
};

/**
 * Deeper read on one driver's race: lap-time trace coloured by compound (so pit
 * stops and tyre phases are visible), plus outlier/consistency stats. Everything
 * is computed from the real per-lap rows.
 */
export const AnalysisPage: React.FC = () => {
  const { scope, focalDriverNumber, focalDriver, lap } = useRace();
  const [laps, setLaps] = useState<LapDetail[] | null>(null);
  const [stints, setStints] = useState<Stint[] | null>(null);
  const [sectors, setSectors] = useState<DriverSectorRow[] | null>(null);
  const [excludeOutliers, setExcludeOutliers] = useState(true);

  useEffect(() => {
    if (!scope.event) return;
    let cancelled = false;
    setLaps(null);
    api.laps(focalDriverNumber, scope).then((r) => !cancelled && setLaps(r.laps)).catch(() => !cancelled && setLaps([]));
    api.stints(focalDriverNumber, scope).then((r) => !cancelled && setStints(r.stints)).catch(() => {});
    if (lap) api.sectors(scope, lap).then((r) => !cancelled && setSectors(r.drivers)).catch(() => {});
    return () => { cancelled = true; };
  }, [scope.year, scope.event, focalDriverNumber, lap]);

  const stats = useMemo(() => {
    if (!laps || laps.length === 0) return null;
    const times = laps.map((l) => l.lap_time_seconds).filter((t): t is number => t != null);
    if (!times.length) return null;

    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // "Representative" laps: within 107% of the median, the usual way to strip
    // out in/out laps, safety-car laps and traffic before judging race pace.
    const clean = times.filter((t) => t <= median * 1.07);
    const basis = excludeOutliers ? clean : times;
    const mean = basis.reduce((a, b) => a + b, 0) / basis.length;
    const variance = basis.reduce((a, b) => a + (b - mean) ** 2, 0) / basis.length;

    return {
      best: sorted[0],
      median,
      mean,
      stdDev: Math.sqrt(variance),
      cleanCount: clean.length,
      totalCount: times.length,
      excluded: times.length - clean.length,
    };
  }, [laps, excludeOutliers]);

  const chart = useMemo(() => {
    if (!laps || laps.length === 0) return null;
    const points = laps.filter((l) => l.lap_time_seconds != null);
    if (!points.length) return null;

    const times = points.map((l) => l.lap_time_seconds as number);
    const lapNums = points.map((l) => l.lap);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const minL = Math.min(...lapNums);
    const maxL = Math.max(...lapNums);

    const x = (l: number) => PAD_L + ((l - minL) / (maxL - minL || 1)) * (VIEW_W - PAD_L - PAD_R);
    const y = (t: number) => PAD_T + (1 - (t - minT) / (maxT - minT || 1)) * (VIEW_H - PAD_T - PAD_B);

    return { points, x, y, minT, maxT, minL, maxL };
  }, [laps]);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between border-b-2 border-line pb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-acid" />
          <span className="font-headline text-lg tracking-normal text-white uppercase">
            Race Analysis — #{focalDriverNumber} {focalDriver ? formatDriverName(focalDriver.driver) : ''}
          </span>
        </div>
        <label className="flex items-center gap-2 text-[10px] font-mono text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={excludeOutliers}
            onChange={(e) => setExcludeOutliers(e.target.checked)}
            className="accent-acid"
          />
          EXCLUDE OUTLIER LAPS (&gt;107% OF MEDIAN)
        </label>
      </div>

      {/* Pace statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px] font-mono">
        <div className="border-2 border-line bg-card p-3">
          <div className="text-[9px] text-zinc-400 uppercase mb-1">Best lap</div>
          <div className="font-headline text-2xl text-acid">{stats ? formatLapTime(stats.best) : '--'}</div>
        </div>
        <div className="border-2 border-line bg-card p-3">
          <div className="text-[9px] text-zinc-400 uppercase mb-1">Median lap</div>
          <div className="font-headline text-2xl text-white">{stats ? formatLapTime(stats.median) : '--'}</div>
        </div>
        <div className="border-2 border-line bg-card p-3">
          <div className="text-[9px] text-zinc-400 uppercase mb-1">
            Mean {excludeOutliers ? '(clean)' : '(all)'}
          </div>
          <div className="font-headline text-2xl text-white">{stats ? formatLapTime(stats.mean) : '--'}</div>
        </div>
        <div className="border-2 border-line bg-card p-3">
          <div className="text-[9px] text-zinc-400 uppercase mb-1">Consistency (σ)</div>
          <div className="font-headline text-2xl text-ultraviolet">
            {stats ? `${stats.stdDev.toFixed(3)}s` : '--'}
          </div>
        </div>
        <div className="border-2 border-line bg-card p-3">
          <div className="text-[9px] text-zinc-400 uppercase mb-1">Laps used</div>
          <div className="font-headline text-2xl text-white">
            {stats ? `${excludeOutliers ? stats.cleanCount : stats.totalCount}/${stats.totalCount}` : '--'}
          </div>
          <div className="text-zinc-500">{stats ? `${stats.excluded} outliers` : ''}</div>
        </div>
      </div>

      {/* Lap trace coloured by compound */}
      <div className="border-2 border-line bg-card p-3">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2 pb-2 border-b border-line">
          <span className="text-[11px] font-bold text-white uppercase tracking-wider font-mono">
            Lap-time trace by compound
          </span>
          <div className="flex gap-3 text-[9px] font-mono">
            {Object.entries(COMPOUND_COLOR).map(([name, color]) => (
              <span key={name} className="flex items-center gap-1 text-zinc-400">
                <span className="w-2.5 h-2.5 inline-block" style={{ background: color }} />
                {name}
              </span>
            ))}
          </div>
        </div>

        {chart ? (
          <div className="bg-black border border-line p-2 overflow-x-auto">
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-56">
              {[chart.minT, (chart.minT + chart.maxT) / 2, chart.maxT].map((t) => (
                <g key={t}>
                  <line
                    stroke="#1f2127" strokeDasharray="2 2" strokeWidth="1"
                    x1={PAD_L} x2={VIEW_W - PAD_R} y1={chart.y(t)} y2={chart.y(t)}
                  />
                  <text fill="#666" fontFamily="monospace" fontSize="9" x={PAD_L - 6} y={chart.y(t) + 3} textAnchor="end">
                    {t.toFixed(1)}s
                  </text>
                </g>
              ))}
              {chart.points.map((p, i) => {
                const prev = chart.points[i - 1];
                const color = COMPOUND_COLOR[p.compound] ?? '#c8ff00';
                return (
                  <g key={p.lap}>
                    {prev && prev.stint === p.stint && (
                      <line
                        x1={chart.x(prev.lap)} y1={chart.y(prev.lap_time_seconds as number)}
                        x2={chart.x(p.lap)} y2={chart.y(p.lap_time_seconds as number)}
                        stroke={color} strokeWidth="1.6" opacity="0.85"
                      />
                    )}
                    <circle
                      cx={chart.x(p.lap)} cy={chart.y(p.lap_time_seconds as number)}
                      r="2.2" fill={color}
                    />
                  </g>
                );
              })}
              {[chart.minL, Math.round((chart.minL + chart.maxL) / 2), chart.maxL].map((l) => (
                <text
                  key={l} fill="#666" fontFamily="monospace" fontSize="9"
                  x={chart.x(l)} y={VIEW_H - 8} textAnchor="middle"
                >
                  L{l}
                </text>
              ))}
            </svg>
          </div>
        ) : (
          <div className="text-[10px] font-mono text-zinc-500 text-center py-8">
            {laps === null ? 'SYNCING...' : 'No lap data for this driver.'}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Stint comparison */}
        <div className="border-2 border-line bg-card p-3">
          <div className="text-[11px] font-bold text-white uppercase tracking-wider font-mono mb-2 pb-2 border-b border-line">
            Stint comparison
          </div>
          <div className="space-y-2">
            {(stints ?? []).map((s) => {
              const worst = Math.max(...(stints ?? []).map((x) => x.average_lap_seconds));
              const width = worst ? (s.average_lap_seconds / worst) * 100 : 0;
              return (
                <div key={`${s.stint}-${s.start_lap}`} className="text-[10px] font-mono">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-white">
                      S{s.stint} · {s.compound}{' '}
                      <span className="text-zinc-500">L{s.start_lap}–L{s.end_lap}</span>
                    </span>
                    <span className="text-zinc-300">{s.average_lap_seconds.toFixed(3)}s avg</span>
                  </div>
                  <div className="w-full bg-zinc-800 h-2.5">
                    <div
                      className="h-full"
                      style={{ width: `${width}%`, background: COMPOUND_COLOR[s.compound] ?? '#c8ff00' }}
                    />
                  </div>
                </div>
              );
            })}
            {!stints && <div className="text-[10px] font-mono text-zinc-500">SYNCING...</div>}
          </div>
        </div>

        {/* Field sector comparison at the current lap */}
        <div className="border-2 border-line bg-card p-3">
          <div className="text-[11px] font-bold text-white uppercase tracking-wider font-mono mb-2 pb-2 border-b border-line">
            Field sector times @ lap {lap ?? '--'}
          </div>
          <div className="grid grid-cols-[3rem_1fr_1fr_1fr] gap-x-2 text-[9px] text-zinc-500 uppercase mb-1 px-1">
            <span />
            <span className="text-right">S1</span>
            <span className="text-right">S2</span>
            <span className="text-right">S3</span>
          </div>
          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {(sectors ?? []).map((row) => (
              <div
                key={row.driver_number}
                className={`grid grid-cols-[3rem_1fr_1fr_1fr] gap-x-2 px-1 py-0.5 text-[10px] font-mono ${
                  row.driver_number === focalDriverNumber ? 'bg-zinc-900 border-l-2 border-l-acid' : ''
                }`}
              >
                <span className={row.driver_number === focalDriverNumber ? 'text-acid font-bold' : 'text-zinc-300'}>
                  {row.driver}
                </span>
                {[row.sector_1, row.sector_2, row.sector_3].map((s, i) => (
                  <span
                    key={i}
                    className={`text-right tabular-nums ${s?.is_fastest ? 'text-acid font-bold' : 'text-zinc-500'}`}
                  >
                    {s ? `${s.seconds.toFixed(3)}s` : '--'}
                  </span>
                ))}
              </div>
            ))}
            {!sectors && <div className="text-[10px] font-mono text-zinc-500">SYNCING...</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
