import type { SeedDataSource } from './data-source.js';
import { formatForColumnType } from './date-format.js';
import { createRowEntity, readTrait, skewedPastDate, type RowEntity } from './entity.js';
import { invokeFaker } from './faker-methods.js';
import type { Rng } from './rng.js';
import { renderTemplate } from './template.js';
import type {
  Bbox,
  CollectionDescriptor,
  FieldDescriptor,
  GenerationStrategy,
  PrimaryKey,
  StrategyMap,
} from './types.js';
import { formatSequence, postProcessValue, UniqueRegistry } from './validation.js';

const FK_POOL_LIMIT = 10_000;
const FILE_POOL_LIMIT = 2_000;
const UNIQUE_PRELOAD_LIMIT = 50_000;

export interface ExecutorOptions {
  /** Pre-load existing values of unique fields so we never collide with them. */
  preloadUnique?: boolean;
  /**
   * Epoch milliseconds this run treats as "now". Fixed for the whole run so
   * relative dates are reproducible; defaults to the moment the executor is built.
   */
  now?: number;
}

export interface RowContext {
  rowIndex: number;
  row: Record<string, unknown>;
  entity: RowEntity;
}

export class StrategyExecutor {
  readonly registry = new UniqueRegistry();
  /**
   * A field that throws every row would otherwise be invisible: the executor
   * swallows the error so one bad strategy cannot abort a 100k-row run. Counting
   * the swallowed failures lets the run report them instead of silently writing
   * empty values.
   */
  private failures = 0;

  private fkPools = new Map<string, unknown[]>();
  private filePools = new Map<string, unknown[]>();
  private userCollections: string[] | null = null;
  private itemPools = new Map<string, unknown[]>();
  private pendingItemPools = new Map<string, Promise<unknown[]>>();

  private readonly now: number;

  constructor(
    private ds: SeedDataSource,
    private rng: Rng,
    private options: ExecutorOptions = {}
  ) {
    this.now = options.now ?? Date.now();
  }

  /**
   * Load the reference data a run needs — and nothing else.
   *
   * Only pools that some strategy actually asks for are fetched. Pools for
   * `random_item_of_field` are loaded on first use per collection instead of
   * eagerly for every collection in the project.
   */
  async prepare(strategies: StrategyMap, descriptor?: CollectionDescriptor): Promise<void> {
    const wanted = Object.values(strategies);

    const fkCollections = new Set<string>();
    const fileFilters = new Set<string>();
    let needsUserCollections = false;

    for (const strategy of wanted) {
      if (strategy.kind === 'm2o_random' && strategy.relatedCollection) {
        fkCollections.add(strategy.relatedCollection);
      }
      if (strategy.kind === 'file_reuse') fileFilters.add(strategy.mimeFilter ?? '');
      if (strategy.kind === 'random_user_collection') needsUserCollections = true;
    }

    await Promise.all([
      ...[...fkCollections].map((collection) => this.loadFkPool(collection)),
      ...[...fileFilters].map((filter) => this.loadFilePool(filter)),
      needsUserCollections ? this.loadUserCollections() : Promise.resolve(),
    ]);

    if (this.options.preloadUnique && descriptor) {
      const uniqueFields = descriptor.fields.filter(
        (f) => f.isUnique && !f.isAlias && !f.isSystemField && descriptor.rowCount > 0
      );
      await Promise.all(
        uniqueFields.map(async (field) => {
          try {
            const values = await this.ds.readColumn(descriptor.collection, field.field, UNIQUE_PRELOAD_LIMIT);
            this.registry.preload(field.field, values);
          } catch {
            // A field we cannot read is not worth failing the run over.
          }
        })
      );
    }
  }

  /** Related-collection primary keys available for m2o/m2m linking. */
  fkPool(collection: string): unknown[] {
    return this.fkPools.get(collection) ?? [];
  }

  async ensureFkPool(collection: string): Promise<unknown[]> {
    if (!this.fkPools.has(collection)) await this.loadFkPool(collection);
    return this.fkPool(collection);
  }

