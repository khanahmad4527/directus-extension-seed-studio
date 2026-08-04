import type { CancellationToken } from '../../core/generator.js';
import type { AuditRunRow, PrimaryKey, ProgressEvent, RunOptions, StrategyMap } from '../../core/types.js';

/**
 * Run bookkeeping for the in-browser engine.
 *
 * With no API extension there is no `seed_studio_runs` collection to write to,
 * and creating one behind the user's back to store history would be worse than
 * not having it. Runs are kept in the tab (live progress) and in localStorage
 * (history + undo), clearly labelled as local in the UI.
 */

const STORAGE_KEY = 'seed-studio.localRuns';
const MAX_STORED_RUNS = 25;
/** localStorage is small; beyond this an undo is no longer offered. */
const MAX_STORED_IDS = 5000;

export interface LocalRunRecord extends AuditRunRow {
  id: string;
  local: true;
}

export interface LiveRun {
  runId: string;
  collection: string;
  events: ProgressEvent[];
  listeners: Set<(event: ProgressEvent) => void>;
  token: CancellationToken;
  cancel: () => void;
}

const liveRuns = new Map<string, LiveRun>();

export function startLiveRun(runId: string, collection: string): LiveRun {
  let aborted = false;
  const run: LiveRun = {
    runId,
    collection,
    events: [],
    listeners: new Set(),
    token: {
      get aborted() {
        return aborted;
      },
    },
    cancel: () => {
      aborted = true;
    },
  };
  liveRuns.set(runId, run);
  return run;
}

export function emitLocal(runId: string, event: ProgressEvent): void {
  const run = liveRuns.get(runId);
  if (!run) return;
  run.events.push(event);
  for (const listener of run.listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not stop the run.
    }
  }
}

export function subscribeLocal(runId: string, listener: (event: ProgressEvent) => void): () => void {
  const run = liveRuns.get(runId);
  if (!run) return () => undefined;
  // Replay what already happened so a late subscriber is not stuck at 0%.
  for (const event of [...run.events]) listener(event);
  run.listeners.add(listener);
  return () => run.listeners.delete(listener);
}

export function cancelLocal(runId: string): boolean {
  const run = liveRuns.get(runId);
  if (!run) return false;
  run.cancel();
  return true;
}

export function finishLiveRun(runId: string): void {
  const run = liveRuns.get(runId);
  if (!run) return;
  run.listeners.clear();
  // Keep the event list around briefly so a re-render can still replay it.
  setTimeout(() => liveRuns.delete(runId), 60_000);
}

export function readLocalRuns(): LocalRunRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalRuns(runs: LocalRunRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_STORED_RUNS)));
  } catch {
    // Private mode or quota — history is a convenience, not a requirement.
  }
}

export function recordLocalRunStart(input: {
  runId: string;
  collection: string;
  requested: number;
  strategies: StrategyMap;
  options: RunOptions;
  seed: number;
  wipeFirst: boolean;
}): void {
  const record: LocalRunRecord = {
    id: input.runId,
    local: true,
    collection: input.collection,
    row_count_requested: input.requested,
    row_count_written: 0,
    dry_run: false,
    wipe_first: input.wipeFirst,
    strategies: input.strategies,
    status: 'running',
    error_message: null,
    duration_ms: 0,
    started_at: new Date().toISOString(),
    completed_at: null,
    seed: input.seed,
    options: input.options,
    created_ids: [],
    undoable: false,
  };
  writeLocalRuns([record, ...readLocalRuns().filter((r) => r.id !== input.runId)]);
}

export function recordLocalRunEnd(
  runId: string,
  patch: Partial<AuditRunRow> & { created_ids?: PrimaryKey[] }
): void {
  const runs = readLocalRuns();
  const index = runs.findIndex((r) => r.id === runId);
  if (index === -1) return;

  const ids = patch.created_ids ?? runs[index]!.created_ids ?? [];
  const storedIds = Array.isArray(ids) ? ids.slice(0, MAX_STORED_IDS) : [];

  runs[index] = {
    ...runs[index]!,
    ...patch,
    created_ids: storedIds,
    undoable: Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_STORED_IDS,
    completed_at: patch.completed_at ?? new Date().toISOString(),
  };
  writeLocalRuns(runs);
}

export function readLocalRun(runId: string): LocalRunRecord | null {
  return readLocalRuns().find((r) => r.id === runId) ?? null;
}
