import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef, parseCount } from '../util.js';

export const getDependentsShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  kind: z.enum(['repositories', 'packages']).default('repositories'),
  packageId: z.string().optional().describe('Specific package_id (visible on the dropdown when a repo has multiple packages).'),
  cursor: z.string().optional().describe('Pagination cursor (URL param `dependents_after`).'),
};
export const getDependentsSchema = z.object(getDependentsShape);
export type GetDependentsInput = z.infer<typeof getDependentsSchema>;

export async function getDependents(input: GetDependentsInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const params = new URLSearchParams();
  if (input.kind === 'packages') params.set('dependent_type', 'PACKAGE');
  if (input.packageId) params.set('package_id', input.packageId);
  if (input.cursor) params.set('dependents_after', input.cursor);
  const qs = params.toString();
  const url = `https://github.com/${owner}/${name}/network/dependents${qs ? `?${qs}` : ''}`;

  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Only throw on actual 404, not on funky redirects.
    if (resp && resp.status() === 404) {
      throw new Error(`Dependents not available for ${input.repo} (404).`);
    }
    await page.waitForFunction(
      () => !!document.querySelector('.Box-row, [class*="Box-row"], [data-octo-click="dependents_link"]'),
      { timeout: 20000 },
    ).catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }

      // Totals: "X Repositories  Y Packages"
      let totalRepositories: number | null = null;
      let totalPackages: number | null = null;
      const bodyTxt = document.body.innerText || '';
      const rm = bodyTxt.match(/([\d,]+)\s+Repositor(?:y|ies)/i);
      if (rm) totalRepositories = parseInt(rm[1].replace(/,/g, ''), 10);
      const pm = bodyTxt.match(/([\d,]+)\s+Packages?/i);
      if (pm) totalPackages = parseInt(pm[1].replace(/,/g, ''), 10);

      // Each dependent is a .Box-row containing two links: owner and repo.
      const rows = document.querySelectorAll('.Box-row, [class*="Box-row"]');
      const out: any[] = [];
      const seen = new Set<string>();
      rows.forEach((row) => {
        // Two consecutive links: /owner and /owner/repo
        const links = Array.from(row.querySelectorAll('a[href^="/"]')) as HTMLAnchorElement[];
        let ownerLogin = '';
        let repoName = '';
        for (const a of links) {
          const h = a.getAttribute('href') || '';
          const m2 = h.match(/^\/([^/?#]+)\/([^/?#]+)$/);
          if (m2 && !ownerLogin) {
            ownerLogin = m2[1];
            repoName = m2[2];
            break;
          }
        }
        if (!ownerLogin || !repoName) return;
        const repoKey = `${ownerLogin}/${repoName}`;
        if (seen.has(repoKey)) return;
        seen.add(repoKey);

        const rowTxt = (row as HTMLElement).innerText || '';
        // The row format is typically "owner / repo  STARS  FORKS"
        // STARS and FORKS appear as numbers near octicons.
        const nums = rowTxt.match(/(\d[\d,.]*)/g) || [];
        // Heuristic: drop empty / "0" leading entries from owner/repo themselves; take the last two numbers as stars+forks
        const tail = nums.filter((n) => n).slice(-2).map((n) => parseInt(n.replace(/,/g, ''), 10));
        const stars = tail.length > 0 ? tail[0] : null;
        const forks = tail.length > 1 ? tail[1] : null;

        out.push({ repository: repoKey, url: `https://github.com/${repoKey}`, stars, forks });
      });

      // Cursors
      const nextBtn = document.querySelector('a[href*="dependents_after"]') as HTMLAnchorElement | null;
      const prevBtn = document.querySelector('a[href*="dependents_before"]') as HTMLAnchorElement | null;
      function getParam(el: HTMLAnchorElement | null, key: string): string | null {
        if (!el) return null;
        const href = el.getAttribute('href') || '';
        return new URLSearchParams(href.split('?')[1] || '').get(key);
      }

      return {
        totalRepositories, totalPackages,
        dependents: out,
        nextCursor: getParam(nextBtn, 'dependents_after'),
        prevCursor: getParam(prevBtn, 'dependents_before'),
      };
    });

    return { repository: `${owner}/${name}`, kind: input.kind, url, ...data };
  });
}
