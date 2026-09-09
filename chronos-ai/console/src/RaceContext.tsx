import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type LeaderboardDriver,
  type RaceEvent,
} from './apiClient';

const PREFERRED_DRIVER_NUMBER = '44';

interface RaceContextValue {
  events: RaceEvent[] | null;
  selectedEvent: RaceEvent | null;
  setSelectedEvent: (e: RaceEvent) => void;
  leaderboard: LeaderboardDriver[] | null;
  lap: number | null;
  focalDriverNumber: string;
  setFocalDriverNumber: (n: string) => void;
  focalDriver: LeaderboardDriver | null;
  scope: { year?: number; event?: string };
  error: string | null;
}

const RaceCtx = createContext<RaceContextValue | null>(null);

/**
 * Holds the race + driver selection for the whole console. Lifting it above the
 * router means switching pages keeps whatever the strategist had selected, and
 * every page (and the agent) reads the same subject.
 */
export const RaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [events, setEvents] = useState<RaceEvent[] | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<RaceEvent | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardDriver[] | null>(null);
  const [lap, setLap] = useState<number | null>(null);
  const [focalDriverNumber, setFocalDriverNumber] = useState<string>(PREFERRED_DRIVER_NUMBER);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.events()
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events);
        if (res.events.length > 0) setSelectedEvent(res.events[0]);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load race calendar.');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedEvent) return;
    let cancelled = false;
    setLeaderboard(null);

    api.leaderboard({ year: selectedEvent.year, event: selectedEvent.event_name })
      .then((board) => {
        if (cancelled) return;
        setLap(board.lap);
        setLeaderboard(board.drivers);
        // Lineups change between races and seasons - fall back to the leader if
        // the currently selected driver didn't run this one.
        setFocalDriverNumber((current) =>
          board.drivers.some((d) => d.driver_number === current)
            ? current
            : board.drivers[0]?.driver_number ?? current
        );
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load leaderboard.');
      });

    return () => { cancelled = true; };
  }, [selectedEvent]);

  const value = useMemo<RaceContextValue>(() => ({
    events,
    selectedEvent,
    setSelectedEvent,
    leaderboard,
    lap,
    focalDriverNumber,
    setFocalDriverNumber,
    focalDriver: leaderboard?.find((d) => d.driver_number === focalDriverNumber) ?? null,
    scope: selectedEvent
      ? { year: selectedEvent.year, event: selectedEvent.event_name }
      : {},
    error,
  }), [events, selectedEvent, leaderboard, lap, focalDriverNumber, error]);

  return <RaceCtx.Provider value={value}>{children}</RaceCtx.Provider>;
};

export function useRace(): RaceContextValue {
  const ctx = useContext(RaceCtx);
  if (!ctx) throw new Error('useRace must be used inside a RaceProvider');
  return ctx;
}
