import React, { useEffect, useRef, useState } from 'react';
import { initThreeCarSimulation } from '../threeSimulation.js';
import type { CarTelemetryResponse, WearIndexResponse } from '../apiClient';

interface ChassisVisualizerProps {
  carTelemetry: CarTelemetryResponse | null;
  wearIndex: WearIndexResponse | null;
  onShowWearDetail?: () => void;
}

function fmtSeconds(v: number | null | undefined): string {
  return v == null ? '--' : `${v.toFixed(3)}s`;
}

function fmtSpeed(v: number | null | undefined): string {
  return v == null ? '--' : `${v.toFixed(0)} KPH`;
}

export const ChassisVisualizer: React.FC<ChassisVisualizerProps> = ({
  carTelemetry,
  wearIndex,
  onShowWearDetail,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<{
    destroy: () => void;
    resetRotation: () => void;
    updateWear: (pct: number | null) => void;
  } | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const controller = initThreeCarSimulation(containerRef.current, {
      onLoadingChange: setModelLoading,
      onError: setModelError,
    });
    controllerRef.current = controller;

    return () => {
      if (controllerRef.current) {
        controllerRef.current.destroy();
      }
    };
  }, []);

  // Push the one real wear value we have onto the model's tyre material(s)
  // whenever fresh telemetry arrives.
  useEffect(() => {
    controllerRef.current?.updateWear(wearIndex?.estimated_wear_pct ?? null);
  }, [wearIndex?.estimated_wear_pct]);

  return (
    <div className="w-full">
      {/* 3D Scene Viewport with live HUD */}
      <div className="border-2 border-line bg-black relative p-2 overflow-hidden mb-4">
        <div className="flex items-center justify-between px-2 pt-1 pb-2 border-b border-line text-[10px] font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-acid animate-ping" />
            <span className="text-white font-bold tracking-wider">SPATIAL SENSOR TELEMETRY</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-zinc-400">CHASSIS: W15 // ROTATION SYNC 120Hz</span>
            <button
              onClick={() => controllerRef.current?.resetRotation()}
              className="text-[9px] text-acid bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 hover:bg-acid hover:text-black transition-colors"
              title="Reset 360 degree turntable view"
            >
              RESET CAM
            </button>
          </div>
        </div>

        {/* Canvas container */}
        <div className="relative w-full h-72 md:h-80 bg-black/40 overflow-hidden" ref={containerRef}>
          {/* Real speed-trap readings (FastF1 SpeedFL / SpeedST - genuine published fields) */}
          <div className="absolute top-2 left-2 flex flex-col gap-1.5 pointer-events-none z-10">
            <div className="bg-black/85 border border-line px-2 py-1 flex items-center justify-between gap-3 text-[10px] font-mono">
              <span className="text-zinc-400">SPEED TRAP:</span>
              <span className="text-yellow-400 font-bold">{fmtSpeed(carTelemetry?.speed_trap_kph)}</span>
            </div>
            <div className="bg-black/85 border border-line px-2 py-1 flex items-center justify-between gap-3 text-[10px] font-mono">
              <span className="text-zinc-400">FINISH LINE:</span>
              <span className="text-acid font-bold">{fmtSpeed(carTelemetry?.speed_finish_line_kph)}</span>
            </div>
          </div>

          <div className="absolute top-2 right-2 bg-black/85 border border-line px-2 py-1 text-right pointer-events-none z-10">
            <div className="text-[9px] text-zinc-500 font-mono">LAP {carTelemetry?.lap ?? '--'}</div>
            <div className="text-[10px] text-acid font-mono font-bold">3D TURNTABLE</div>
          </div>

          {modelLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-black/85 border border-line px-3 py-1.5 text-[10px] font-mono text-acid animate-pulse">
                LOADING CHASSIS MODEL...
              </div>
            </div>
          )}

          {modelError && !modelLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-black/85 border border-red-500 px-3 py-1.5 text-[10px] font-mono text-red-400">
                CHASSIS MODEL UNAVAILABLE
              </div>
            </div>
          )}

          <div className="absolute bottom-2 left-2 bg-black/85 border border-line px-2 py-1 pointer-events-none text-[9px] font-mono text-zinc-400 z-10 flex items-center gap-2">
            <span>▲ FORWARD AERO AXIS</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-500 text-[8px]">DRAG TO ROTATE 360°</span>
          </div>
        </div>

        <div className="px-2 pt-1 text-[8px] font-mono text-zinc-600 leading-tight">
          3D model: "2026 F1 Car V3 Redesign" by Abu Saif (Sketchfab, CC BY 4.0)
        </div>

        {/* Real sector times, from the same lap the speed readings above are for */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-line text-center text-xs font-mono">
          <div className="bg-card border border-line p-1.5">
            <div className="text-[9px] text-zinc-400 uppercase">SECTOR 1</div>
            <div className="font-headline text-base tracking-normal text-white font-bold">
              {fmtSeconds(carTelemetry?.sector_1_seconds)}
            </div>
          </div>
          <div className="bg-card border border-line p-1.5">
            <div className="text-[9px] text-zinc-400 uppercase">SECTOR 2</div>
            <div className="font-headline text-base tracking-normal text-acid font-bold">
              {fmtSeconds(carTelemetry?.sector_2_seconds)}
            </div>
          </div>
          <div className="bg-card border border-line p-1.5">
            <div className="text-[9px] text-zinc-400 uppercase">SECTOR 3</div>
            <div className="font-headline text-base tracking-normal text-yellow-400 font-bold">
              {fmtSeconds(carTelemetry?.sector_3_seconds)}
            </div>
          </div>
        </div>
      </div>

      {/* Estimated tyre wear - explicitly labeled, not presented as sensor data */}
      <div className="border-2 border-line bg-card p-3 mb-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[11px] font-bold text-white uppercase tracking-wider font-mono">
            Estimated Wear Index
          </span>
          <span className="text-[10px] font-mono text-red-400 font-bold">CLIFF THRESHOLD: 85%</span>
        </div>
        <div className="text-[8px] text-zinc-500 font-mono mb-2 leading-tight">
          Modeled from tyre age vs. typical compound stint length - corner-level sensor
          data (carcass wear, core temp) is proprietary team telemetry, not public.
        </div>
        {wearIndex ? (
          <button
            onClick={onShowWearDetail}
            className="w-full text-left bg-black border border-line p-2 hover:border-acid transition-colors cursor-pointer"
          >
            <div className="flex justify-between text-[10px] font-mono mb-1">
              <span className="text-zinc-400">{wearIndex.compound} // {wearIndex.tyre_life_laps}L</span>
              <span
                className={`font-bold ${wearIndex.estimated_wear_pct >= 85 ? 'text-red-400' : 'text-amber-400'}`}
              >
                {wearIndex.estimated_wear_pct}%
              </span>
            </div>
            <div className="w-full bg-zinc-800 h-2 border border-zinc-700 p-0.5">
              <div
                className={`h-full ${wearIndex.estimated_wear_pct >= 85 ? 'bg-red-500' : 'bg-amber-500'}`}
                style={{ width: `${wearIndex.estimated_wear_pct}%` }}
              />
            </div>
          </button>
        ) : (
          <div className="text-[10px] text-zinc-500 font-mono">SYNCING...</div>
        )}
      </div>
    </div>
  );
};
