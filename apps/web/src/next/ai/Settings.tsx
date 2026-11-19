// The account's own switch for external AI providers, with what it means for privacy, and the state of each route.
// The local MacLustr route needs no switch; an external route needs the server's switch and this one.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { patch } from '../../api.ts';
import { errorText, useT } from '../../i18n.ts';
import { Section } from '../../shell/account-ui.tsx';
import { Badge, Loading, Switch, useToast } from '../../ui.tsx';
import { useMeta } from '../meta.ts';
import { AI_KEY, useAiProviders } from './Ask.tsx';
import { RouteMark } from './marks.tsx';

export function AiSettings() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const meta = useMeta();
  const q = useAiProviders(meta.api >= 2);
  const [busy, setBusy] = useState(false);
  if (meta.api < 2) return null;
  const d = q.data;
  const set = async (v: boolean) => {
    setBusy(true);
    try { await patch('/account', { aiExternal: v }); await Promise.all([qc.invalidateQueries({ queryKey: AI_KEY }), qc.invalidateQueries({ queryKey: ['meta'] })]); toast(v ? t('next.ais.on') : t('next.ais.off'), { tone: 'ok' }); }
    catch (e) { toast(errorText(e), { tone: 'error' }); } finally { setBusy(false); }
  };
  return (
    <Section title={t('next.ais.title')} text={t('next.ais.text')}>
      {q.isLoading || !d ? <Loading /> : (
        <div className="flex flex-col gap-4" data-testid="ai-settings">
          <Switch checked={d.external.account} disabled={busy} onChange={(v) => void set(v)} label={t('next.ais.switch')} hint={t('next.ais.switchHint')} />
          <div className="rounded-[12px] bg-hover px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
            <p className="font-medium text-ink">{t('next.ais.privacyTitle')}</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>{t('next.ais.p1')}</li><li>{t('next.ais.p2')}</li><li>{t('next.ais.p3')}</li>
            </ul>
            {!d.external.server ? <p className="mt-2 text-xs text-warn" data-testid="ai-server-off">{t('next.ais.serverOff')}</p> : null}
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-[12px] shadow-(--spd-elevation-e0)" aria-label={t('next.ais.routes')}>
            {d.providers.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2.5" data-provider={p.id} data-usable={p.usable}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hover text-ink"><RouteMark id={p.id} /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-ink">{p.label}</p><p className="truncate text-xs text-ink-3">{p.local ? t('next.ais.localRoute') : t('next.ais.externalRoute')}{p.models.length ? ` · ${p.models.map((m) => `${m.label} (${m.creator})`).join(', ')}` : ''}</p></div>
                <Badge tone={p.usable ? 'ok' : p.configured ? 'warn' : 'neutral'}>{p.usable ? t('next.ais.usable') : p.configured ? t('next.ais.blocked') : t('next.ais.notConfigured')}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