  filePool(filter = ''): unknown[] {
    return this.filePools.get(filter) ?? this.filePools.get('') ?? [];
  }

  newEntity(rowIndex: number, collectionName?: string): RowEntity {
    return createRowEntity(this.rng, { rowIndex, collectionName, now: new Date(this.now) });
  }

  /** How many field values fell back to empty because their strategy threw. */
  get failureCount(): number {
    return this.failures;
  }

  /** Re-seed for a row so row N is reproducible independently of batching. */
  seedRow(rowIndex: number): void {
    this.rng.seedRow(rowIndex);
  }

  async execute(
    strategy: GenerationStrategy,
    descriptor: FieldDescriptor,
    ctx: RowContext
  ): Promise<unknown> {
    if (strategy.kind === 'system' || strategy.kind === 'skip' || strategy.kind === 'm2m_random') {
      return undefined;
    }

    if (
      typeof strategy.nullRate === 'number' &&
      strategy.nullRate > 0 &&
      !descriptor.required &&
      descriptor.nullable &&
      this.rng.chance(strategy.nullRate)
    ) {
      return null;
    }

    try {
      const raw = await this.runStrategy(strategy, descriptor, ctx);
      return postProcessValue(raw, descriptor, { rowIndex: ctx.rowIndex, registry: this.registry });
    } catch {
      // A single unlucky field must not abort a 100k-row run — but it is counted.
      this.failures += 1;
      return descriptor.nullable ? null : '';
    }
  }

  private async runStrategy(
    strategy: GenerationStrategy,
    descriptor: FieldDescriptor,
    ctx: RowContext
  ): Promise<unknown> {
    const rng = this.rng;

    switch (strategy.kind) {
      case 'system':
      case 'skip':
      case 'm2m_random':
        return undefined;

      case 'null':
        return null;

      case 'fixed':
        return strategy.value;

      case 'uuid':
        return rng.uuid();

      case 'faker':
        return invokeFaker(rng.faker, strategy.method, strategy.args);

      case 'coherent': {
        const value = readTrait(ctx.entity, strategy.trait);
        if (value instanceof Date) return formatDateForType(value, descriptor);
        if (Array.isArray(value)) return formatListForField(value, descriptor);
        return value;
      }

      case 'template':
        return renderTemplate(strategy.template, {
          rng,
          entity: ctx.entity,
          row: ctx.row,
          rowIndex: ctx.rowIndex,
        });

      case 'regex':
        return rng.fromRegExp(strategy.pattern);

      case 'random_choice': {
        if (!strategy.choices.length) return null;
        return rng.pick(strategy.choices);
      }

      case 'weighted_choice': {
        if (!strategy.choices.length) return null;
        return rng.weighted(strategy.choices);
      }

      case 'random_int':
        return rng.int(strategy.min, strategy.max);

      case 'random_float':
        return rng.float(strategy.min, strategy.max, strategy.fractionDigits);

      case 'random_date': {
        const date = this.buildDate(strategy.daysBack, strategy.daysForward, strategy.skew);
        return formatDateForType(date, descriptor);
      }

      case 'random_boolean':
        return rng.bool(strategy.trueProbability);

      case 'sequence':
        return formatSequence(strategy.pattern, ctx.rowIndex, strategy.startFrom ?? 0);

      case 'lorem_paragraphs':
        return rng.faker.lorem.paragraphs(strategy.count, '\n\n');

      case 'markdown':
        return this.buildMarkdown(strategy.paragraphs ?? 3, ctx);

      case 'html':
        return this.buildHtml(strategy.paragraphs ?? 3, ctx);

      case 'geometry':
        return this.buildGeometry(strategy.geometryType ?? 'Point', strategy.bbox);

      case 'm2o_random': {
        const ids = await this.ensureFkPool(strategy.relatedCollection);
        if (!ids.length) return null;
        return rng.pick(ids);
      }

      case 'file_reuse': {
        const ids = this.filePool(strategy.mimeFilter ?? '');
        if (!ids.length) return null;
        return rng.pick(ids);
      }

      case 'random_user_collection': {
        const names = await this.loadUserCollections();
        if (!names.length) return null;
        return rng.pick(names);
      }

      case 'random_item_of_field': {
        const collection = ctx.row[strategy.collectionField];
        if (typeof collection !== 'string' || !collection) return null;
        const ids = await this.loadItemPool(collection);
        if (!ids.length) return null;
        const pick = rng.pick(ids);
        return typeof pick === 'string' ? pick : String(pick);
      }
    }
  }

