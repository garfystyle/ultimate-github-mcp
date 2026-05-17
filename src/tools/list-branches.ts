import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const listBranchesShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  filter: z.string().default('').describe('Substring filter on branch name (server-side).'),
  page: z.number().int().min(1).max(100).default(1),
};
export const listBranchesSchema = z.object(listBranchesShape);
export type ListBranchesInput = z.infer<typeof listBranchesSchema>;

export async function listBranches(input: ListBranchesInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const qs = new URLSearchParams();
  if (input.filter) qs.set('query', input.filter);
  qs.set('page', String(input.page));
  const url = `https://github.com/${owner}/${name}/branches/all?${qs.toString()}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`Repo ${input.repo} not found.`);
    // Wait for branch names AND for the metadata cells (relative-time, user link) to populate — they load asynchronously.
    await page.waitForFunction(
      () => {
        const hasTime = !!document.querySelector('tr.TableRow relative-time, tr.TableRow time');
        const hasUser = !!document.querySelector('tr.TableRow a[class*="UserLink"], tr.TableRow a[data-hovercard-type="user"]');
        const hasTree = !!document.querySelector('tr.TableRow a[href*="/tree/"]');
        return hasTree && (hasTime || hasUser);
      },
      { timeout: 25000 },
    ).catch(() => {});

    const branches = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const out: any[] = [];
      const rows = document.querySelectorAll('tr.TableRow, tr[class*="TableRow"], [data-testid="row"]');
      rows.forEach((row) => {
        const a = row.querySelector('a[href*="/tree/"]') as HTMLAnchorElement | null;
        if (!a) return;
        const m = (a.getAttribute('href') || '').match(/\/tree\/(.+?)(?:[?#]|$)/);
        if (!m) return;
        const branchName = decodeURIComponent(m[1]);

        // Updated by
        const userLink = row.querySelector('a[href^="/"][class*="UserLink"], a[data-hovercard-type="user"]') as HTMLAnchorElement | null;
        const updatedBy = userLink ? txt(userLink) || null : null;

        // Date
        const time = row.querySelector('relative-time, time');
        const date = time?.getAttribute('datetime') ?? null;

        // Last commit SHA
        const commitLink = row.querySelector('a[href*="/commit/"]') as HTMLAnchorElement | null;
        const sha = commitLink
          ? (commitLink.getAttribute('href') || '').match(/\/commit\/([a-f0-9]{7,40})/)?.[1] ?? null
          : null;
        const lastCommitMessage = commitLink ? txt(commitLink) || null : null;

        // Ahead / behind: text like "1 commit ahead" or "behind".
        const rowTxt = (row as HTMLElement).innerText || '';
        const ahead = rowTxt.match(/(\d+)\s+ahead/i);
        const behind = rowTxt.match(/(\d+)\s+behind/i);

        out.push({
          name: branchName,
          updatedBy,
          lastCommitDate: date,
          lastCommitSha: sha,
          lastCommitMessage,
          ahead: ahead ? parseInt(ahead[1], 10) : null,
          behind: behind ? parseInt(behind[1], 10) : null,
          url: 'https://github.com' + (a.getAttribute('href') || ''),
        });
      });
      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { branches: out, hasNextPage };
    });
    return { repository: `${owner}/${name}`, page: input.page, url, ...branches };
  });
}
