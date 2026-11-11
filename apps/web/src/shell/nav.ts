// The destinations of the application, in the order of the sidebar.
export interface NavItem { href: string; icon: string; label: string; /** short label for the phone tab bar */ short?: string; admin?: boolean; match: (path: string) => boolean }
const at = (p: string) => (path: string) => path === p || path.startsWith(`${p}/`);
export const NAV: NavItem[] = [
  { href: '/', icon: 'folder', label: 'account.nav.files', short: 'account.nav.filesShort', match: (p) => p === '/' || p.startsWith('/folder/') },
  { href: '/recent', icon: 'clock', label: 'account.nav.recent', match: at('/recent') },
  { href: '/starred', icon: 'star', label: 'account.nav.starred', match: at('/starred') },
  { href: '/shares', icon: 'share', label: 'account.nav.shares', match: at('/shares') },
  { href: '/requests', icon: 'inbox', label: 'account.nav.requests', short: 'account.nav.requestsShort', match: at('/requests') },
  { href: '/duplicates', icon: 'duplicate', label: 'account.nav.duplicates', match: at('/duplicates') },
  { href: '/trash', icon: 'trash', label: 'account.nav.trash', match: at('/trash') },
];
export const SETTINGS: NavItem = { href: '/settings', icon: 'settings', label: 'account.nav.settings', match: at('/settings') };
export const ADMIN: NavItem = { href: '/admin', icon: 'shield', label: 'account.nav.admin', admin: true, match: at('/admin') };
/** Phone tab bar: these four, then "Plus" for everything else. */
export const TABS = ['/', '/recent', '/shares', '/requests'];