  private buildDate(daysBack: number, daysForward: number, skew?: 'recent' | 'uniform'): Date {
    const now = new Date(this.now);
    const back = Math.max(0, daysBack ?? 0);
    const forward = Math.max(0, daysForward ?? 0);

    if (forward > 0) {
      const from = now.getTime() - back * 86_400_000;
      const to = now.getTime() + forward * 86_400_000;
      return new Date(from + (to - from) * this.rng.float(0, 1, 6));
    }
    if (back === 0) return now;
    if (skew === 'uniform') {
      return new Date(now.getTime() - back * 86_400_000 * this.rng.float(0, 1, 6));
    }
    return skewedPastDate(this.rng, now, back);
  }

  private buildMarkdown(paragraphs: number, ctx: RowContext): string {
    const f = this.rng.faker;
    const parts: string[] = [`## ${ctx.entity.content.title}`, ''];
    for (let i = 0; i < paragraphs; i++) {
      parts.push(String(f.lorem.paragraph({ min: 3, max: 6 })), '');
      if (i === 0) {
        parts.push(`### ${titleish(String(f.lorem.words({ min: 2, max: 4 })))}`, '');
        parts.push(
          ...[1, 2, 3].map((n) => `- ${f.lorem.sentence({ min: 4, max: 9 })}`.replace(/\.$/, '')),
          ''
        );
      }
      if (i === 1) {
        parts.push(`> ${f.lorem.sentence()}`, '');
      }
    }
    return parts.join('\n').trim();
  }

  private buildHtml(paragraphs: number, ctx: RowContext): string {
    const f = this.rng.faker;
    const parts: string[] = [`<h2>${escapeHtml(ctx.entity.content.title)}</h2>`];
    for (let i = 0; i < paragraphs; i++) {
      parts.push(`<p>${escapeHtml(String(f.lorem.paragraph({ min: 3, max: 6 })))}</p>`);
      if (i === 0) {
        parts.push(
          `<ul>${[1, 2, 3]
            .map(() => `<li>${escapeHtml(String(f.lorem.sentence({ min: 4, max: 9 })))}</li>`)
            .join('')}</ul>`
        );
      }
    }
    return parts.join('\n');
  }

  /**
   * GeoJSON matching the field's configured geometry type — a `Polygon` column
   * rejects a `Point`, and every row sharing `[0, 0]` is useless on a map.
   */
  private buildGeometry(geometryType: string, bbox?: Bbox): unknown {
    const [minLng, minLat, maxLng, maxLat] = clampBbox(bbox ?? ([-122.6, 37.5, -122.2, 37.9] as Bbox));
    const lng = () => this.rng.float(minLng, maxLng, 6);
    const lat = () => this.rng.float(minLat, maxLat, 6);
    const point = (): [number, number] => [lng(), lat()];

    const type = normaliseGeometryType(geometryType);

    switch (type) {
      case 'MultiPoint':
        return { type, coordinates: Array.from({ length: this.rng.int(2, 5) }, point) };
      case 'LineString':
        return { type, coordinates: Array.from({ length: this.rng.int(2, 6) }, point) };
      case 'MultiLineString':
        return {
          type,
          coordinates: Array.from({ length: this.rng.int(2, 3) }, () =>
            Array.from({ length: this.rng.int(2, 5) }, point)
          ),
        };
      case 'Polygon':
        return { type, coordinates: [ring(point, this.rng.int(3, 5))] };
      case 'MultiPolygon':
        return {
          type,
          coordinates: Array.from({ length: this.rng.int(1, 2) }, () => [ring(point, this.rng.int(3, 5))]),
        };
      case 'Point':
      default:
        return { type: 'Point', coordinates: point() };
    }
  }

