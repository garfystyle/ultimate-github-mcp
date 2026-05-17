import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const getFileHistoryShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  path: z.string().describe('File path inside the repo.'),
  ref: z.string().default('HEAD').describe('Branch / tag / SHA.'),
  page: z.number().int().min(1).max(100).default(1),
};
export const getFileHistorySchema = z.object(getFileHistoryShape);
export type GetFileHistoryInput = z.infer<typeof getFileHistorySchema>;

export async function getFileHistory(input: GetFileHistoryInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const cleanPath = input.path.replace(/^\/+/, '');
  const url = `https://github.com/${owner}/${name}/commits/${input.ref}/${cleanPath}?page=${input.page}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`File "${cleanPath}" at ${input.ref} not found in ${input.repo}.`);

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const commits: any[] = [];
      // Modern UI uses [data-testid="commit-row-item"], older uses li.Box-row.
      const rows = document.querySelectorAll(
        '[data-testid="commit-row-item"], li.Box-row, .TimelineItem',
      );
      const seen = new Set<string>();
      rows.forEach((row) => {
        const link = row.querySelector('a[href*="/commit/"]') as HTMLAnchorElement | null;
        if (!link) return;
        const m = (link.getAttribute('href') || '').match(/\/commit\/([a-f0-9]{7,40})/);
        if (!m) return;
        const sha = m[1];
        if (seen.has(sha)) return;
        seen.add(sha);
        const author = (() => {
          const a = row.querySelector('a[data-hovercard-type="user"], a.commit-author') as HTMLAnchorElement | null;
          return a ? txt(a) || null : null;
        })();
        const time = row.querySelector('relative-time, time');
        const date = time?.getAttribute('datetime') ?? null;
        commits.push({
          sha,
          message: txt(link),
          url: 'https://github.com' + (link.getAttribute('href') || ''),
          author,
          date,
        });
      });
      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { commits, hasNextPage };
    });

    return { repository: `${owner}/${name}`, path: cleanPath, ref: input.ref, page: input.page, url, ...data };
  });
}
