/** Formatting helpers shared across the console UI. Pure functions, no data fetching. */

/** 96.034 -> "1:36.034" */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null) return '--:--.---';
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${rest}`;
}

export function formatGap(seconds: number, position: number | null): string {
  if (position === 1) return 'LEADER';
  return `+${seconds.toFixed(3)}s`;
}

export function formatCompoundLetter(compound: string): string {
  return (compound || '?').charAt(0).toUpperCase();
}

// Public FastF1/F1 driver-code -> family name lookup, for display only. Every
// other field on a leaderboard row (team, compound, gap, lap time) is real API
// data; this map exists purely to render "L. HAMILTON" instead of the raw "HAM"
// code and carries no analytical claim.
const DRIVER_DISPLAY_NAMES: Record<string, string> = {
  HAM: 'L. HAMILTON', VER: 'M. VERSTAPPEN', NOR: 'L. NORRIS', PIA: 'O. PIASTRI',
  LEC: 'C. LECLERC', SAI: 'C. SAINZ', RUS: 'G. RUSSELL', PER: 'S. PEREZ',
  ALO: 'F. ALONSO', STR: 'L. STROLL', GAS: 'P. GASLY', OCO: 'E. OCON',
  ALB: 'A. ALBON', HUL: 'N. HULKENBERG', MAG: 'K. MAGNUSSEN', TSU: 'Y. TSUNODA',
  RIC: 'D. RICCIARDO', BOT: 'V. BOTTAS', ZHO: 'ZHOU GUANYU', SAR: 'L. SARGEANT',
};

export function formatDriverName(code: string): string {
  return DRIVER_DISPLAY_NAMES[code] ?? code;
}
