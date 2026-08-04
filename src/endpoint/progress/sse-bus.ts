import type { ProgressEvent } from '../../core/types.js';

type Listener = (event: ProgressEvent) => void;

export class SseBus {
  private subscribers: Map<string, Set<Listener>> = new Map();
  private history: Map<string, ProgressEvent[]> = new Map();
  private readonly historyLimit = 50;

  emit(runId: string, event: ProgressEvent): void {
    const list = this.history.get(runId) ?? [];
    list.push(event);
    if (list.length > this.historyLimit) list.shift();
    this.history.set(runId, list);

    const subs = this.subscribers.get(runId);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(event);
        } catch {
          // ignore listener errors
        }
      }
    }

    if (event.type === 'complete' || event.type === 'error') {
      setTimeout(() => {
        this.history.delete(runId);
        this.subscribers.delete(runId);
      }, 60_000);
    }
  }

  subscribe(runId: string, callback: Listener): () => void {
    let subs = this.subscribers.get(runId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(runId, subs);
    }
    subs.add(callback);

    const past = this.history.get(runId);
    if (past && past.length > 0) {
      const snapshot = past.slice();
      queueMicrotask(() => {
        const stillSubscribed = this.subscribers.get(runId)?.has(callback);
        if (!stillSubscribed) return;
        for (const evt of snapshot) {
          try {
            callback(evt);
          } catch {
            // ignore listener errors
          }
        }
      });
    }

    return () => {
      const set = this.subscribers.get(runId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.subscribers.delete(runId);
      }
    };
  }
}

export const sseBus = new SseBus();
