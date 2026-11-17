/** Errors that are safe to show to the user (business-rule violations). */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export const toNum = (v: string | number | null | undefined): number =>
  v === null || v === undefined || v === "" ? 0 : Number(v);

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Money string for numeric columns. */
export const m = (n: number): string => round2(n).toFixed(2);
/** Rate string for numeric(14,4) columns. */
export const r = (n: number): string => round4(n).toFixed(4);

/** YYYY-MM-DD in local server time. */
export function today(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new DomainError(message);
}
