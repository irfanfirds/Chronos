/**
 * Typed client for the Chronos FastAPI backend (../../api/main.py).
 *
 * This is the ONLY place the console talks to the backend. No component ever
 * reaches Gemini, SQLite, or the ML model directly - the browser holds no API
 * key and no data-shaping logic that duplicates the backend's.
 *
 * The telemetry table spans many real races (2025 season + 2026 to date), so
 * every race-scoped call takes an optional `RaceScope` - omit it to get the
 * backend's default (the most recently ingested race).
 */
const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';

export interface RaceScope {
  year?: number;
  event?: string;
}

export interface RaceEvent {
  year: number;
  event_name: string;
  round: number;
  country: string;
  location: string;
  latest_lap: number;
}

export interface LeaderboardDriver {
  driver_number: string;
  driver: string;
  team: string;
  position: number | null;
  compound: string;
  tyre_life: number | null;
  lap_time_seconds: number | null;
  gap_to_leader_seconds: number;
}

export interface LeaderboardResponse {
  year: number;
  event: string;
  lap: number;
  drivers: LeaderboardDriver[];
}

export interface DegradationPoint {
  lap: number;
  lap_time_seconds: number;
  compound: string;
  tyre_life?: number | null;
}

export interface DegradationResponse {
  year: number;
  event: string;
  driver_number: string;
  actual: DegradationPoint[];
  projected: DegradationPoint[];
}

export interface PaceDeltaEntry {
  driver_number: string;
  driver: string;
  lap_time_seconds: number;
  delta_seconds: number;
}

export interface WearIndexResponse {
  year: number;
  event: string;
  driver_number: string;
  compound: string;
  tyre_life_laps: number;
  estimated_wear_pct: number;
  is_estimated: true;
  method: string;
}

export interface CarTelemetryResponse {
  year: number;
  event: string;
  lap: number;
  sector_1_seconds: number | null;
  sector_2_seconds: number | null;
  sector_3_seconds: number | null;
  speed_finish_line_kph: number | null;
  speed_trap_kph: number | null;
}

export interface SectorSplit {
  seconds: number;
  is_fastest: boolean;
}

export interface DriverSectorRow {
  driver_number: string;
  driver: string;
  position: number | null;
  sector_1: SectorSplit | null;
  sector_2: SectorSplit | null;
  sector_3: SectorSplit | null;
}

export interface SectorInsightsResponse {
  year: number;
  event: string;
  lap: number;
  drivers: DriverSectorRow[];
}

export interface CircuitPoint {
  Distance: number;
  X: number;
  Y: number;
  Speed: number;
}

export interface CircuitApex extends CircuitPoint {
  ApexNumber: number;
}

export interface CircuitMapResponse {
  year: number;
  event: string;
  available: boolean;
  points: CircuitPoint[];
  apexes: CircuitApex[];
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  result: unknown;
}

export interface AgentQueryResponse {
  prompt: string;
  tool_calls: ToolCall[];
  answer: string;
}

/** The race + driver the console has selected, sent with each agent query so the
 *  agent already knows the subject instead of having to ask. */
export interface AgentContext {
  year?: number;
  event?: string;
  driver_number?: string;
  driver_code?: string;
}

export interface SimulationLap {
  lap_number: number | null;
  tyre_life: number;
  lap_time_seconds: number;
}

export interface SimulationResponse {
  event: string;
  compound: string;
  laps: SimulationLap[];
  total_seconds: number;
  average_seconds: number;
  degradation_seconds: number;
}

export interface SimulationOptions {
  events: string[];
  compounds: string[];
}

export interface LapDetail {
  lap: number;
  position: number | null;
  lap_time_seconds: number | null;
  compound: string;
  tyre_life: number | null;
  stint: number | null;
  fresh_tyre: boolean | null;
  track_status: string;
  sector_1_seconds: number | null;
  sector_2_seconds: number | null;
  sector_3_seconds: number | null;
  speed_trap_kph: number | null;
  speed_finish_line_kph: number | null;
  track_temp: number | null;
  air_temp: number | null;
  humidity: number | null;
  wind_speed: number | null;
  rainfall: number | null;
  estimated_wear_pct: number | null;
}

export interface Stint {
  stint: number | null;
  compound: string;
  start_lap: number;
  end_lap: number;
  laps: number;
  best_lap_seconds: number;
  average_lap_seconds: number;
  pace_drift_seconds: number | null;
}

export interface EngineerNote {
  id: number;
  year: number | null;
  event_name: string | null;
  driver_number: string | null;
  lap: number | null;
  category: string;
  body: string;
  created_at: string;
}

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface ConversationMessage {
  role: 'user' | 'model';
  text: string;
  tool_calls?: ToolCall[] | null;
}

