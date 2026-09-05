import { useApi } from '@directus/extensions-sdk';
import { runGeneration, runPreview, undoRun } from '../../core/generator.js';
import { profileCollection } from '../../core/inference.js';
import { collectionInsights, insightWarnings } from '../../core/insights.js';
import { planProject, runProject } from '../../core/project.js';
import { preflightDependencies, type PreflightResult } from '../../core/preflight.js';
import {
  classifySeedTarget,
  isSeedStudioCollection,
  isSystemCollection,
} from '../../core/seed-targets.js';
import { createRng, randomSeed } from '../../core/rng.js';
import { buildCollectionDescriptor, resolveDisplayName } from '../../core/schema-model.js';
import { FAKER_METHODS } from '../../core/faker-methods.js';
import type {
  CollectionDescriptor,
  CollectionInsights,
  GenerationRequest,
  PresetRow,
  PreviewRequest,
  PrimaryKey,
  ProgressEvent,
  RunOptions,
  StrategyMap,
} from '../../core/types.js';
import type { ProfileResult } from '../../core/inference.js';
import type { ProjectPlan } from '../../core/project.js';
import { HttpDataSource } from '../adapters/http-data-source.js';
import { APP_LOCALES, createAppFaker } from '../faker-host.js';
import type { CollectionSummary, EngineStatus, PreviewResponse } from '../types.js';
import {
  cancelLocal,
  emitLocal,
  finishLiveRun,
  readLocalRun,
  readLocalRuns,
  recordLocalRunEnd,
  recordLocalRunStart,
  startLiveRun,
  subscribeLocal,
} from './useLocalRuns.js';

const BASE = '/seed-studio';
const LOCAL_PRESETS_KEY = 'seed-studio.localPresets';

/**
 * One API surface, two engines.
 *
 * If the API extension answers, everything runs server-side: hooks can be
 * suppressed, batches are large, and a run keeps going after the tab closes.
 * If it does not — Directus Cloud, or an app-only install — the exact same
 * engine runs in the browser over the REST API, and the UI reports the reduced
 * capabilities instead of failing.
 */

let engineProbe: Promise<EngineStatus> | null = null;

