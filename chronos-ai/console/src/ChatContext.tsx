import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRace } from './RaceContext';
import { api, ApiError, type ChatTurn, type ConversationSummary, type ToolCall } from './apiClient';
import { executeStrategyQuery, toTraceItems, type TraceItem } from './strategyEngine';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  trace?: TraceItem[];
  toolCalls?: ToolCall[];
  pending?: boolean;
}

interface ChatContextValue {
  conversations: ConversationSummary[] | null;
  activeConversationId: number | null;
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  startNew: () => void;
  selectConversation: (id: number) => void;
  renameConversation: (id: number, title: string) => void;
  deleteConversationById: (id: number) => void;
  sendMessage: (text: string) => Promise<void>;
}

const ChatCtx = createContext<ChatContextValue | null>(null);

function draftTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || 'New conversation';
}

/**
 * Chat state for the whole console, lifted above the router.
 *
 * The Decision page is a route element - React unmounts it on every navigation
 * away and remounts a fresh instance on the way back, so `useState` inside that
 * page cannot survive a page switch no matter how it's reset. Living here
 * instead means the conversation is still there when the strategist comes back,
 * and persisting every turn to the backend means it also survives a full reload
 * and lets more than one named conversation exist per (race, driver).
 */
export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { scope, focalDriverNumber, focalDriver } = useRace();

  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the identity of the scope should trigger a reload - not every render.
  const scopeKey = `${scope.year ?? ''}::${scope.event ?? ''}::${focalDriverNumber}`;

  useEffect(() => {
    if (!scope.event) return;
    let cancelled = false;

    api.conversations(scope, focalDriverNumber)
      .then(async (res) => {
        if (cancelled) return;
        setConversations(res.conversations);
        // Auto-resume the most recently used conversation for this exact
        // (race, driver) pair - "click back to the same race/driver and the
        // previous conversation is still there" without the user re-selecting it.
        if (res.conversations.length > 0) {
          const mostRecent = res.conversations[0];
          const full = await api.conversation(mostRecent.id);
          if (cancelled) return;
          setActiveConversationId(full.id);
          setMessages(full.messages.map((m) => ({
            role: m.role,
            text: m.text,
            toolCalls: m.tool_calls ?? undefined,
            trace: m.tool_calls ? toTraceItems(m.tool_calls) : undefined,
          })));
        } else {
          setActiveConversationId(null);
          setMessages([]);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load conversations.');
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const startNew = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  const selectConversation = useCallback((id: number) => {
    if (id === activeConversationId) return;
    setError(null);
    api.conversation(id)
      .then((full) => {
        setActiveConversationId(full.id);
        setMessages(full.messages.map((m) => ({
          role: m.role,
          text: m.text,
          toolCalls: m.tool_calls ?? undefined,
          trace: m.tool_calls ? toTraceItems(m.tool_calls) : undefined,
        })));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load that conversation.'));
  }, [activeConversationId]);

  const renameConversation = useCallback((id: number, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setConversations((prev) => (prev ?? []).map((c) => (c.id === id ? { ...c, title: trimmed } : c)));
    api.updateConversation(id, { title: trimmed }).catch(() => {
      // Best-effort: a failed rename just means the old title persists on next reload.
    });
  }, []);

  const deleteConversationById = useCallback((id: number) => {
    api.deleteConversation(id).catch(() => {});
    setConversations((prev) => (prev ?? []).filter((c) => c.id !== id));
    if (id === activeConversationId) {
      setActiveConversationId(null);
      setMessages([]);
    }
  }, [activeConversationId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);

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
        { year: scope.year, event: scope.event, driver_number: focalDriverNumber, driver_code: focalDriver?.driver },
        history
      );

      const finalMessages: ChatMessage[] = [
        ...messages,
        { role: 'user', text },
        { role: 'model', text: result.answer, trace: result.trace, toolCalls: result.toolCalls },
      ];
      setMessages(finalMessages);

      let convId = activeConversationId;
      if (convId == null) {
        const created = await api.createConversation({
          year: scope.year, event: scope.event, driver_number: focalDriverNumber,
          title: draftTitle(text),
        });
        convId = created.id;
        setActiveConversationId(convId);
        setConversations((prev) => [
          { id: created.id, year: created.year, event_name: created.event_name, driver_number: created.driver_number,
            title: created.title, message_count: 0, created_at: created.created_at, updated_at: created.created_at },
          ...(prev ?? []),
        ]);
      }

      const updated = await api.updateConversation(convId, {
        messages: finalMessages.map((m) => ({ role: m.role, text: m.text, tool_calls: m.toolCalls ?? null })),
      });
      setConversations((prev) =>
        (prev ?? []).map((c) => (c.id === convId
          ? { ...c, message_count: updated.messages.length, updated_at: updated.updated_at, title: updated.title }
          : c))
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      );
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.pending));
      setError(err instanceof ApiError ? err.message : 'Agent query failed.');
    } finally {
      setSending(false);
    }
  }, [messages, sending, scope, focalDriverNumber, focalDriver, activeConversationId]);

  const value = useMemo<ChatContextValue>(() => ({
    conversations, activeConversationId, messages, sending, error,
    startNew, selectConversation, renameConversation, deleteConversationById, sendMessage,
  }), [conversations, activeConversationId, messages, sending, error,
      startNew, selectConversation, renameConversation, deleteConversationById, sendMessage]);

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
};

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error('useChat must be used inside a ChatProvider');
  return ctx;
}
