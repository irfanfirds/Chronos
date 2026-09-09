import React, { useMemo } from 'react';
import type { CircuitMapResponse, DriverSectorRow } from '../apiClient';
import { formatDriverName } from '../format';

interface CircuitMapProps {
  circuit: CircuitMapResponse | null;
  circuitLoading: boolean;
  sectors: DriverSectorRow[] | null;
  sectorLap?: number | null;
  focalDriverNumber: string;
}

const VIEW_SIZE = 320;
const PAD = 20;

function fmtSector(split: DriverSectorRow['sector_1']): string {
  if (!split) return '--';
  return `${split.seconds.toFixed(3)}s`;
}

export const CircuitMap: React.FC<CircuitMapProps> = ({
  circuit, circuitLoading, sectors, sectorLap, focalDriverNumber,
}) => {
  const path = useMemo(() => {
    if (!circuit || circuit.points.length === 0) return null;

    const xs = circuit.points.map((p) => p.X);
    const ys = circuit.points.map((p) => p.Y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = (VIEW_SIZE - 2 * PAD) / Math.max(maxX - minX, maxY - minY);

    // Track X/Y is in an arbitrary FastF1 sensor frame; flip Y since SVG's
    // y-axis points down while the telemetry frame points up.
    const project = (x: number, y: number) => ({
      x: PAD + (x - minX) * scale,
      y: VIEW_SIZE - PAD - (y - minY) * scale,
    });

    const trackPath = circuit.points.map((p) => project(p.X, p.Y)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ');
    const apexPoints = circuit.apexes.map((a) => ({ ...project(a.X, a.Y), apex: a }));

    return { trackPath, apexPoints };
  }, [circuit]);

  const rankedSectors = useMemo(() => {
    if (!sectors) return [];
    return [...sectors].slice(0, 6);
  }, [sectors]);

  return (
    <div className="border-2 border-line bg-card p-3">
      <div className="flex justify-between items-center mb-2 pb-2 border-b border-line">
        <span className="text-[11px] font-bold text-white uppercase tracking-wider font-mono">
          Circuit Map &amp; Sector Insights
        </span>
        <span className="text-[9px] text-zinc-400 font-mono">
          {circuit?.available ? `${circuit.apexes.length} APEXES DETECTED` : circuitLoading ? 'FETCHING...' : 'NO DATA'}
        </span>
      </div>

      {/* Stacked, not side-by-side: this panel lives in the narrow right column,
          where two columns squeeze the sector times until S3 clips. */}
      <div className="grid grid-cols-1 gap-3">
        <div className="bg-black border border-line p-2 flex items-center justify-center">
          {path ? (
            <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} className="w-full h-auto max-h-56">
              <path d={`M ${path.trackPath}`} fill="none" stroke="#c8ff00" strokeWidth="2" strokeLinejoin="round" />
              {path.apexPoints.map((p) => (
                <g key={p.apex.ApexNumber}>
                  <circle cx={p.x} cy={p.y} r="4" fill="#ef4444" stroke="#000" strokeWidth="1" />
                  <text x={p.x} y={p.y - 6} fill="#ef4444" fontFamily="monospace" fontSize="7" textAnchor="middle">
                    {p.apex.ApexNumber}
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <div className="text-[10px] font-mono text-zinc-500 text-center py-8">
              {circuitLoading ? 'Fetching real X/Y telemetry for this circuit...' : 'Circuit map unavailable'}
            </div>
          )}
        </div>

        <div className="text-[10px] font-mono min-w-0 overflow-hidden">
          <div className="text-zinc-400 uppercase tracking-wider mb-1.5 font-bold truncate">
            Sector Times{sectorLap != null ? ` @ Lap ${sectorLap}` : ''}
          </div>
          {/* Fixed 4-column grid rather than flex: driver codes and sector splits
              have predictable widths, so nothing can push the box open. */}
          <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-x-2 text-[9px] text-zinc-500 uppercase mb-0.5 px-1">
            <span />
            <span className="text-right">S1</span>
            <span className="text-right">S2</span>
            <span className="text-right">S3</span>
          </div>
          <div className="space-y-0.5">
            {rankedSectors.map((row) => {
              const isFocal = row.driver_number === focalDriverNumber;
              return (
                <div
                  key={row.driver_number}
                  className={`grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-x-2 items-center px-1 py-0.5 ${
                    isFocal ? 'bg-zinc-900 border-l-2 border-l-acid' : ''
                  }`}
                  title={formatDriverName(row.driver)}
                >
                  <span className={`truncate ${isFocal ? 'text-acid font-bold' : 'text-zinc-300'}`}>
                    {row.driver}
                  </span>
                  <span className={`text-right tabular-nums ${row.sector_1?.is_fastest ? 'text-acid font-bold' : 'text-zinc-500'}`}>
                    {fmtSector(row.sector_1)}
                  </span>
                  <span className={`text-right tabular-nums ${row.sector_2?.is_fastest ? 'text-acid font-bold' : 'text-zinc-500'}`}>
                    {fmtSector(row.sector_2)}
                  </span>
                  <span className={`text-right tabular-nums ${row.sector_3?.is_fastest ? 'text-acid font-bold' : 'text-zinc-500'}`}>
                    {fmtSector(row.sector_3)}
                  </span>
                </div>
              );
            })}
            {!sectors && <div className="text-zinc-500 text-center py-2">SYNCING...</div>}
          </div>
        </div>
      </div>
      <div className="text-[8px] text-zinc-500 font-mono mt-2 pt-2 border-t border-line leading-tight">
        Track outline and apex markers are real X/Y position telemetry from the fastest
        recorded lap. Sector times are real per-lap FastF1 fields; acid-green highlights
        the fastest sector in the field.
      </div>
    </div>
  );
};
