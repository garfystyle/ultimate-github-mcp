import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { waitForReady } from '../scrape.js';

export const searchIssuesShape = {
  query: z.string().min(1).describe('Issue search query. Supports: is:open is:closed label:bug author:foo assignee:bar repo:owner/name org:foo "phrase".'),
  page: z.number().int().min(1).max(100).default(1),
};
export const searchIssuesSchema = z.object(searchIssuesShape);
export type SearchIssuesInput = z.infer<typeof searchIssuesSchema>;

export interface IssueMatch {
  repository: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged' | 'draft' | 'unknown';
  author: string | null;
  labels: string[];
  comments: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function searchIssues(input: SearchIssuesInput) {
  await ensureLoggedIn();
  const url = `https://github.com/search?q=${encodeURIComponent(input.query)}&type=issues&p=${input.page}`;

  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForReady(page);

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }

      let totalCount: number | null = null;
      const bodyText = document.body.innerText || '';
      const m = bodyText.match(/([\d.,]+[kmb]?)\s+results?/i);
      if (m) {
        const t = m[1].toLowerCase().replace(/,/g, '');
        const mm = t.match(/^([\d.]+)([kmb]?)/);
        if (mm) {
          let n = parseFloat(mm[1]);
          if (mm[2] === 'k') n *= 1_000;
          else if (mm[2] === 'm') n *= 1_000_000;
          else if (mm[2] === 'b') n *= 1_000_000_000;
          totalCount = Math.round(n);
        }
      }

      const list = document.querySelector('[data-testid="results-list"]');
      const rows = list ? Array.from(list.children) : [];
      const out: IssueMatch[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        // Find issue link: /owner/repo/issues/N
        const links = Array.from(row.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        let repository = '';
        let number = 0;
        let titleLink: HTMLAnchorElement | null = null;
        for (const a of links) {
          const m = (a.getAttribute('href') || '').match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
          if (m) {
            repository = `${m[1]}/${m[2]}`;
            number = parseInt(m[3], 10);
            titleLink = a;
            break;
          }
        }
        if (!repository || !number) continue;
        const key = `${repository}#${number}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const title = txt(titleLink);

        // State
        let state: IssueMatch['state'] = 'unknown';
        const stateIcon = row.querySelector('[aria-label*="Open issue" i], [aria-label*="Closed issue" i], svg[class*="octicon-issue" i]');
        const aria = stateIcon?.getAttribute('aria-label') || '';
        if (/open issue/i.test(aria)) state = 'open';
        else if (/closed issue/i.test(aria)) state = 'closed';

        const author = (() => {
          const a = row.querySelector('a[data-hovercard-type="user"], a[href^="/"][class*="author" i]') as HTMLAnchorElement | null;
          return a ? txt(a) || null : null;
        })();

        const labels = Array.from(row.querySelectorAll('a[href*="/labels/"]'))
          .map((l) => txt(l))
          .filter(Boolean);

        let comments: number | null = null;
        const commentLink = row.querySelector('a[href*="#issuecomment"], a[href$="#comments"]');
        if (commentLink) {
          const v = parseInt((commentLink.textContent || '').replace(/[^\d]/g, ''), 10);
          if (!isNaN(v)) comments = v;
        }

        const times = Array.from(row.querySelectorAll('relative-time, time'));
        const createdAt = times[0]?.getAttribute('datetime') ?? null;
        const updatedAt = times[times.length - 1]?.getAttribute('datetime') ?? null;

        out.push({
          repository,
          number,
          title,
          url: 'https://github.com' + (titleLink?.getAttribute('href') || ''),
          state,
          author,
          labels,
          comments,
          createdAt,
          updatedAt,
        });
      }

      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { totalCount, matches: out, hasNextPage };
    });

    return { query: input.query, page: input.page, ...data };
  });
}
