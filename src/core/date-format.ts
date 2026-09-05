/**
 * Serialising dates the way Directus stores them.
 *
 * Directus has two kinds of temporal column, and they need opposite treatment:
 *
 * - `date`, `time` and `dateTime` are **timezone-naive**. The value is wall
 *   clock: what you write is what the app shows, with no conversion.
 * - `timestamp` is **timezone-aware** and belongs in UTC with a `Z`.
 *
 * Formatting a naive column through `toISOString()` converts to UTC first, so
 * on any server that is not itself UTC the wall clock moves. Stripping the `Z`
 * afterwards hides the marker without undoing the shift. It is also asymmetric:
 * JavaScript parses a naive string (`new Date('2024-01-01T10:00:00')`) as
 * *local*, so parse-then-format shifted a value by the server's offset on every
 * pass — invisible in UTC, and a silent hour-shift everywhere else.
 *
 * Naive types are therefore built from local components, which round-trips
 * exactly against that parsing.
 */

const pad = (value: number): string => String(value).padStart(2, '0');

/** `YYYY-MM-DD` in local time. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:MM:SS` in local time. */
export function localTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** `YYYY-MM-DDTHH:MM:SS` in local time, with no zone marker. */
export function localDateTime(date: Date): string {
  return `${localDate(date)}T${localTime(date)}`;
}

/**
 * Serialise `date` for a Directus field of `type` (optionally narrowed by the
 * field's interface, which is what distinguishes a date-only picker on a
 * timestamp column).
 */
export function formatForColumnType(
  date: Date,
  type: string | null | undefined,
  iface?: string | null
): string {
  if (type === 'date' || iface === 'date') return localDate(date);
  if (type === 'time' || iface === 'time') return localTime(date);
  if (type === 'dateTime') return localDateTime(date);
  // `timestamp` and anything unrecognised: UTC with the marker intact.
  return date.toISOString();
}
