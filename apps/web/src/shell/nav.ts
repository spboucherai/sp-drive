// The destinations of the application, in the order of the sidebar. A destination tied to a server feature is only
// shown when GET /meta lists that feature.
import type { Feature } from '../next/types.ts';

export interface NavItem { href: string; icon: string; label: string; /** short label for the phone tab bar */ short?: string; admin?: boolean; feature?: Feature; group: 'places' | 'library' | 'system'; match: (path: string) => boolean }
const at = (p: string) => (path: string) => path === p || path.startsWith(`${p}/`);
export const NAV: NavItem[] = [
  { href: '/', icon: 'folder', label: 'account.nav.files', short: 'account.nav.filesShort', group: 'places', match: (p) => p === '/' || p.startsWith('/folder/') },
  { href: '/recent', icon: 'clock', label: 'account.nav.recent', group: 'places', match: at('/recent') },
  { href: '/starred', icon: 'star', label: 'account.nav.starred', group: 'places', match: at('/starred') },
  { href: '/shared', icon: 'users', label: 'next.nav.shared', feature: 'collab', group: 'places', match: at('/shared') },
  { href: '/shares', icon: 'link', label: 'account.nav.shares', group: 'library', match: at('/shares') },
  { href: '/requests', icon: 'inbox', label: 'account.nav.requests', short: 'account.nav.requestsShort', group: 'library', match: at('/requests') },
  { href: '/ask', icon: 'sparkle', label: 'next.nav.ask', feature: 'ai', group: 'library', match: at('/ask') },
  { href: '/activity', icon: 'activity', label: 'next.nav.activity', feature: 'activity', group: 'library', match: at('/activity') },
  { href: '/storage', icon: 'chart', label: 'next.nav.storage', feature: 'storage', group: 'library', match: at('/storage') },
  { href: '/duplicates', icon: 'duplicate', label: 'account.nav.duplicates', group: 'library', match: at('/duplicates') },
  { href: '/trash', icon: 'trash', label: 'account.nav.trash', group: 'library', match: at('/trash') },
];
export const SETTINGS: NavItem = { href: '/settings', icon: 'settings', label: 'account.nav.settings', group: 'system', match: at('/settings') };
export const ADMIN: NavItem = { href: '/admin', icon: 'shield', label: 'account.nav.admin', admin: true, group: 'system', match: at('/admin') };
/** Phone tab bar: these four, then "Plus" for everything else. */
export const TABS = ['/', '/recent', '/shares', '/requests'];
export const visibleNav = (features: readonly string[]): NavItem[] => NAV.filter((n) => !n.feature || features.includes(n.feature));
