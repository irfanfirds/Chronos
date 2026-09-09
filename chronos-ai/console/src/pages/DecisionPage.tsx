import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRace } from '../RaceContext';
import {
  api, ApiError,
  type ChatTurn, type EngineerNote, type Stint, type LapDetail,
} from '../apiClient';
import { executeStrategyQuery, type TraceItem } from '../strategyEngine';
import { formatDriverName, formatLapTime } from '../format';
import { playTelemetryBlip } from '../audioEngine.js';

interface ChatMessage extends ChatTurn {
  trace?: TraceItem[];
  pending?: boolean;
}

/** Rolling-window pace trend: mean of the last N laps vs the N before those. */
function paceTrend(laps: LapDetail[], window = 5): number | null {
  const times = laps.map((l) => l.lap_time_seconds).filter((t): t is number => t != null);
  if (times.length < window * 2) return null;
  const recent = times.slice(-window);
  const prior = times.slice(-window * 2, -window);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return mean(recent) - mean(prior);
}

export const DecisionPage: React.FC = () => {
  const { scope, focalDriverNumber, focalDriver, lap, leaderboard } = useRace();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [notes, setNotes] = useState<EngineerNote[] | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');

  const [stints, setStints] = useState<Stint[] | null>(null);
  const [laps, setLaps] = useState<LapDetail[] | null>(null);

  useEffect(() => {
    if (!scope.event) return;
    let cancelled = false;
    api.notes(scope, focalDriverNumber).then((r) => !cancelled && setNotes(r.notes)).catch(() => {});
    api.stints(focalDriverNumber, scope).then((r) => !cancelled && setStints(r.stints)).catch(() => {});
    api.laps(focalDriverNumber, scope).then((r) => !cancelled && setLaps(r.laps)).catch(() => {});
    return () => { cancelled = true; };
  }, [scope.year, scope.event, focalDriverNumber]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Reset the conversation when the subject changes - prior turns were about a
  // different race/driver and would mislead the agent.
  useEffect(() => {
    setMessages([]);
  }, [scope.year, scope.event, focalDriverNumber]);

  const insights = useMemo(() => {
    if (!laps || laps.length === 0) return null;
    const withTimes = laps.filter((l) => l.lap_time_seconds != null);
    const best = withTimes.reduce((a, b) =>
      (a.lap_time_seconds ?? Infinity) <= (b.lap_time_seconds ?? Infinity) ? a : b
    );
    const last = laps[laps.length - 1];
    const trend = paceTrend(laps);
    return { best, last, trend, totalLaps: laps.length };
  }, [laps]);

  const sendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    playTelemetryBlip();
    setInput('');
    setChatError(null);
    setSending(true);

    const history: ChatTurn[] = messages
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [
      ...prev,
      { role: 'user', text },
      { role: 'model', text: 'Working…', pending: true },
    ]);

    try {
      const result = await executeStrategyQuery(
        text,
        {
          year: scope.year, event: scope.event,
          driver_number: focalDriverNumber, driver_code: focalDriver?.driver,
        },
        history
      );
      setMessages((prev) => [
        ...prev.filter((m) => !m.pending),
        { role: 'model', text: result.answer, trace: result.trace },
      ]);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.pending));
      setChatError(err instanceof ApiError ? err.message : 'Agent query failed.');
    } finally {
      setSending(false);
    }
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = noteBody.trim();
    if (!body) return;
    try {
      const created = await api.addNote({
        body, year: scope.year, event: scope.event,
        driver_number: focalDriverNumber, lap: lap ?? undefined, category: noteCategory,
      });
      setNotes((prev) => [created, ...(prev ?? [])]);
      setNoteBody('');
    } catch {
      /* surfaced by the empty-state below rather than blocking the page */
    }
  };

  const removeNote = async (id: number) => {
    try {
      await api.deleteNote(id);
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    } catch { /* no-op */ }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 divide-y-2 xl:divide-y-0 xl:divide-x-2 divide-line min-h-[calc(100vh-9rem)]">
      {/* Agent chat terminal */}
      <section className="xl:col-span-5 bg-panel p-5 flex flex-col">
        <div className="flex items-center justify-between border-b-2 border-line pb-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-acid" />
            <span className="font-headline text-lg tracking-normal text-white uppercase">
              Race Engineer Terminal
            </span>
          </div>
          <span className="text-[10px] font-mono text-zinc-400">
            {messages.length > 0 ? `${messages.filter((m) => !m.pending).length} TURNS` : 'MULTI-TURN'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 mb-3 min-h-[20rem] max-h-[34rem] pr-1">
          {messages.length === 0 && (
            <div className="border-2 border-dashed border-line p-4 text-[11px] font-mono text-zinc-500 leading-relaxed">
              Ask anything about{' '}
              <span className="text-acid">
                #{focalDriverNumber} {focalDriver ? formatDriverName(focalDriver.driver) : ''}
              </span>{' '}
              at{' '}
              <span className="text-acid">{scope.event ?? '--'}</span>. The agent already knows the
              race and driver from the selectors, and remembers this conversation — so follow-ups
              like "what about on hards?" work.
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`border-2 p-3 ${
                m.role === 'user' ? 'border-zinc-700 bg-black/40 ml-6' : 'border-line bg-card mr-2'
              }`}
            >
              <div className="text-[9px] font-mono uppercase tracking-wider mb-1 text-zinc-500">
                {m.role === 'user' ? 'STRATEGIST' : 'CHRONOS AGENT'}
              </div>
              <div
                className={`text-[11px] font-mono whitespace-pre-wrap leading-relaxed ${
                  m.pending ? 'text-zinc-500 animate-pulse' : 'text-zinc-200'
                }`}
              >
                {m.text}
              </div>
              {m.trace && m.trace.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[9px] font-mono text-acid cursor-pointer uppercase tracking-wider">
                    {m.trace.length} tool call(s) — show working
                  </summary>
                  <div className="mt-1 space-y-1">
                    {m.trace.map((t) => (
                      <div key={t.id} className="bg-black/60 border border-line p-1.5 text-[9px] font-mono">
                        <div className="text-white">#{t.id} {t.fn}</div>
                        <div className="text-zinc-400 break-words">&gt; {t.query}</div>
                        <div className={t.status === 'ERROR' ? 'text-red-400' : 'text-acid'}>
                          &gt; {t.result}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {chatError && (
          <div className="p-2 mb-2 bg-red-950/30 border border-red-500/60 text-[10px] font-mono text-red-300">
            {chatError}
          </div>
        )}

        <form onSubmit={sendMessage} className="flex border-2 border-line bg-black">
          <input
            className="flex-1 bg-transparent border-0 text-white font-mono text-xs p-3 focus:outline-none"
            placeholder="e.g. Is the undercut on here?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={sending}
            className="bg-acid text-black font-bold font-mono text-xs px-4 uppercase tracking-wider hover:bg-white transition-colors disabled:opacity-60 cursor-pointer"
          >
            {sending ? '…' : 'SEND ↗'}
          </button>
        </form>
      </section>

      {/* Performance insights + stint dismantling */}
      <section className="xl:col-span-4 bg-[#0e0f13] p-5 space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-line pb-3">
          <div className="w-2.5 h-2.5 bg-ultraviolet" />
          <span className="font-headline text-lg tracking-normal text-white uppercase">
            Performance Read
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          <div className="border-2 border-line bg-card p-2.5">
            <div className="text-zinc-400 uppercase tracking-wider text-[9px] mb-1">Best lap</div>
            <div className="font-headline text-xl text-acid">
              {insights ? formatLapTime(insights.best.lap_time_seconds) : '--'}
            </div>
            <div className="text-zinc-500">{insights ? `on lap ${insights.best.lap}` : ''}</div>
          </div>
          <div className="border-2 border-line bg-card p-2.5">
            <div className="text-zinc-400 uppercase tracking-wider text-[9px] mb-1">Last lap</div>
            <div className="font-headline text-xl text-white">
              {insights ? formatLapTime(insights.last.lap_time_seconds) : '--'}
            </div>
            <div className="text-zinc-500">{insights ? `lap ${insights.last.lap}` : ''}</div>
          </div>
          <div className="border-2 border-line bg-card p-2.5">
            <div className="text-zinc-400 uppercase tracking-wider text-[9px] mb-1">Pace trend (5 lap)</div>
            <div
              className={`font-headline text-xl ${
                insights?.trend == null ? 'text-zinc-500'
                  : insights.trend > 0.15 ? 'text-red-400'
                  : insights.trend < -0.15 ? 'text-acid' : 'text-white'
              }`}
            >
              {insights?.trend == null
                ? '--'
                : `${insights.trend >= 0 ? '+' : ''}${insights.trend.toFixed(3)}s`}
            </div>
            <div className="text-zinc-500">vs previous 5</div>
          </div>
          <div className="border-2 border-line bg-card p-2.5">
            <div className="text-zinc-400 uppercase tracking-wider text-[9px] mb-1">Track position</div>
            <div className="font-headline text-xl text-white">
              P{focalDriver?.position ?? '--'}
            </div>
            <div className="text-zinc-500">
              {focalDriver && focalDriver.position !== 1
                ? `+${focalDriver.gap_to_leader_seconds.toFixed(3)}s`
                : 'leader'}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold mb-2">
            // Stint breakdown
          </div>
          <div className="space-y-1.5">
            {(stints ?? []).map((s) => (
              <div key={`${s.stint}-${s.start_lap}`} className="border-2 border-line bg-card p-2 text-[10px] font-mono">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-white font-bold">
                    STINT {s.stint} — {s.compound}
                  </span>
                  <span className="text-zinc-400">L{s.start_lap}–L{s.end_lap} ({s.laps})</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[9px]">
                  <span className="text-zinc-400">
                    BEST <span className="text-acid">{s.best_lap_seconds.toFixed(3)}s</span>
                  </span>
                  <span className="text-zinc-400">
                    AVG <span className="text-white">{s.average_lap_seconds.toFixed(3)}s</span>
                  </span>
                  <span className="text-zinc-400">
                    DRIFT{' '}
                    <span className={(s.pace_drift_seconds ?? 0) > 0 ? 'text-red-400' : 'text-acid'}>
                      {s.pace_drift_seconds == null
                        ? '--'
                        : `${s.pace_drift_seconds >= 0 ? '+' : ''}${s.pace_drift_seconds.toFixed(2)}s`}
                    </span>
                  </span>
                </div>
              </div>
            ))}
            {!stints && <div className="text-[10px] font-mono text-zinc-500">SYNCING...</div>}
            {stints?.length === 0 && (
              <div className="text-[10px] font-mono text-zinc-500">No stint data for this driver.</div>
            )}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold mb-2">
            // Field context @ lap {lap ?? '--'}
          </div>
          <div className="border-2 border-line bg-card divide-y divide-line">
            {(leaderboard ?? []).slice(0, 5).map((d) => (
              <div
                key={d.driver_number}
                className={`flex justify-between px-2 py-1 text-[10px] font-mono ${
                  d.driver_number === focalDriverNumber ? 'bg-zinc-900 text-acid' : 'text-zinc-300'
                }`}
              >
                <span>P{d.position} {d.driver} <span className="text-zinc-500">{d.compound?.[0]}({d.tyre_life}L)</span></span>
                <span>{d.position === 1 ? 'LEADER' : `+${d.gap_to_leader_seconds.toFixed(3)}s`}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Engineer notes */}
      <section className="xl:col-span-3 bg-panel p-5 flex flex-col">
        <div className="flex items-center gap-2 border-b-2 border-line pb-3 mb-3">
          <div className="w-2.5 h-2.5 bg-acid" />
          <span className="font-headline text-lg tracking-normal text-white uppercase">
            Engineer Notes
          </span>
        </div>

        <form onSubmit={submitNote} className="mb-3">
          <textarea
            className="w-full bg-black border-2 border-line text-white font-mono text-[11px] p-2 h-24 focus:outline-none focus:border-acid resize-none"
            placeholder="Observation, call, or reminder…"
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <select
              className="bg-black border border-zinc-700 text-acid font-mono text-[10px] px-2 py-1 focus:outline-none focus:border-acid"
              value={noteCategory}
              onChange={(e) => setNoteCategory(e.target.value)}
            >
              {['general', 'tyres', 'pace', 'strategy', 'incident'].map((c) => (
                <option key={c} value={c}>{c.toUpperCase()}</option>
              ))}
            </select>
            <button
              type="submit"
              className="flex-1 bg-ultraviolet text-white font-bold font-mono text-[10px] px-3 py-1 uppercase tracking-wider hover:bg-acid hover:text-black transition-colors border-2 border-black cursor-pointer"
            >
              Save note
            </button>
          </div>
          <p className="text-[9px] text-zinc-500 font-mono mt-1">
            Saved against {scope.event ?? '--'} / #{focalDriverNumber}
            {lap ? ` / lap ${lap}` : ''}
          </p>
        </form>

        <div className="flex-1 overflow-y-auto space-y-2 max-h-[30rem]">
          {(notes ?? []).map((n) => (
            <div key={n.id} className="border-2 border-line bg-card p-2">
              <div className="flex justify-between items-start gap-2 mb-1">
                <span className="text-[9px] font-mono text-acid uppercase tracking-wider">
                  {n.category}{n.lap ? ` · L${n.lap}` : ''}
                </span>
                <button
                  onClick={() => removeNote(n.id)}
                  className="text-[10px] text-zinc-500 hover:text-red-400 leading-none"
                  title="Delete note"
                >
                  ✕
                </button>
              </div>
              <div className="text-[11px] font-mono text-zinc-200 whitespace-pre-wrap break-words">
                {n.body}
              </div>
              <div className="text-[8px] font-mono text-zinc-600 mt-1">
                {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
          ))}
          {notes?.length === 0 && (
            <div className="text-[10px] font-mono text-zinc-500 text-center py-4">
              No notes for this driver yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