export interface ConversationSummary {
  id: number;
  year: number | null;
  event_name: string | null;
  driver_number: string | null;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Omit<ConversationSummary, 'message_count'> {
  messages: ConversationMessage[];
}

export interface TeamReportRow {
  team: string;
  drivers: string[];
  best_lap_seconds: number;
  avg_clean_lap_seconds: number | null;
  laps_completed: number;
  primary_compound: string | null;
  compound_breakdown: Record<string, number>;
  best_finishing_position: number | null;
  gap_to_fastest_team_seconds: number | null;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError('Cannot reach the Chronos backend. Is `uvicorn api.main:app` running?', 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.detail || `Request failed with status ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  events: () => request<{ events: RaceEvent[] }>('/api/events'),

  leaderboard: (scope: RaceScope = {}, lap?: number) =>
    request<LeaderboardResponse>(`/api/leaderboard${qs({ year: scope.year, event: scope.event, lap })}`),

  degradation: (driverNumber: string, scope: RaceScope = {}, horizon = 4) =>
    request<DegradationResponse>(
      `/api/degradation/${driverNumber}${qs({ year: scope.year, event: scope.event, horizon })}`
    ),

  paceDelta: (lap: number, driverNumbers: string[], scope: RaceScope = {}) =>
    request<{ year: number; event: string; lap: number; deltas: PaceDeltaEntry[] }>(
      `/api/pace-delta${qs({ year: scope.year, event: scope.event, lap, drivers: driverNumbers.join(',') })}`
    ),

  wearIndex: (driverNumber: string, scope: RaceScope = {}, lap?: number) =>
    request<WearIndexResponse>(
      `/api/wear-index/${driverNumber}${qs({ year: scope.year, event: scope.event, lap })}`
    ),

  carTelemetry: (driverNumber: string, scope: RaceScope = {}, lap?: number) =>
    request<CarTelemetryResponse>(
      `/api/car-telemetry/${driverNumber}${qs({ year: scope.year, event: scope.event, lap })}`
    ),

  sectors: (scope: RaceScope = {}, lap?: number) =>
    request<SectorInsightsResponse>(`/api/sectors${qs({ year: scope.year, event: scope.event, lap })}`),

  circuit: (scope: RaceScope = {}) =>
    request<CircuitMapResponse>(`/api/circuit${qs({ year: scope.year, event: scope.event })}`),

  agentQuery: (prompt: string, context: AgentContext = {}, history?: ChatTurn[]) =>
    request<AgentQueryResponse>('/api/agent/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...context, ...(history?.length ? { history } : {}) }),
    }),

  laps: (driverNumber: string, scope: RaceScope = {}) =>
    request<{ year: number; event: string; driver_number: string; laps: LapDetail[] }>(
      `/api/laps/${driverNumber}${qs({ year: scope.year, event: scope.event })}`
    ),

  stints: (driverNumber: string, scope: RaceScope = {}) =>
    request<{ year: number; event: string; driver_number: string; stints: Stint[] }>(
      `/api/stints/${driverNumber}${qs({ year: scope.year, event: scope.event })}`
    ),

  notes: (scope: RaceScope = {}, driverNumber?: string) =>
    request<{ notes: EngineerNote[] }>(
      `/api/notes${qs({ year: scope.year, event: scope.event, driver_number: driverNumber })}`
    ),

  addNote: (body: {
    body: string; year?: number; event?: string; driver_number?: string;
    lap?: number; category?: string;
  }) =>
    request<EngineerNote>('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteNote: (id: number) =>
    request<{ deleted: number }>(`/api/notes/${id}`, { method: 'DELETE' }),

  simulationOptions: () => request<SimulationOptions>('/api/simulate/options'),

  teamReport: (scope: RaceScope = {}) =>
    request<{ year: number; event: string; teams: TeamReportRow[] }>(
      `/api/team-report${qs({ year: scope.year, event: scope.event })}`
    ),

  conversations: (scope: RaceScope = {}, driverNumber?: string) =>
    request<{ conversations: ConversationSummary[] }>(
      `/api/conversations${qs({ year: scope.year, event: scope.event, driver_number: driverNumber })}`
    ),

  conversation: (id: number) => request<ConversationDetail>(`/api/conversations/${id}`),

  createConversation: (body: { year?: number; event?: string; driver_number?: string; title?: string }) =>
    request<ConversationDetail>('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  updateConversation: (id: number, body: { title?: string; messages?: ConversationMessage[] }) =>
    request<ConversationDetail>(`/api/conversations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteConversation: (id: number) =>
    request<{ deleted: number }>(`/api/conversations/${id}`, { method: 'DELETE' }),

  simulate: (body: {
    event: string;
    compound: string;
    tyre_life: number;
    lap_number?: number;
    stint_length?: number;
    track_temp?: number;
    air_temp?: number;
    rainfall?: number;
  }) =>
    request<SimulationResponse>('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
