// Capability discovery: what this server can do right now. A feature the server does not list is hidden, never faked.
import { useQuery } from '@tanstack/react-query';
import { ApiError, get } from '../api.ts';
import type { Feature, Meta } from './types.ts';

const OLD: Meta = { api: 1, version: '1.0.0', features: [] };
export const META_KEY = ['meta'];
export function useMeta(): Meta {
  const q = useQuery({
    queryKey: META_KEY, staleTime: 60_000, refetchInterval: 5 * 60_000,
    queryFn: () => get<Meta>('/meta').catch((e) => { if (e instanceof ApiError && e.status === 404) return OLD; throw e; }),
  });
  return q.data ?? OLD;
}
export function useFeature(f: Feature): boolean { return useMeta().features.includes(f); }
