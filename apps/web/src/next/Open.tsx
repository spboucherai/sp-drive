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
