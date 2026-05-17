import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { waitForReady } from '../scrape.js';

export const searchCommitsShape = {
  query: z.string().min(1).describe('Commit search query. Supports: repo:owner/name author:foo committer:bar author-date:>2024-01-01 hash:abc.'),
  page: z.number().int().min(1).max(100).default(1),
};
export const searchCommitsSchema = z.object(searchCommitsShape);
export type SearchCommitsInput = z.infer<typeof searchCommitsSchema>;

export async function searchCommits(input: SearchCommitsInput) {
  await ensureLoggedIn();
  const url = `https://github.com/search?q=${encodeURIComponent(input.query)}&type=commits&p=${input.page}`;
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
      const out: any[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const links = Array.from(row.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        let repository = '';
        let sha = '';
        let commitLink: HTMLAnchorElement | null = null;
        for (const a of links) {
          const m = (a.getAttribute('href') || '').match(/^\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]{7,40})/);
          if (m) { repository = `${m[1]}/${m[2]}`; sha = m[3]; commitLink = a; break; }
        }
        if (!repository || !sha) continue;
        if (seen.has(sha)) continue;
        seen.add(sha);

        const message = txt(commitLink);
        const author = (() => {
          const a = row.querySelector('a[data-hovercard-type="user"]') as HTMLAnchorElement | null;
          return a ? txt(a) || null : null;
        })();
        const time = row.querySelector('relative-time, time');
        const date = time?.getAttribute('datetime') ?? null;

        out.push({
          repository, sha, message,
          url: 'https://github.com' + (commitLink?.getAttribute('href') || ''),
          author, date,
        });
      }

      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { totalCount, matches: out, hasNextPage };
    });

    return { query: input.query, page: input.page, ...data };
  });
}
