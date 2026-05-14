import { faker } from '@faker-js/faker';
import type { FieldDescriptor, GenerationStrategy, StrategyMap } from '../types.js';
import { FAKER_METHOD_PATHS } from './faker-methods.js';
import { formatSequence, postProcessValue } from './validation.js';

export class StrategyExecutor {
  private m2oCache: Map<string, unknown[]> = new Map();
  private fileCache: Map<string, string[]> = new Map();
  private userCollectionsCache: string[] | null = null;
  private collectionItemsCache: Map<string, unknown[]> = new Map();

  constructor(
    private services: any,
    private schema: any,
    private accountability: any
  ) {}

  async prepare(strategies: StrategyMap): Promise<void> {
    const { ItemsService } = this.services;

    for (const strategy of Object.values(strategies)) {
      if (strategy.kind === 'm2o_random') {
        if (this.m2oCache.has(strategy.relatedCollection)) continue;
        const related = this.schema.collections?.[strategy.relatedCollection];
        if (!related) {
          this.m2oCache.set(strategy.relatedCollection, []);
          continue;
        }
        const pk = related.primary ?? 'id';
        try {
          const svc = new ItemsService(strategy.relatedCollection, {
            schema: this.schema,
            accountability: this.accountability,
          });
          const rows = await svc.readByQuery({ fields: [pk], limit: 10000 });
          const ids = (rows as any[]).map((r) => r[pk]).filter((v) => v !== undefined && v !== null);
          this.m2oCache.set(strategy.relatedCollection, ids);
        } catch {
          this.m2oCache.set(strategy.relatedCollection, []);
        }
      }

      if (strategy.kind === 'file_reuse') {
        const filter = strategy.mimeFilter ?? '';
        if (this.fileCache.has(filter)) continue;
        try {
          const svc = new ItemsService('directus_files', {
            schema: this.schema,
            accountability: this.accountability,
          });
          const query: any = { fields: ['id', 'type'], limit: 1000 };
          if (filter) {
            query.filter = { type: { _starts_with: filter } };
          }
          const rows = (await svc.readByQuery(query)) as any[];
          const ids = rows.map((r) => r.id).filter((v) => v);
          this.fileCache.set(filter, ids);
        } catch {
          this.fileCache.set(filter, []);
        }
      }

      if (strategy.kind === 'random_user_collection' || strategy.kind === 'random_item_of_field') {
        if (!this.userCollectionsCache) {
          this.userCollectionsCache = Object.keys(this.schema.collections ?? {}).filter(
            (name) => !name.startsWith('directus_') && !name.startsWith('seed_studio_')
          );
        }
        // Preload PK lists for every user collection so random_item_of_field is O(1) per row
        for (const cName of this.userCollectionsCache) {
          if (this.collectionItemsCache.has(cName)) continue;
          const cMeta = this.schema.collections?.[cName];
          const pk = cMeta?.primary ?? 'id';
          try {
            const svc = new ItemsService(cName, {
              schema: this.schema,
              accountability: this.accountability,
            });
            const rows = await svc.readByQuery({ fields: [pk], limit: 5000 });
            const ids = (rows as any[]).map((r) => r[pk]).filter((v) => v !== undefined && v !== null);
            this.collectionItemsCache.set(cName, ids);
          } catch {
            this.collectionItemsCache.set(cName, []);
          }
        }
      }
    }
  }

  async execute(
    strategy: GenerationStrategy,
    descriptor: FieldDescriptor,
    rowIndex: number,
    row: Record<string, unknown> = {}
  ): Promise<unknown> {
    try {
      const raw = await this.runStrategy(strategy, descriptor, rowIndex, row);
      if (strategy.kind === 'system' || strategy.kind === 'skip') return undefined;
      return postProcessValue(raw, descriptor, rowIndex);
    } catch {
      return descriptor.nullable ? null : '';
    }
  }

  private async runStrategy(
    strategy: GenerationStrategy,
    descriptor: FieldDescriptor,
    rowIndex: number,
    row: Record<string, unknown>
  ): Promise<unknown> {
    switch (strategy.kind) {
      case 'system':
      case 'skip':
        return undefined;

      case 'null':
        return null;

      case 'fixed':
        return strategy.value;

      case 'uuid':
        return crypto.randomUUID();

      case 'faker':
        return invokeFaker(strategy.method, strategy.args);

      case 'random_choice': {
        if (!strategy.choices.length) return null;
        const idx = Math.floor(Math.random() * strategy.choices.length);
        return strategy.choices[idx];
      }

      case 'random_int':
        return faker.number.int({ min: strategy.min, max: strategy.max });

      case 'random_float':
        return faker.number.float({
          min: strategy.min,
          max: strategy.max,
          fractionDigits: strategy.fractionDigits,
        });

      case 'random_date': {
        const days = strategy.daysBack + strategy.daysForward;
        const baseDays = strategy.daysBack > 0 ? strategy.daysBack : days || 365;
        const d = faker.date.recent({ days: baseDays });
        return formatDateForType(d, descriptor.type, descriptor.interface);
      }

      case 'random_boolean':
        return Math.random() < strategy.trueProbability;

      case 'sequence':
        return formatSequence(strategy.pattern, rowIndex, strategy.startFrom ?? 0);

      case 'lorem_paragraphs':
        return faker.lorem.paragraphs(strategy.count, '\n\n');

      case 'm2o_random': {
        const ids = this.m2oCache.get(strategy.relatedCollection) ?? [];
        if (!ids.length) return null;
        return ids[Math.floor(Math.random() * ids.length)];
      }

      case 'file_reuse': {
        const filter = strategy.mimeFilter ?? '';
        const ids = this.fileCache.get(filter) ?? this.fileCache.get('') ?? [];
        if (!ids.length) return null;
        return ids[Math.floor(Math.random() * ids.length)];
      }

      case 'random_user_collection': {
        const names = this.userCollectionsCache ?? [];
        if (!names.length) return null;
        return names[Math.floor(Math.random() * names.length)];
      }

      case 'random_item_of_field': {
        const cName = row[strategy.collectionField];
        if (typeof cName !== 'string' || !cName) return null;
        const ids = this.collectionItemsCache.get(cName) ?? [];
        if (!ids.length) return null;
        const pick = ids[Math.floor(Math.random() * ids.length)];
        return typeof pick === 'string' ? pick : String(pick);
      }
    }
  }
}

export function invokeFaker(methodPath: string, args?: unknown[]): unknown {
  if (!FAKER_METHOD_PATHS.has(methodPath)) {
    throw new Error(`Faker method not allowed: ${methodPath}`);
  }
  const parts = methodPath.split('.');
  let ctx: any = faker;
  for (let i = 0; i < parts.length - 1; i++) {
    ctx = ctx?.[parts[i]];
    if (!ctx) throw new Error(`Faker path invalid: ${methodPath}`);
  }
  const fn = ctx?.[parts[parts.length - 1]];
  if (typeof fn !== 'function') throw new Error(`Faker method not callable: ${methodPath}`);
  return fn.apply(ctx, args ?? []);
}

function formatDateForType(d: Date, type: string, interfaceName: string | null): string {
  if (type === 'date' || interfaceName === 'date') {
    return d.toISOString().split('T')[0];
  }
  if (type === 'time' || interfaceName === 'time') {
    return d.toISOString().split('T')[1].split('.')[0];
  }
  return d.toISOString();
}
