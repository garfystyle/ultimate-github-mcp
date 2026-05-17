import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';

export const listUserReposShape = {
  username: z.string().describe('User or organization login.'),
  type: z.enum(['all', 'public', 'private', 'source', 'fork', 'archived', 'mirror']).default('all'),
  sort: z.enum(['updated', 'stargazers', 'name']).default('updated'),
  language: z.string().default(''),
  page: z.number().int().min(1).max(100).default(1),
};
export const listUserReposSchema = z.object(listUserReposShape);
export type ListUserReposInput = z.infer<typeof listUserReposSchema>;

export async function listUserRepos(input: ListUserReposInput) {
  await ensureLoggedIn();
  const params = new URLSearchParams();
  params.set('tab', 'repositories');
  if (input.type !== 'all') params.set('type', input.type);
  params.set('sort', input.sort === 'stargazers' ? 'stargazers' : input.sort);
  if (input.language) params.set('language', input.language);
  params.set('page', String(input.page));
  const url = `https://github.com/${input.username}?${params.toString()}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`User/org "${input.username}" not found.`);
    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const repos: any[] = [];
      const items = document.querySelectorAll('#user-repositories-list li, .source.public, .user-repo-search-results-summary ~ * li');
      items.forEach((li) => {
        const a = li.querySelector('a[itemprop="name codeRepository"], h3 a') as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute('href') || '';
        const m = href.match(/^\/([^/]+)\/([^/]+)$/);
        if (!m) return;
        const description = txt(li.querySelector('p[itemprop="description"], p.col-9'));
        const language = txt(li.querySelector('[itemprop="programmingLanguage"]'));
        const time = li.querySelector('relative-time, time');
        const updated = time?.getAttribute('datetime') ?? null;
        const starLink = li.querySelector('a[href$="/stargazers"]');
        let stars: number | null = null;
        if (starLink) {
          const t = (starLink.textContent || '').replace(/,/g, '').replace(/\s+/g, '');
          const mm = t.toLowerCase().match(/^([\d.]+)([kmb]?)/);
          if (mm) {
            let n = parseFloat(mm[1]);
            if (mm[2] === 'k') n *= 1_000;
            else if (mm[2] === 'm') n *= 1_000_000;
            else if (mm[2] === 'b') n *= 1_000_000_000;
            stars = Math.round(n);
          }
        }
        // isFork: explicit "Forked from X" text near the title; just having the forked octicon isn't enough since list items reuse the icon for repo type.
        const forkedFromText = (li as HTMLElement).innerText || '';
        const isFork = /\bForked from\s+[\w./-]+/i.test(forkedFromText);
        // isArchived: a Label with the literal word "Public archive" or "Archived"
        const labels = Array.from(li.querySelectorAll('span[class*="Label"], .Label'));
        const isArchived = labels.some((el) => /\b(Public archive|Archived)\b/i.test(el.textContent || ''));
        repos.push({
          repository: `${m[1]}/${m[2]}`,
          url: 'https://github.com' + href,
          description: description || null,
          language: language || null,
          stars,
          updated,
          isFork,
          isArchived,
        });
      });
      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { repos, hasNextPage };
    });
    return { username: input.username, page: input.page, url, ...data };
  });
}
