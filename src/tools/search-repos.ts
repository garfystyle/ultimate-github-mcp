import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseCount } from '../util.js';

export const searchReposShape = {
  query: z
    .string()
    .min(1)
    .describe(
      'Repository search query. Supports GitHub syntax: language:Go, stars:>1000, topic:cli, user:foo, archived:false, etc.',
    ),
  sort: z
    .enum(['best-match', 'stars', 'forks', 'updated'])
    .default('best-match')
    .describe('Sort order.'),
  page: z.number().int().min(1).max(100).default(1).describe('Page number (1-based).'),
};

export const searchReposSchema = z.object(searchReposShape);
export type SearchReposInput = z.infer<typeof searchReposSchema>;

export interface RepoMatch {
  repository: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  updated: string | null;
  topics: string[];
}

export interface SearchReposResult {
  query: string;
  page: number;
  totalCount: number | null;
  matches: RepoMatch[];
  hasNextPage: boolean;
}

const SORT_MAP: Record<string, string> = {
  'best-match': '',
  stars: '&s=stars&o=desc',
  forks: '&s=forks&o=desc',
  updated: '&s=updated&o=desc',
};

export async function searchRepos(input: SearchReposInput): Promise<SearchReposResult> {
  await ensureLoggedIn();
  const sortQs = SORT_MAP[input.sort] ?? '';
  const url = `https://github.com/search?q=${encodeURIComponent(input.query)}&type=repositories&p=${input.page}${sortQs}`;

  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page
      .waitForFunction(
        () => {
          const list = document.querySelector('[data-testid="results-list"]');
          if (list && list.children.length > 0) return true;
          const text = document.body.innerText || '';
          if (/no results|we couldn.?t find/i.test(text)) return true;
          return false;
        },
        { timeout: 25000 },
      )
      .catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null): string {
        return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      }

      // Total count from the Repositories tab counter.
      let totalCount: number | null = null;
      const repoTabs = Array.from(
        document.querySelectorAll('a[href*="type=repositories"]'),
      ) as HTMLAnchorElement[];
      for (const t of repoTabs) {
        const counters = t.querySelectorAll('span, [class*="counter" i], [data-content]');
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
      if (totalCount === null) {
        const m = (document.body.innerText || '').match(
          /\b([\d,]+)\s+(?:repository|repositories|results?)\b/i,
        );
        if (m) totalCount = parseInt(m[1].replace(/,/g, ''), 10);
      }

      const out: Array<{
        repository: string;
        url: string;
        description: string | null;
        language: string | null;
        starsExact: number | null;
        starsText: string | null;
        updated: string | null;
        topics: string[];
      }> = [];

      const list = document.querySelector('[data-testid="results-list"]');
      const rows = list ? Array.from(list.children) : [];

      const seen = new Set<string>();
      for (const row of rows) {
        // Title link: h3 > a (or any) with href matching /owner/repo.
        let repository = '';
        let href = '';
        const candidates = Array.from(row.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        for (const a of candidates) {
          const h = a.getAttribute('href') || '';
          const m = h.match(/^\/([^/?#]+)\/([^/?#]+)$/);
          if (
            m &&
            !/^(features|topics|search|sponsors|orgs|users|settings|marketplace|enterprise|trending|collections|customer-stories|pricing)$/i.test(
              m[1],
            )
          ) {
            // Reject if link text doesn't look like a repo name.
            const lt = txt(a);
            if (lt && (lt === `${m[1]}/${m[2]}` || lt.endsWith(`/${m[2]}`) || lt === m[2])) {
              repository = `${m[1]}/${m[2]}`;
              href = h;
              break;
            }
            if (!repository) {
              repository = `${m[1]}/${m[2]}`;
              href = h;
            }
          }
        }
        if (!repository || seen.has(repository)) continue;
        seen.add(repository);

        // Description: text in .Content-module__* container.
        let description: string | null = null;
        const descEl =
          row.querySelector('[class*="Content-module"]') ||
          row.querySelector('[class*="SearchMatchText"]:not([class*="truncatedName"])');
        if (descEl) description = txt(descEl) || null;

        // Stars: exact count in aria-label="N stars" attribute.
        let starsExact: number | null = null;
        let starsText: string | null = null;
        const starLink =
          (row.querySelector('a[aria-label$=" stars"], a[aria-label$=" star"]') as HTMLAnchorElement | null) ??
          (row.querySelector('a[href$="/stargazers"]') as HTMLAnchorElement | null);
        if (starLink) {
          const al = starLink.getAttribute('aria-label') || '';
          const m = al.match(/([\d,]+)\s+stars?/);
          if (m) {
            const v = parseInt(m[1].replace(/,/g, ''), 10);
            if (!isNaN(v)) starsExact = v;
          }
          starsText = txt(starLink) || null;
        }

        // Language: span[aria-label$=" language"].
        let language: string | null = null;
        const langEl = row.querySelector('span[aria-label$=" language"]');
        if (langEl) language = txt(langEl) || null;

        // Topics
        const topics = Array.from(row.querySelectorAll('a[href*="/topics/"]'))
          .map((a) => txt(a))
          .filter(Boolean);

        // Updated: relative-time or fallback to row text
        let updated: string | null = null;
        const rt = row.querySelector('relative-time, time');
        if (rt) {
          updated =
            rt.getAttribute('datetime') ||
            rt.getAttribute('title') ||
            txt(rt) ||
            null;
        }
        if (!updated) {
          const rowTxt = (row as HTMLElement).innerText || '';
          const m = rowTxt.match(/Updated\s+(?:on\s+)?(.+?)(?:\n|$)/i);
          if (m) updated = m[1].trim();
        }

        out.push({
          repository,
          url: 'https://github.com' + href,
          description,
          language,
          starsExact,
          starsText,
          updated,
          topics,
        });
      }

      const hasNextPage = !!document.querySelector(
        'a[rel="next"], a[aria-label="Next page"], a[aria-label*="Next"]',
      );

      return { totalCount, out, hasNextPage };
    });

    const matches: RepoMatch[] = data.out.map((r) => ({
      repository: r.repository,
      url: r.url,
      description: r.description,
      language: r.language,
      stars: r.starsExact ?? parseCount(r.starsText),
      updated: r.updated,
      topics: r.topics,
    }));

    return {
      query: input.query,
      page: input.page,
      totalCount: data.totalCount,
      matches,
      hasNextPage: data.hasNextPage,
    };
  });
}
