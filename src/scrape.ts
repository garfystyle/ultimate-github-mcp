import { Page } from 'playwright';
import { getContext } from './browser.js';

export async function fetchText(url: string): Promise<{ status: number; text: string; ok: boolean }> {
  const ctx = await getContext();
  const resp = await ctx.request.get(url, { maxRedirects: 5 });
  return { status: resp.status(), ok: resp.ok(), text: await resp.text() };
}

export async function fetchBuffer(url: string): Promise<{ status: number; buffer: Buffer; ok: boolean }> {
  const ctx = await getContext();
  const resp = await ctx.request.get(url, { maxRedirects: 5 });
  return { status: resp.status(), ok: resp.ok(), buffer: await resp.body() };
}

export async function waitForReady(
  page: Page,
  testIds: string[] = ['results-list'],
  timeoutMs = 20000,
): Promise<void> {
  await page
    .waitForFunction(
      (testIds) => {
        for (const id of testIds) {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (el && (el.children.length > 0 || (el.textContent || '').length > 0)) return true;
        }
        const text = document.body.innerText || '';
        if (/no results|we couldn.?t find|0 results/i.test(text)) return true;
        return false;
      },
      testIds,
      { timeout: timeoutMs },
    )
    .catch(() => {});
}

export function extractTabCount(page: Page, typeParam: string): Promise<number | null> {
  return page.evaluate((t) => {
    const tabs = Array.from(
      document.querySelectorAll(`a[href*="type=${t}"]`),
    ) as HTMLAnchorElement[];
    for (const tab of tabs) {
      const counters = tab.querySelectorAll('span, [class*="counter" i], [class*="Counter"], [data-content]');
      for (const c of Array.from(counters)) {
        const raw = (c.textContent || '').replace(/[^\d]/g, '');
        const v = parseInt(raw, 10);
        if (!isNaN(v) && v > 0 && v < 100_000_000) return v;
      }
    }
    return null;
  }, typeParam);
}

export const SEARCH_RESULT_ROW_SELECTOR =
  '[data-testid="results-list"] > div, [data-testid="results-list"] > *';

/**
 * Parse search result total count from body text like "15.5k results" or "1,234 commits".
 * Handles k/m/b multipliers. Returns null if not found.
 */
export function parseTotalFromBody(text: string, kindRegex?: RegExp): number | null {
  // First try kind-specific (e.g. /([\d.,]+[kmb]?)\s+code\s+results?/i)
  if (kindRegex) {
    const m = text.match(kindRegex);
    if (m) return parseUnitedNumber(m[1]);
  }
  const m = text.match(/([\d.,]+[kmb]?)\s+results?/i);
  return m ? parseUnitedNumber(m[1]) : null;
}

export function parseUnitedNumber(s: string): number | null {
  const t = s.toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  const m = t.match(/^([\d.]+)([kmb]?)/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  if (m[2] === 'k') n *= 1_000;
  else if (m[2] === 'm') n *= 1_000_000;
  else if (m[2] === 'b') n *= 1_000_000_000;
  return Math.round(n);
}
