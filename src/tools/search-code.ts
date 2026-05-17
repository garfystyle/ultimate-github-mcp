import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { clip } from '../util.js';

export const searchCodeShape = {
  query: z
    .string()
    .min(1)
    .describe(
      'Code search query. Supports GitHub code search syntax: language:python, repo:owner/name, path:src/**, org:foo, "exact phrase", -term, etc.',
    ),
  page: z.number().int().min(1).max(100).default(1).describe('Page number (1-based).'),
  maxSnippetChars: z
    .number()
    .int()
    .min(40)
    .max(2000)
    .default(400)
    .describe('Max chars of code snippet per match.'),
};

export const searchCodeSchema = z.object(searchCodeShape);
export type SearchCodeInput = z.infer<typeof searchCodeSchema>;

export interface CodeMatch {
  repository: string;
  path: string;
  url: string;
  snippets: string[];
}

export interface SearchCodeResult {
  query: string;
  page: number;
  totalCount: number | null;
  matches: CodeMatch[];
  hasNextPage: boolean;
}

export async function searchCode(input: SearchCodeInput): Promise<SearchCodeResult> {
  await ensureLoggedIn();
  const url = `https://github.com/search?q=${encodeURIComponent(input.query)}&type=code&p=${input.page}`;

  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait for results, an empty state, or a "couldn't search code" message.
    await page
      .waitForFunction(
        () => {
          if (document.querySelector('[data-testid="results-list"]')) return true;
          if (document.querySelector('[data-testid="no-results"]')) return true;
          // Fallback: any link to /owner/repo/blob/
          const anyBlob = document.querySelector('a[href*="/blob/"]');
          if (anyBlob) return true;
          const text = document.body.innerText || '';
          if (/we couldn.?t find any code|0 results|no results/i.test(text)) return true;
          return false;
        },
        { timeout: 25000 },
      )
      .catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null): string {
        return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      }

      // Total count: try multiple strategies.
      let totalCount: number | null = null;

      // Strategy 1: the active "Code" tab counter (most reliable when logged in).
      const codeTabs = Array.from(
        document.querySelectorAll('a[href*="type=code"]'),
      ) as HTMLAnchorElement[];
      for (const tab of codeTabs) {
        // Find counter-like nested element
        const counters = tab.querySelectorAll(
          'span, [class*="counter" i], [class*="Counter"], [data-content]',
        );
        for (const c of Array.from(counters)) {
          const raw = (c.textContent || '').replace(/[^\d]/g, '');
          const v = parseInt(raw, 10);
          if (!isNaN(v) && v > 0 && v < 100_000_000) {
            totalCount = v;
            break;
          }
        }
        if (totalCount !== null) break;
      }

      // Strategy 2: regex on the visible body text.
      if (totalCount === null) {
        const allText = document.body.innerText || '';
        const m =
          allText.match(/\b([\d,]+)\s+code\s+results?\b/i) ||
          allText.match(/\bCode\b[^\d]{0,20}([\d,]+)\b/) ||
          allText.match(/\b([\d,]+)\s+results?\b/i);
        if (m) {
          const v = parseInt(m[1].replace(/,/g, ''), 10);
          if (!isNaN(v)) totalCount = v;
        }
      }

      // Each match: a result row holds at least one link to /owner/repo/blob/REF/PATH
      const results: Array<{
        repository: string;
        path: string;
        url: string;
        rowText: string;
      }> = [];

      // Try the testid container first.
      const containers = Array.from(
        document.querySelectorAll('[data-testid="results-list"] > div, [data-testid="results-list"] > *'),
      );
      const rows: Element[] =
        containers.length > 0
          ? containers
          : Array.from(document.querySelectorAll('div')).filter((d) =>
              d.querySelector('a[href*="/blob/"]'),
            );

      const seen = new Set<string>();
      for (const row of rows) {
        const links = Array.from(row.querySelectorAll('a[href*="/blob/"]')) as HTMLAnchorElement[];
        let bestRepo = '';
        let bestPath = '';
        let bestUrl = '';
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)(?:[#?].*)?$/);
          if (m) {
            bestRepo = `${m[1]}/${m[2]}`;
            bestPath = m[4];
            bestUrl = 'https://github.com' + href;
            break;
          }
        }
        if (!bestRepo) continue;
        const key = bestUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        const rowText = (row as HTMLElement).innerText || '';
        results.push({ repository: bestRepo, path: bestPath, url: bestUrl, rowText });
      }

      const hasNextPage = !!document.querySelector(
        'a[rel="next"], a[aria-label="Next page"], a[aria-label*="Next"]',
      );

      return { totalCount, results, hasNextPage };
    });

    const matches: CodeMatch[] = data.results.map((r) => {
      // Extract snippet: take rowText, strip the repo/path header noise.
      const lines = r.rowText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      // Drop the first line if it looks like the repo header.
      const headerIdx = lines.findIndex((l) =>
        l.startsWith(r.repository) || l.endsWith(r.path) || l === r.path,
      );
      const tail = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;
      const joined = tail.join('\n');
      const snippet = clip(joined, input.maxSnippetChars);
      return {
        repository: r.repository,
        path: r.path,
        url: r.url,
        snippets: snippet ? [snippet] : [],
      };
    });

    // Fallback: if total count is unknown but we have matches and no next page,
    // we can be sure the total is at least matches.length on page 1.
    let totalCount = data.totalCount;
    if (totalCount === null && input.page === 1 && !data.hasNextPage && matches.length > 0) {
      totalCount = matches.length;
    }

    return {
      query: input.query,
      page: input.page,
      totalCount,
      matches,
      hasNextPage: data.hasNextPage,
    };
  });
}