export function useSeedApi() {
  const api = useApi();

  function localDataSource(): HttpDataSource {
    return new HttpDataSource(api);
  }

  function localEngine(options?: RunOptions | null) {
    const seed = typeof options?.seed === 'number' ? options.seed : randomSeed();
    return { ds: localDataSource(), rng: createRng(createAppFaker(), seed), seed };
  }

  /**
   * Probed once, then reused — but only a definitive answer is cached.
   *
   * A 404 means the API extension genuinely is not installed; a 502/503 means
   * the server was restarting. Caching the latter would strand the whole session
   * in the reduced in-browser engine until the page is reloaded, so transient
   * failures fall back for this call and re-probe on the next one.
   */
  async function status(): Promise<EngineStatus> {
    if (engineProbe) return engineProbe;

    const probe = (async (): Promise<{ status: EngineStatus; definitive: boolean }> => {
      try {
        const response = await api.get(`${BASE}/capabilities`);
        const data = response?.data ?? {};
        if (data?.capabilities) {
          return {
            definitive: true,
            status: {
              engine: 'api',
              capabilities: data.capabilities,
              locales: Array.isArray(data.locales) ? data.locales : APP_LOCALES,
              environment: data.environment,
            },
          };
        }
        throw new Error('Unexpected capabilities response');
      } catch (err: any) {
        const httpStatus = err?.response?.status;
        const ds = localDataSource();
        const environment = await ds.environment().catch(() => undefined);
        return {
          // 404/403 are answers. Anything else might just be a restart.
          definitive: httpStatus === 404 || httpStatus === 403,
          status: {
            engine: 'app',
            capabilities: ds.capabilities,
            locales: APP_LOCALES,
            fallbackReason:
              httpStatus === 404
                ? 'The Seed Studio API extension is not installed, so generation runs in this browser tab.'
                : `The Seed Studio API extension did not respond (${
                    httpStatus ?? err?.message ?? 'unknown error'
                  }), so generation runs in this browser tab.`,
            environment,
          },
        };
      }
    })();

    const result = await probe;
    if (result.definitive) {
      engineProbe = Promise.resolve(result.status);
    }
    return result.status;
  }

  async function isApi(): Promise<boolean> {
    return (await status()).engine === 'api';
  }

  return {
    status,

    async listCollections(showSystem = false): Promise<CollectionSummary[]> {
      if (await isApi()) {
        const res = await api.get(`${BASE}/collections`, { params: { showSystem } });
        return res.data?.collections ?? [];
      }

      const ds = localDataSource();
      const collections = await ds.listCollections();
      const visible = collections.filter((c) => {
        if (isSeedStudioCollection(c.collection)) return false;
        return isSystemCollection(c.collection) ? showSystem : true;
      });
      const summaries = await Promise.all(
        visible.map(async (collection) => {
          const name = collection.collection;
          const fields = await ds.getFields(name).catch(() => []);
          const verdict = classifySeedTarget(name);
          return {
            collection: name,
            displayName: resolveDisplayName(name, collection),
            fieldCount: fields.length,
            rowCount: verdict.seedable ? await ds.count(name) : 0,
            isSystem: isSystemCollection(name),
            singleton: Boolean(collection.singleton),
            seedable: verdict.seedable,
            blockedReason: verdict.reason ?? null,
            blockedCategory: verdict.category ?? null,
            warning: verdict.warning ?? null,
          };
        })
      );
      return summaries.sort((a, b) => {
        if (a.seedable !== b.seedable) return a.seedable ? -1 : 1;
        return a.collection.localeCompare(b.collection);
      });
    },

    /**
     * Which parents are missing before `collection` can be generated. Runs on
     * whichever engine is active, so the browser fallback gives the same answer.
     */
     async preflight(collection: string, count: number): Promise<PreflightResult> {
      if (await isApi()) {
        const res = await api.get(`${BASE}/preflight/${encodeURIComponent(collection)}`, {
          params: { count },
        });
        return res.data;
      }
      return preflightDependencies(localDataSource(), collection, count);
    },

    async getSchema(
      collection: string,
      opts: { coherent?: boolean; nulls?: boolean } = {}
    ): Promise<CollectionDescriptor> {
      if (await isApi()) {
        const res = await api.get(`${BASE}/schema/${encodeURIComponent(collection)}`, {
          params: {
            coherent: opts.coherent === false ? 'false' : 'true',
            nulls: opts.nulls ? 'true' : 'false',
          },
        });
        return res.data;
      }
      return buildCollectionDescriptor(localDataSource(), collection, {
        detect: { coherentRows: opts.coherent !== false, realisticNulls: Boolean(opts.nulls) },
      });
    },

    async preview(body: PreviewRequest): Promise<PreviewResponse> {
      if (await isApi()) {
        const res = await api.post(`${BASE}/preview`, body);
        return res.data;
      }
      const engine = localEngine(body.options);
      const result = await runPreview(body, { ds: engine.ds, rng: engine.rng });
      return {
        rows: result.rows,
        issues: result.issues,
        changes: result.changes,
        seed: result.seed,
      };
    },

    async generate(body: GenerationRequest): Promise<{ runId: string; seed: number }> {
      if (await isApi()) {
        const res = await api.post(`${BASE}/generate`, body);
        return { runId: res.data?.runId, seed: res.data?.seed };
      }

      // In-browser run: same engine, progress delivered through the local bus.
      const engine = localEngine(body.options);
      const runId = globalThis.crypto.randomUUID();
      const live = startLiveRun(runId, body.collection);
      recordLocalRunStart({
        runId,
        collection: body.collection,
        requested: body.count,
        strategies: body.strategies,
        options: body.options ?? {},
        seed: engine.seed,
        wipeFirst: Boolean(body.wipeFirst),
      });

      void runGeneration(body, {
        ds: engine.ds,
        rng: engine.rng,
        token: live.token,
        onProgress: (event) => emitLocal(runId, { ...event, runId } as ProgressEvent),
      })
        .then((result) => {
          recordLocalRunEnd(runId, {
            row_count_written: result.rowsWritten,
            status: result.cancelled ? 'cancelled' : 'success',
            duration_ms: result.durationMs,
            seed: result.seed,
            created_ids: result.createdIds,
            error_message: result.warnings.length > 0 ? result.warnings.join('\n') : null,
          });
        })
        .catch((err: any) => {
          const message = err?.response?.data?.errors?.[0]?.message ?? err?.message ?? String(err);
          emitLocal(runId, { runId, type: 'error', message });
          recordLocalRunEnd(runId, { status: 'failed', error_message: message });
        })
        .finally(() => finishLiveRun(runId));

      return { runId, seed: engine.seed };
    },

    /** Subscribe to a run's progress. Resolves to an unsubscribe function. */
    async progress(runId: string, onEvent: (event: ProgressEvent) => void): Promise<() => void> {
      if (!(await isApi())) {
        return subscribeLocal(runId, onEvent);
      }
      return streamServerProgress(api, runId, onEvent);
    },

    async cancel(runId: string): Promise<boolean> {
      if (await isApi()) {
        try {
          await api.post(`${BASE}/generate/${encodeURIComponent(runId)}/cancel`);
          return true;
        } catch {
          return false;
        }
      }
      return cancelLocal(runId);
    },

    async insights(collection: string, count = 0): Promise<CollectionInsights & { warnings: string[] }> {
      if (await isApi()) {
        const res = await api.get(`${BASE}/insights/${encodeURIComponent(collection)}`, {
          params: { count },
        });
        return res.data;
      }
      const insights = await collectionInsights(localDataSource(), collection);
      return { ...insights, warnings: insightWarnings(insights, count) };
    },

    async profile(collection: string, sample = 300): Promise<ProfileResult> {
      if (await isApi()) {
        const res = await api.get(`${BASE}/profile/${encodeURIComponent(collection)}`, {
          params: { sample },
        });
        return res.data;
      }
      const ds = localDataSource();
      const descriptor = await buildCollectionDescriptor(ds, collection, {
        detect: { coherentRows: true },
      });
      return profileCollection(ds, descriptor, sample);
    },

    async planProject(
      collections: string[],
      counts?: Record<string, number>,
      baseCount?: number
    ): Promise<ProjectPlan> {
      if (await isApi()) {
        const res = await api.post(`${BASE}/project/plan`, { collections, counts, baseCount });
        return res.data;
      }
      return planProject(localDataSource(), { collections, counts, baseCount });
    },

    async runProject(input: {
      collections: string[];
      counts?: Record<string, number>;
      baseCount?: number;
      options?: RunOptions;
      strategies?: Record<string, StrategyMap>;
    }): Promise<{ runId: string; plan: ProjectPlan }> {
      if (await isApi()) {
        const res = await api.post(`${BASE}/project/run`, input);
        return { runId: res.data?.runId, plan: res.data?.plan };
      }

      const engine = localEngine(input.options);
      const plan = await planProject(engine.ds, {
        collections: input.collections,
        counts: input.counts,
        baseCount: input.baseCount,
      });
      const runId = globalThis.crypto.randomUUID();
      const live = startLiveRun(runId, `${plan.order.length} collections`);
      const totalRows = Object.values(plan.counts).reduce((sum, n) => sum + n, 0);

      void runProject(
        { plan, options: input.options, strategies: input.strategies },
        {
          ds: engine.ds,
          rng: engine.rng,
          token: live.token,
          onProgress: (event) => emitLocal(runId, { ...event, runId } as ProgressEvent),
        }
      )
        .then((result) => {
          emitLocal(runId, {
            runId,
            type: result.cancelled ? 'cancelled' : 'complete',
            rowsWritten: result.totalRows,
            totalRows,
            elapsedMs: result.durationMs,
            message: result.results
              .map((r) => (r.error ? `${r.collection}: ${r.error}` : `${r.collection}: ${r.rowsWritten} rows`))
              .join(' · '),
          });
        })
        .catch((err: any) => {
          emitLocal(runId, { runId, type: 'error', message: err?.message ?? String(err) });
        })
        .finally(() => finishLiveRun(runId));

      return { runId, plan };
    },

    async listPresets(collection: string): Promise<PresetRow[]> {
      if (await isApi()) {
        const res = await api.get(`${BASE}/presets/${encodeURIComponent(collection)}`);
        return res.data?.presets ?? [];
      }
      return readLocalPresets().filter((preset) => preset.collection === collection);
    },

    async savePreset(body: PresetRow): Promise<{ id: string }> {
      if (await isApi()) {
        const res = await api.post(`${BASE}/presets`, body);
        return res.data;
      }
      const id = globalThis.crypto.randomUUID();
      writeLocalPresets([{ ...body, id }, ...readLocalPresets()]);
      return { id };
    },

    async deletePreset(id: string): Promise<void> {
      if (await isApi()) {
        await api.delete(`${BASE}/presets/${encodeURIComponent(id)}`);
        return;
      }
      writeLocalPresets(readLocalPresets().filter((preset) => preset.id !== id));
    },

    async listRuns(limit = 25, offset = 0): Promise<unknown[]> {
      if (await isApi()) {
        const res = await api.get(`${BASE}/runs`, { params: { limit, offset } });
        return res.data?.runs ?? [];
      }
      return readLocalRuns().slice(offset, offset + limit);
    },

    /** Delete exactly the rows a run created. */
    async undo(runId: string): Promise<{ deleted: number; collection: string }> {
      if (await isApi()) {
        const res = await api.post(`${BASE}/runs/${encodeURIComponent(runId)}/undo`);
        return { deleted: res.data?.deleted ?? 0, collection: res.data?.collection ?? '' };
      }

      const run = readLocalRun(runId);
      if (!run) throw new Error('Run not found in this browser.');
      const ids = (run.created_ids ?? []) as PrimaryKey[];
      if (ids.length === 0) throw new Error('This run has no recorded row ids, so it cannot be undone.');

      const deleted = await undoRun(localDataSource(), run.collection, ids);
      recordLocalRunEnd(runId, { status: 'undone', undoable: false });
      return { deleted, collection: run.collection };
    },

    async fakerMethods() {
      if (await isApi()) {
        const res = await api.get(`${BASE}/faker-methods`);
        return res.data?.methods ?? FAKER_METHODS;
      }
      return FAKER_METHODS;
    },
  };
}