  private async loadFkPool(collection: string): Promise<unknown[]> {
    if (this.fkPools.has(collection)) return this.fkPools.get(collection)!;
    let ids: unknown[] = [];
    try {
      const meta = await this.ds.getCollection(collection);
      const pk = meta?.primary ?? 'id';
      ids = await this.ds.readColumn(collection, pk, FK_POOL_LIMIT);
    } catch {
      ids = [];
    }
    this.fkPools.set(collection, ids);
    return ids;
  }

  private async loadFilePool(filter: string): Promise<unknown[]> {
    if (this.filePools.has(filter)) return this.filePools.get(filter)!;
    let ids: unknown[] = [];
    try {
      const rows = await this.ds.sample('directus_files', ['id', 'type'], FILE_POOL_LIMIT);
      ids = rows
        .filter((row) => (filter ? String(row.type ?? '').startsWith(filter) : true))
        .map((row) => row.id)
        .filter((id) => id !== null && id !== undefined);
    } catch {
      ids = [];
    }
    this.filePools.set(filter, ids);
    return ids;
  }

  private async loadUserCollections(): Promise<string[]> {
    if (this.userCollections) return this.userCollections;
    try {
      const collections = await this.ds.listCollections();
      this.userCollections = collections
        .map((c) => c.collection)
        .filter((name) => !name.startsWith('directus_') && !name.startsWith('seed_studio_'));
    } catch {
      this.userCollections = [];
    }
    return this.userCollections;
  }

  /** Lazy per-collection primary-key pool, fetched at most once per run. */
  private async loadItemPool(collection: string): Promise<unknown[]> {
    const cached = this.itemPools.get(collection);
    if (cached) return cached;

    const pending = this.pendingItemPools.get(collection);
    if (pending) return pending;

    const promise = (async () => {
      let ids: unknown[] = [];
      try {
        const known = await this.loadUserCollections();
        if (!known.includes(collection)) return [];
        const meta = await this.ds.getCollection(collection);
        ids = await this.ds.readColumn(collection, meta?.primary ?? 'id', FK_POOL_LIMIT);
      } catch {
        ids = [];
      }
      this.itemPools.set(collection, ids);
      this.pendingItemPools.delete(collection);
      return ids;
    })();

    this.pendingItemPools.set(collection, promise);
    return promise;
  }
}

/** Keep generated coordinates inside real longitude/latitude ranges. */
function clampBbox(bbox: Bbox): Bbox {
  const lng = (value: number) => Math.min(180, Math.max(-180, Number.isFinite(value) ? value : 0));
  const lat = (value: number) => Math.min(90, Math.max(-90, Number.isFinite(value) ? value : 0));
  const minLng = lng(bbox[0]);
  const minLat = lat(bbox[1]);
  const maxLng = lng(bbox[2]);
  const maxLat = lat(bbox[3]);
  return [Math.min(minLng, maxLng), Math.min(minLat, maxLat), Math.max(minLng, maxLng), Math.max(minLat, maxLat)];
}

function ring(point: () => [number, number], vertices: number): Array<[number, number]> {
  const points = Array.from({ length: Math.max(3, vertices) }, point);
  return [...points, points[0]!];
}

function normaliseGeometryType(input: string): string {
  const cleaned = String(input ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  const map: Record<string, string> = {
    point: 'Point',
    multipoint: 'MultiPoint',
    linestring: 'LineString',
    multilinestring: 'MultiLineString',
    polygon: 'Polygon',
    multipolygon: 'MultiPolygon',
  };
  return map[cleaned] ?? 'Point';
}

export function formatDateForType(date: Date, descriptor: FieldDescriptor): string {
  return formatForColumnType(date, descriptor.type, descriptor.interface);
}

/** Tags/CSV columns take a comma string; JSON columns take an array. */
function formatListForField(values: unknown[], descriptor: FieldDescriptor): unknown {
  if (descriptor.type === 'csv' || descriptor.special?.includes('cast-csv')) return values.join(',');
  return values;
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function titleish(input: string): string {
  return input.replace(/\b\w/g, (c) => c.toUpperCase());
}
