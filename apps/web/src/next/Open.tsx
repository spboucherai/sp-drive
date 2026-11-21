/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/next/Open.tsx
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

// /open/<fileId>[?page=n] — a stable address for "this file" (AI citations, activity): finds where the file lives and
// opens its preview there, at the given page for a paged document.
import { useQuery } from '@tanstack/react-query';
import { Redirect, useSearch } from 'wouter';
import { get } from '../api.ts';
import type { FileDetail } from '../types.ts';
import { ErrorState, Loading } from '../ui.tsx';

export function OpenFile({ id }: { id: string }) {
  const page = Number(new URLSearchParams(useSearch()).get('page'));
  const q = useQuery({ queryKey: ['explorer', 'file', id], queryFn: () => get<FileDetail>(`/files/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return <Redirect to={`/folder/${q.data.file.folderId}?file=${id}${page > 1 ? `&page=${page}` : ''}`} replace />;
}
