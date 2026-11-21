/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/next/meta.ts
 * Module           : next
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
