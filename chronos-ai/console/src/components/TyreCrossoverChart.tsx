import React, { useMemo } from 'react';
import type { DegradationPoint } from '../apiClient';

interface TyreCrossoverChartProps {
  actual: DegradationPoint[];
  projected: DegradationPoint[];
}

const VIEW_W = 540;
const VIEW_H = 160;
const PAD_L = 40;
const PAD_R = 20;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;

export const TyreCrossoverChart: React.FC<TyreCrossoverChartProps> = ({ actual, projected }) => {
  const chart = useMemo(() => {
    if (actual.length === 0) return null;

    const allPoints = [...actual, ...projected];
    const laps = allPoints.map((p) => p.lap);
    const times = allPoints.map((p) => p.lap_time_seconds);

    const lapMin = Math.min(...laps);
    const lapMax = Math.max(...laps);
    const timeMin = Math.min(...times);
    const timeMax = Math.max(...times);
    const timePad = (timeMax - timeMin) * 0.1 || 1;

    const x = (lap: number) =>
      PAD_L + ((lap - lapMin) / (lapMax - lapMin || 1)) * (VIEW_W - PAD_L - PAD_R);
    const y = (t: number) =>
      PAD_TOP +
      (1 - (t - (timeMin - timePad)) / (timeMax + timePad - (timeMin - timePad) || 1)) *
        (VIEW_H - PAD_TOP - PAD_BOTTOM);

    const actualPath = actual.map((p) => `${x(p.lap)},${y(p.lap_time_seconds)}`).join(' L ');
    const bridge = [actual[actual.length - 1], ...projected];
    const projectedPath = bridge.map((p) => `${x(p.lap)},${y(p.lap_time_seconds)}`).join(' L ');

    const gridLapTicks = Array.from(new Set(laps.filter((_, i) => i % Math.ceil(laps.length / 6) === 0)));

    return { x, y, actualPath, projectedPath, gridLapTicks, timeMin, timeMax, lapMin, lapMax };
  }, [actual, projected]);

  if (!chart) {
    return (
      <div className="border-2 border-line bg-card p-3 text-center text-[10px] font-mono text-zinc-500">
        SYNCING TELEMETRY...
      </div>
    );
  }

  const lastActual = actual[actual.length - 1];
  const lastProjected = projected[projected.length - 1];
  const deltaVsFirstProjected =
    projected.length > 0 ? projected[0].lap_time_seconds - lastActual.lap_time_seconds : null;

  return (
    <div className="border-2 border-line bg-card p-3">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2 pb-2 border-b border-line">
        <div>
          <div className="text-[11px] font-bold text-white uppercase tracking-wider font-mono">
            Lap-Time History &amp; Model Projection
          </div>
          <div className="text-[9px] text-zinc-400 font-mono">
            LAP {chart.lapMin} — {chart.lapMax} // ACTUAL DATA + REAL MODEL FORECAST
          </div>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-1 bg-acid inline-block" />
            <span className="text-zinc-300">ACTUAL LAP TIME</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-1 bg-ultraviolet inline-block" />
            <span className="text-zinc-300">MODEL PROJECTION</span>
          </div>
        </div>
      </div>

      <div className="w-full bg-black border border-line p-2 relative">
        <svg className="w-full h-40 overflow-visible select-none" preserveAspectRatio="none" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          {[chart.timeMin, (chart.timeMin + chart.timeMax) / 2, chart.timeMax].map((t) => (
            <g key={t}>
              <line
                stroke="#1f2127" strokeDasharray="2 2" strokeWidth="1"
                x1={PAD_L} x2={VIEW_W - PAD_R} y1={chart.y(t)} y2={chart.y(t)}
              />
              <text fill="#666" fontFamily="monospace" fontSize="8" x={PAD_L - 8} y={chart.y(t) + 3} textAnchor="end">
                {t.toFixed(1)}s
              </text>
            </g>
          ))}

          {chart.gridLapTicks.map((lap) => (
            <g key={lap}>
              <line stroke="#1c1e24" strokeWidth="1" x1={chart.x(lap)} x2={chart.x(lap)} y1={PAD_TOP} y2={VIEW_H - PAD_BOTTOM} />
              <text fill="#666" fontFamily="monospace" fontSize="8" textAnchor="middle" x={chart.x(lap)} y={VIEW_H - 6}>
                L{lap}
              </text>
            </g>
          ))}

          <path d={`M ${chart.actualPath}`} fill="none" stroke="#c8ff00" strokeWidth="2.5" />
          {projected.length > 0 && (
            <path d={`M ${chart.projectedPath}`} fill="none" stroke="#a855f7" strokeDasharray="4 3" strokeWidth="2.5" />
          )}

          <circle
            cx={chart.x(lastActual.lap)} cy={chart.y(lastActual.lap_time_seconds)}
            fill="#c8ff00" r="4.5" stroke="#000" strokeWidth="2"
          />
          {lastProjected && (
            <text
              fill="#a855f7" fontFamily="monospace" fontSize="8" fontWeight="bold"
              x={chart.x(lastProjected.lap)} y={chart.y(lastProjected.lap_time_seconds) - 8}
              textAnchor="end"
            >
              L{lastProjected.lap}: {lastProjected.lap_time_seconds.toFixed(2)}s
            </text>
          )}
        </svg>
      </div>

      <div className="border-t border-line pt-2 mt-2 text-[9px] text-zinc-500 font-mono uppercase tracking-widest flex justify-between">
        <span>LAST ACTUAL: L{lastActual.lap} @ {lastActual.lap_time_seconds.toFixed(3)}s</span>
        <span>
          {deltaVsFirstProjected != null
            ? `NEXT-LAP MODEL DELTA: ${deltaVsFirstProjected >= 0 ? '+' : ''}${deltaVsFirstProjected.toFixed(3)}s`
            : ''}
        </span>
      </div>
    </div>
  );
};
