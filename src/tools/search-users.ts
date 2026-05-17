import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { waitForReady } from '../scrape.js';

export const searchUsersShape = {
  query: z.string().min(1).describe('User search query. Supports: type:user type:org location:Berlin followers:>1000 language:Go.'),
  page: z.number().int().min(1).max(100).default(1),
};
export const searchUsersSchema = z.object(searchUsersShape);
export type SearchUsersInput = z.infer<typeof searchUsersSchema>;

export async function searchUsers(input: SearchUsersInput) {
  await ensureLoggedIn();
  const url = `https://github.com/search?q=${encodeURIComponent(input.query)}&type=users&p=${input.page}`;
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
        // First href that matches /username (single segment, not a reserved path)
        const links = Array.from(row.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        let username = '';
        for (const a of links) {
          const m = (a.getAttribute('href') || '').match(/^\/([^/?#]+)$/);
          if (m && !/^(search|topics|trending|features|explore|marketplace|pricing|sponsors|enterprise|orgs|users|settings|collections|customer-stories)$/i.test(m[1])) {
            const lt = txt(a);
            if (lt && (lt === m[1] || lt.toLowerCase() === m[1].toLowerCase())) { username = m[1]; break; }
            if (!username) username = m[1];
          }
        }
        if (!username || seen.has(username)) continue;
        seen.add(username);

        // Org vs user: detect by aria-label or avatar shape (orgs have square avatars).
        const avatar = row.querySelector('img[data-square], img.avatar');
        const isOrg = !!row.querySelector('img[data-square="true"]') || /organization/i.test((avatar?.getAttribute('alt') || ''));

        // Description / bio: secondary text
        let bio: string | null = null;
        const descEl = row.querySelector('[class*="Content"], p, [class*="Description"]');
        if (descEl) bio = txt(descEl) || null;

        out.push({
          username,
          type: isOrg ? 'organization' : 'user',
          url: `https://github.com/${username}`,
          bio,
        });
      }

      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { totalCount, matches: out, hasNextPage };
    });

    return { query: input.query, page: input.page, ...data };
  });
}
