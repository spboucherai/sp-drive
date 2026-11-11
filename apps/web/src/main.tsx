import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api.ts';
import { App } from './App.tsx';
import { applyTheme } from './theme.ts';
import { ToastProvider } from './ui.tsx';

applyTheme();
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500) }, mutations: { retry: false } },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={queryClient}><ToastProvider><App /></ToastProvider></QueryClientProvider></StrictMode>,
);
// Installable app shell. Never registered in development: a stale worker would hide code changes.
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
