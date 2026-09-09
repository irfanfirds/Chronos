import React from 'react';
import { StrategySandbox } from '../components/StrategySandbox';
import { useRace } from '../RaceContext';

export const SandboxPage: React.FC = () => {
  const { selectedEvent } = useRace();

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-2 border-b-2 border-line pb-3">
        <div className="w-2.5 h-2.5 bg-ultraviolet" />
        <span className="font-headline text-lg tracking-normal text-white uppercase">
          Predictions Sandbox
        </span>
      </div>

      <p className="text-[11px] font-mono text-zinc-400 leading-relaxed max-w-4xl">
        Project a stint that never happened. Pick a circuit, compound, tyre age, and conditions,
        and the trained model returns a lap-by-lap forecast — the same model the agent calls,
        so the numbers here and the numbers it quotes come from one source.
      </p>

      <StrategySandbox defaultEvent={selectedEvent?.event_name} />
    </div>
  );
};
