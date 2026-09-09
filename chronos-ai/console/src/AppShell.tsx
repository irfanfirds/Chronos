import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ChronosLogo } from './components/ChronosLogo';
import { useRace } from './RaceContext';
import { formatDriverName } from './format';

const NAV = [
  { to: '/', label: 'Race Ops', end: true },
  { to: '/decision', label: 'Decision' },
  { to: '/car', label: 'Car' },
  { to: '/analysis', label: 'Analysis' },
  { to: '/sandbox', label: 'Sandbox' },
];

export const AppShell: React.FC = () => {
  const {
    events, selectedEvent, setSelectedEvent,
    leaderboard, lap, focalDriverNumber, setFocalDriverNumber, error,
  } = useRace();

  const handleEventChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const found = events?.find((ev) => `${ev.year}::${ev.event_name}` === e.target.value);
    if (found) setSelectedEvent(found);
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#0c0d10]">
      {/* Masthead: logo + page nav */}
      <header className="border-b-2 border-line bg-panel flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-6">
          <ChronosLogo size={26} />
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider border-2 transition-colors ${
                    isActive
                      ? 'bg-acid text-black border-black font-bold'
                      : 'text-zinc-400 border-transparent hover:text-acid hover:border-zinc-700'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Global selection - shared by every page and by the agent */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Race</span>
          <select
            className="bg-black border border-zinc-700 text-acid font-mono text-xs px-2 py-1 max-w-[15rem] focus:outline-none focus:border-acid"
            value={selectedEvent ? `${selectedEvent.year}::${selectedEvent.event_name}` : ''}
            onChange={handleEventChange}
            disabled={!events}
          >
            {(events ?? []).map((ev) => (
              <option key={`${ev.year}::${ev.event_name}`} value={`${ev.year}::${ev.event_name}`}>
                {ev.year} R{ev.round} — {ev.event_name}
              </option>
            ))}
          </select>

          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold ml-1">Driver</span>
          <select
            className="bg-black border border-zinc-700 text-acid font-mono text-xs px-2 py-1 max-w-[14rem] focus:outline-none focus:border-acid"
            value={focalDriverNumber}
            onChange={(e) => setFocalDriverNumber(e.target.value)}
            disabled={!leaderboard}
          >
            {(leaderboard ?? []).map((d) => (
              <option key={d.driver_number} value={d.driver_number}>
                #{d.driver_number} {formatDriverName(d.driver)} — {d.team}
              </option>
            ))}
          </select>

          <span className="text-[10px] bg-acid text-black font-bold px-2 py-1 font-mono uppercase">
            LAP {lap ?? '--'}/{selectedEvent?.latest_lap ?? '--'}
          </span>
          {error && <span className="text-red-400 font-bold text-[10px]">{error}</span>}
        </div>
      </header>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>

      <footer className="border-t-2 border-line bg-black px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-zinc-400 select-none">
        <div className="flex items-center gap-4">
          <span className="text-acid font-bold">CHRONOS//CORE_ENGINE_ACTIVE</span>
          <span className="hidden md:inline text-zinc-600">|</span>
          <span className="hidden md:inline">SQLITE_TELEMETRY: READ-ONLY SAFE</span>
        </div>
        <div className="text-white font-bold tracking-widest text-[11px]">
          REAL FASTF1 TELEMETRY // {events?.length ?? '--'} RACES, 2025 SEASON - PRESENT
        </div>
      </footer>
    </div>
  );
};
