// Per-site capabilities for the side panel's "On this page" section. URLs
// mirror the content-script matches + worker tab queries; the items name
// only commands the content scripts really implement (gmail: readOpenEmail,
// draftReply, buttons, inbox watcher; calendar: readDay, createEvent;
// meta: draftPost).

export type PanelSite = 'gmail' | 'calendar' | 'meta';

const SITE_PREFIX: Record<PanelSite, string> = {
  gmail: 'https://mail.google.com/',
  calendar: 'https://calendar.google.com/',
  meta: 'https://business.facebook.com/',
};

export function siteOfUrl(url: string | undefined): PanelSite | null {
  if (typeof url !== 'string') return null;
  for (const [site, prefix] of Object.entries(SITE_PREFIX) as [PanelSite, string][]) {
    if (url.startsWith(prefix)) return site;
  }
  return null;
}

export const SITE_CAPABILITIES: Record<PanelSite, { label: string; items: string[] }> = {
  gmail: {
    label: 'Gmail',
    items: [
      'Read the email you have open',
      'Watch for new mail',
      'Draft replies',
      'Add one-click buttons from your automations',
    ],
  },
  calendar: {
    label: 'Google Calendar',
    items: ["Read what's on your day", 'Create events'],
  },
  meta: {
    label: 'Meta Business Suite',
    items: ['Draft posts'],
  },
};
