/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/preview/MarkdownView.tsx
 * Module           : preview
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
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

// Markdown rendered through marked, then sanitised by DOMPurify: the only place of the viewer where HTML derived from
// a file reaches the page. Scripts, handlers, styles, forms and embedded frames are removed; links only keep http(s)
// and mailto targets and open in a new tab without an opener; images that are not embedded (data:) are replaced by a
// placeholder, so that opening a document never makes the browser call a third party.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo, useState } from 'react';
import { useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { IconButton } from '../ui.tsx';
import { Note, Tools, ToolToggle } from './shared.tsx';
import { TextBlock, TextGate, TruncatedNote } from './TextViews.tsx';

const purify = DOMPurify(window); // a private instance: its hooks do not leak to other users of the library
const SAFE_LINK = /^(https?:|mailto:)/i;
const EMBEDDED_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,/i;
purify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as Element;
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (SAFE_LINK.test(href.trim())) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer nofollow'); }
    else el.removeAttribute('href');
  } else if (el.tagName === 'INPUT') {
    if (el.getAttribute('type') === 'checkbox') el.setAttribute('disabled', ''); else el.remove();
  }
});
const FORBID_TAGS = ['style', 'form', 'button', 'select', 'textarea', 'iframe', 'frame', 'object', 'embed', 'video', 'audio', 'source', 'track', 'picture', 'svg', 'math', 'link', 'meta', 'base', 'dialog', 'template', 'slot', 'canvas', 'map', 'area'];
const FORBID_ATTR = ['style', 'srcset', 'sizes', 'class', 'id', 'name', 'background', 'poster', 'ping', 'action', 'formaction', 'autofocus', 'contenteditable', 'tabindex', 'is', 'slot', 'part'];

export function renderMarkdown(text: string, blockedLabel: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: false });
  const clean = purify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS, FORBID_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/)/i, RETURN_DOM_FRAGMENT: true });
  const box = document.implementation.createHTMLDocument('').createElement('div');
  box.append(clean);
  // still in an inert document: images that are not embedded in the file become a placeholder before anything can load
  for (const img of box.querySelectorAll('img')) {
    if (EMBEDDED_IMAGE.test(img.getAttribute('src') ?? '')) continue;
    const ph = box.ownerDocument.createElement('span');
    const alt = img.getAttribute('alt');
    ph.className = 'spd-md-blocked'; ph.textContent = alt ? `${blockedLabel} — ${alt}` : blockedLabel;
    img.replaceWith(ph);
  }
  return box.innerHTML;
}

function Rendered({ text }: { text: string }) {
  const t = useT();
  const label = t('preview.mdImageBlocked');
  const html = useMemo(() => renderMarkdown(text, label), [text, label]);
  const blocked = html.includes('spd-md-blocked');
  return (
    <>
      {blocked ? <Note testId="md-blocked-note">{t('preview.mdImagesNote')}</Note> : null}
      <div className="min-h-0 flex-1 overflow-auto bg-surface" tabIndex={0}>
        {/* the only dangerouslySetInnerHTML of the viewer: `html` is the DOMPurify output above */}
        <article className="spd-md mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8" data-testid="markdown" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </>
  );
}

export function MarkdownView({ source }: { source: PreviewSource }) {
  const t = useT();
  const [raw, setRaw] = useState(false);
  const [wrap, setWrap] = useState(true);
  return (
    <TextGate source={source}>
      {(s) => (
        <>
          <Tools>
            <ToolToggle active={!raw} onClick={() => setRaw(false)} testId="md-rendered">{t('preview.rendered')}</ToolToggle>
            <ToolToggle active={raw} onClick={() => setRaw(true)} testId="md-source">{t('preview.source')}</ToolToggle>
            {raw ? <IconButton icon="wrap" label={t('preview.wrap')} active={wrap} onClick={() => setWrap(!wrap)} /> : null}
          </Tools>
          <TruncatedNote state={s} />
          {raw ? <TextBlock text={s.text} wrap={wrap} /> : <Rendered text={s.text} />}
        </>
      )}
    </TextGate>
  );
}
