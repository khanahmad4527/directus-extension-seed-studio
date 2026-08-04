import { createRng, randomSeed, type Rng } from '../core/rng.js';
import type { RunOptions } from '../core/types.js';
import { ItemsServiceDataSource } from './adapters/items-service-data-source.js';
import { createFakerInstance } from './faker-host.js';

export interface RouteDeps {
  services: any;
  getSchema: () => Promise<any>;
  logger?: any;
  env?: Record<string, any>;
}

export interface Engine {
  ds: ItemsServiceDataSource;
  rng: Rng;
  schema: any;
  seed: number;
}

/**
 * One engine per request.
 *
 * The data source caches schema reads for its lifetime, and the faker instance
 * is private to the run — two concurrent runs must not disturb each other's
 * seeded sequence.
 */
export async function buildEngine(
  req: any,
  deps: RouteDeps,
  options?: RunOptions | null
): Promise<Engine> {
  const schema = await deps.getSchema();
  const ds = new ItemsServiceDataSource(deps.services, schema, req.accountability, deps.env);
  const seed = normaliseSeed(options?.seed);
  const faker = createFakerInstance(options?.locale ?? null);
  return { ds, rng: createRng(faker, seed), schema, seed };
}

export function normaliseSeed(seed: unknown): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.abs(Math.trunc(seed));
  if (typeof seed === 'string' && seed.trim() !== '' && Number.isFinite(Number(seed))) {
    return Math.abs(Math.trunc(Number(seed)));
  }
  return randomSeed();
}

/** Reject unknown option keys early so a typo does not silently do nothing. */
export function sanitiseOptions(input: any): RunOptions {
  const options: RunOptions = {};
  if (!input || typeof input !== 'object') return options;

  if (input.seed !== undefined && input.seed !== null) options.seed = normaliseSeed(input.seed);
  if (typeof input.locale === 'string' && input.locale.trim() !== '') options.locale = input.locale.trim();
  if (typeof input.coherentRows === 'boolean') options.coherentRows = input.coherentRows;
  if (typeof input.invariants === 'boolean') options.invariants = input.invariants;
  if (typeof input.respectConditions === 'boolean') options.respectConditions = input.respectConditions;
  if (typeof input.realisticNulls === 'boolean') options.realisticNulls = input.realisticNulls;
  if (input.writeMode === 'fast' || input.writeMode === 'safe') options.writeMode = input.writeMode;

  return options;
}
