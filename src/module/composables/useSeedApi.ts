import { useApi } from '@directus/extensions-sdk';
import type {
  CollectionDescriptor,
  FakerMethodEntry,
  GenerationRequest,
  PreviewRequest,
  PresetRow,
  StrategyMap,
} from '../types';

const BASE = '/seed-studio';

export interface CollectionSummary {
  collection: string;
  displayName: string;
  fieldCount: number;
  rowCount: number;
  isSystem: boolean;
}

export function useSeedApi() {
  const api = useApi();

  return {
    async listCollections(showSystem = false): Promise<CollectionSummary[]> {
      const res = await api.get(`${BASE}/collections`, { params: { showSystem } });
      return res.data?.collections ?? [];
    },

    async getSchema(collection: string): Promise<CollectionDescriptor> {
      const res = await api.get(`${BASE}/schema/${encodeURIComponent(collection)}`);
      return res.data;
    },

    async preview(body: PreviewRequest): Promise<{ rows: Record<string, unknown>[] }> {
      const res = await api.post(`${BASE}/preview`, body);
      return res.data;
    },

    async generate(body: GenerationRequest): Promise<{ runId: string }> {
      const res = await api.post(`${BASE}/generate`, body);
      return res.data;
    },

    progressUrl(runId: string): string {
      const baseUrl = (api.defaults?.baseURL ?? '').replace(/\/$/, '');
      const headers: any = api.defaults?.headers ?? {};
      const raw =
        headers.common?.Authorization ??
        headers.Authorization ??
        headers.common?.authorization ??
        headers.authorization ??
        '';
      const token = String(raw).replace(/^Bearer\s+/i, '').trim();
      const qs = token ? `?access_token=${encodeURIComponent(token)}` : '';
      return `${baseUrl}${BASE}/generate/${encodeURIComponent(runId)}/progress${qs}`;
    },

    async listPresets(collection: string): Promise<PresetRow[]> {
      const res = await api.get(`${BASE}/presets/${encodeURIComponent(collection)}`);
      return res.data?.presets ?? [];
    },

    async savePreset(body: PresetRow): Promise<{ id: string }> {
      const res = await api.post(`${BASE}/presets`, body);
      return res.data;
    },

    async deletePreset(id: string): Promise<void> {
      await api.delete(`${BASE}/presets/${encodeURIComponent(id)}`);
    },

    async listRuns(limit = 25, offset = 0): Promise<unknown[]> {
      const res = await api.get(`${BASE}/runs`, { params: { limit, offset } });
      return res.data?.runs ?? [];
    },

    async fakerMethods(): Promise<FakerMethodEntry[]> {
      const res = await api.get(`${BASE}/faker-methods`);
      return res.data?.methods ?? [];
    },
  };
}

export type SeedApi = ReturnType<typeof useSeedApi>;
export type { StrategyMap };
