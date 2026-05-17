import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseCount } from '../util.js';

export const getUserShape = {
  username: z.string().describe('User or organization login.'),
};
export const getUserSchema = z.object(getUserShape);
export type GetUserInput = z.infer<typeof getUserSchema>;

export async function getUser(input: GetUserInput) {
  await ensureLoggedIn();
  const url = `https://github.com/${input.username}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`User/org "${input.username}" not found.`);

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      function attr(el: Element | null, k: string) { return el?.getAttribute(k) ?? null; }

      const isOrg = !!document.querySelector('meta[name="hovercard-subject-tag"][content^="organization"]') ||
        !!document.querySelector('.orghead, [data-testid="org-header"]');

      const displayName = txt(document.querySelector('h1.vcard-names .p-name, [itemprop="name"], .org-name'));
      const bio = txt(document.querySelector('.user-profile-bio, .p-note, [data-testid="profile-bio"]'));
      const location = txt(document.querySelector('[itemprop="homeLocation"], li.vcard-detail[itemprop*="location" i]'));
      const company = txt(document.querySelector('[itemprop="worksFor"], li[itemprop*="company" i]'));
      const blog = attr(document.querySelector('[itemprop="url"] a, a[rel*="me" i][href^="http"]'), 'href');
      const email = txt(document.querySelector('[itemprop="email"], a[href^="mailto:"]'));

      // Counters: followers, following, repos. Look for /username?tab=followers etc.
      function counterByHref(hrefSubstr: string): number | null {
        const a = document.querySelector(`a[href*="${hrefSubstr}"] .Counter, a[href*="${hrefSubstr}"] span.text-bold, a[href*="${hrefSubstr}"]`);
        if (!a) return null;
        const t = (a.textContent || '').trim();
        const m = t.match(/([\d.,]+\s*[kmb]?)/i);
        if (!m) return null;
        const x = m[1].toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
        const mm = x.match(/^([\d.]+)([kmb]?)/);
        if (!mm) return null;
        let n = parseFloat(mm[1]);
        if (mm[2] === 'k') n *= 1_000;
        else if (mm[2] === 'm') n *= 1_000_000;
        else if (mm[2] === 'b') n *= 1_000_000_000;
        return Math.round(n);
      }
      const followers = counterByHref('tab=followers');
      const following = counterByHref('tab=following');
      const repos = counterByHref('tab=repositories');

      // Pinned repos
      const pinned: any[] = [];
      const pins = document.querySelectorAll('.js-pinned-items-reorder-container .pinned-item-list-item, [data-testid="pinned-items"] li, ol.js-pinned-items-reorder-list li');
      pins.forEach((p) => {
        const a = p.querySelector('a[href*="/"]') as HTMLAnchorElement | null;
        if (!a) return;
        const m = (a.getAttribute('href') || '').match(/^\/([^/]+)\/([^/]+)$/);
        if (!m) return;
        const description = txt(p.querySelector('p.pinned-item-desc, p'));
        const language = txt(p.querySelector('[itemprop="programmingLanguage"]'));
        pinned.push({
          repository: `${m[1]}/${m[2]}`,
          url: 'https://github.com' + (a.getAttribute('href') || ''),
          description: description || null,
          language: language || null,
        });
      });

      const avatar = (document.querySelector('img.avatar, img[itemprop="image"]') as HTMLImageElement | null)?.src ?? null;

      return {
        type: isOrg ? 'organization' : 'user',
        displayName: displayName || null,
        bio: bio || null,
        location: location || null,
        company: company || null,
        blog: blog || null,
        email: email || null,
        followers, following, repoCount: repos,
        avatar,
        pinned,
      };
    });

    return { username: input.username, url, ...data };
  });
}