/**
 * Read the SSE stream with `fetch` rather than `EventSource`.
 *
 * `EventSource` cannot set headers, which is why the previous implementation put
 * the access token in the query string — where it ends up in proxy and access
 * logs. `fetch` carries the same Authorization header the rest of the app uses.
 */
async function streamServerProgress(
  api: any,
  runId: string,
  onEvent: (event: ProgressEvent) => void
): Promise<() => void> {
  const baseUrl = String(api?.defaults?.baseURL ?? '').replace(/\/$/, '');
  const url = `${baseUrl}${BASE}/generate/${encodeURIComponent(runId)}/progress`;
  const controller = new AbortController();

  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  const defaults: any = api?.defaults?.headers ?? {};
  const authorization =
    defaults.common?.Authorization ??
    defaults.Authorization ??
    defaults.common?.authorization ??
    defaults.authorization;
  if (authorization) headers.Authorization = String(authorization);

  void (async () => {
    try {
      const response = await fetch(url, {
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        onEvent({ runId, type: 'error', message: `Progress stream failed (${response.status})` });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');

          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) continue;
            try {
              onEvent(JSON.parse(line.slice(5).trim()) as ProgressEvent);
            } catch {
              // Malformed frame or keepalive comment — nothing to report.
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      onEvent({ runId, type: 'error', message: 'Lost connection to the progress stream' });
    }
  })();

  return () => controller.abort();
}

function readLocalPresets(): PresetRow[] {
  try {
    const raw = localStorage.getItem(LOCAL_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalPresets(presets: PresetRow[]): void {
  try {
    localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(presets.slice(0, 50)));
  } catch {
    // ignore quota / private mode
  }
}

export type SeedApi = ReturnType<typeof useSeedApi>;
export type { StrategyMap };
