import type { CancellationToken } from '../core/generator.js';

/**
 * In-flight runs.
 *
 * A generation request returns as soon as the run starts, so the run itself
 * outlives the HTTP request — that is the point of the API engine. This registry
 * is what lets a later request cancel one, and what makes "is anything running?"
 * answerable.
 */

export interface ActiveRun {
  runId: string;
  collection: string;
  auditId: string;
  startedAt: number;
  requested: number;
  token: CancellationToken;
  cancel: () => void;
}

class RunRegistry {
  private runs = new Map<string, ActiveRun>();

  start(input: { runId: string; collection: string; auditId: string; requested: number }): ActiveRun {
    let aborted = false;
    const run: ActiveRun = {
      ...input,
      startedAt: Date.now(),
      token: {
        get aborted() {
          return aborted;
        },
      },
      cancel: () => {
        aborted = true;
      },
    };
    this.runs.set(input.runId, run);
    return run;
  }

  get(runId: string): ActiveRun | undefined {
    return this.runs.get(runId);
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    run.cancel();
    return true;
  }

  finish(runId: string): void {
    this.runs.delete(runId);
  }

  list(): ActiveRun[] {
    return [...this.runs.values()];
  }
}

export const runRegistry = new RunRegistry();
