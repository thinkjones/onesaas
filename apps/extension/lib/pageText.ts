import { browser } from 'wxt/browser';

/** What a run started by hand gets to work with from the tab the owner is looking at. */
export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
}

// Keeps one huge page from swamping the AI step. The server rejects anything larger.
export const PAGE_TEXT_LIMIT = 30_000;

/**
 * Reads the active tab, only when the owner starts a run. Null when it can't be read
 * (chrome:// pages, the Web Store, a tab with no text), so the run still starts.
 */
export async function readActivePage(): Promise<PageSnapshot | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || tab.url === undefined) return null;
    const [frame] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      // Runs inside the page, so it can't use anything from this module.
      func: () => ({ title: document.title, text: document.body?.innerText ?? '' }),
    });
    const page = frame?.result as { title: string; text: string } | undefined;
    if (!page || page.text.trim().length === 0) return null;
    return { url: tab.url, title: page.title, text: page.text.slice(0, PAGE_TEXT_LIMIT) };
  } catch (err) {
    console.warn('[panel] could not read the page', err);
    return null;
  }
}
