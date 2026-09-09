/**
 * Adapts the real agent's tool-call trace (api.agentQuery) into the trace-item
 * shape the terminal panel renders. This file used to contain a hardcoded
 * keyword matcher that returned one of four canned scripts regardless of what
 * the backend could actually determine - it no longer does; every trace item
 * below is built from a real tool call Gemini made against real telemetry.
 */
import { api, type AgentContext, type ChatTurn, type ToolCall } from './apiClient';

export interface TraceItem {
  id: number;
  fn: string;
  source: string;
  query: string;
  result: string;
  status: 'SUCCESS' | 'ERROR';
  highlight: boolean;
}

export interface StrategyResult {
  answer: string;
  trace: TraceItem[];
  /** Raw tool calls, kept alongside the derived `trace` so a caller that persists
   *  this turn (e.g. a saved conversation) can store them and rebuild an
   *  identical `trace` later via `toTraceItems()`, rather than losing that
   *  fidelity to only the display-formatted strings. */
  toolCalls: ToolCall[];
}

const TOOL_LABELS: Record<string, string> = {
  query_telemetry: 'chronos.db : SQL READ-ONLY',
  predict_lap_time: 'RandomForestRegressor (trained model)',
};

function isErrorResult(text: string): boolean {
  return text.startsWith('SQL error') || text.startsWith('Prediction error');
}

function formatQuery(call: ToolCall): string {
  if (call.tool === 'query_telemetry') {
    return String(call.input.sql ?? '');
  }
  const parts = Object.entries(call.input).map(([k, v]) => `${k}=${v}`);
  return parts.join(', ');
}

function formatResult(call: ToolCall): string {
  const raw = call.result;
  if (call.tool === 'query_telemetry' && typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { rows: unknown[][]; cols: string[] };
      if (parsed.rows.length === 0) return 'No matching rows';
      const [first] = parsed.rows;
      const preview = parsed.cols.map((c, i) => `${c}=${first[i]}`).join(', ');
      return parsed.rows.length === 1 ? preview : `${preview} (+${parsed.rows.length - 1} more row(s))`;
    } catch {
      return raw;
    }
  }
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

export function toTraceItems(toolCalls: ToolCall[]): TraceItem[] {
  return toolCalls.map((call, i) => {
    const resultText = formatResult(call);
    return {
      id: i + 1,
      fn: `${call.tool}()`,
      source: TOOL_LABELS[call.tool] ?? call.tool,
      query: formatQuery(call),
      result: resultText,
      status: isErrorResult(resultText) ? 'ERROR' : 'SUCCESS',
      highlight: i === toolCalls.length - 1,
    };
  });
}

export async function executeStrategyQuery(
  prompt: string,
  context: AgentContext = {},
  history?: ChatTurn[]
): Promise<StrategyResult> {
  const response = await api.agentQuery(prompt, context, history);
  return { answer: response.answer, trace: toTraceItems(response.tool_calls), toolCalls: response.tool_calls };
}
