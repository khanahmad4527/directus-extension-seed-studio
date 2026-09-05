import { useStores } from '@directus/extensions-sdk';
import { resolveDisplayName } from '../../core/schema-model.js';

/**
 * Human-readable collection names, as Directus itself renders them.
 *
 * The app's collections store already resolves a display name for every
 * collection: it merges `meta.translations` into i18n per locale, prefers a
 * `collection_names.<key>` translation when one exists, and falls back to
 * `formatTitle` on the key. Reading that is better than title-casing the key
 * ourselves — it honours renames and the viewer's locale — and it also carries
 * the real per-collection icon, which we have no way to derive.
 *
 * `resolveDisplayName` stays as the fallback, because the endpoint computes
 * names server-side where no store exists, and because a collection the store
 * has not hydrated yet should still render as something readable.
 */
function trimSystemPrefix(key: string, name: string): string {
  if (!key.startsWith('directus_')) return name;
  const withoutPrefix = name.replace(/^Directus\s+/, '');
  return withoutPrefix || name;
}

export function useCollectionName() {
  let store: any = null;
  try {
    store = useStores().useCollectionsStore();
  } catch {
    // Outside an app context (tests, the API engine) there is no store.
    store = null;
  }

  const infoOf = (key: string): any => {
    if (!key || !store?.getCollection) return null;
    try {
      return store.getCollection(key) ?? null;
    } catch {
      return null;
    }
  };

  /**
   * The name Directus would show for this collection.
   *
   * For system tables the store has no `collection_names.*` override, so its
   * name is just `formatTitle('directus_files')` — "Directus Files". The
   * prefix is noise in a list that already tags these as system and prints the
   * key underneath, so it is trimmed. A system collection someone has renamed
   * through `meta.translations` keeps its own name, since that will not carry
   * the prefix.
   */
  const nameOf = (key: string, fallback?: string | null): string => {
    const info = infoOf(key);
    const stored = typeof info?.name === 'string' ? info.name.trim() : '';
    if (stored) return trimSystemPrefix(key, stored);
    if (fallback && fallback.trim()) return fallback.trim();
    return resolveDisplayName(key, info);
  };

  /** The icon Directus would show for this collection. */
  const iconOf = (key: string, fallback = 'dataset'): string => {
    const info = infoOf(key);
    return typeof info?.icon === 'string' && info.icon ? info.icon : fallback;
  };

  return { nameOf, iconOf };
}
