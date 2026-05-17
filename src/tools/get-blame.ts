import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const getBlameShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  path: z.string().describe('File path inside the repo.'),
  ref: z.string().default('HEAD'),
  startLine: z.number().int().min(1).default(1),
  endLine: z.number().int().min(1).max(50_000).default(200),
};
export const getBlameSchema = z.object(getBlameShape);
export type GetBlameInput = z.infer<typeof getBlameSchema>;

export async function getBlame(input: GetBlameInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const cleanPath = input.path.replace(/^\/+/, '');
  const url = `https://github.com/${owner}/${name}/blame/${input.ref}/${cleanPath}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() === 404) throw new Error(`Blame not available for "${cleanPath}" at ref "${input.ref}".`);
    await page
      .waitForFunction(() => !!document.querySelector('.blame-hunk, [data-testid="blame-hunk"], .react-blame-hunk'), { timeout: 20000 })
      .catch(() => {});

    const lines = await page.evaluate((range) => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const out: any[] = [];
      // Each blame hunk contains commit info + multiple code lines that share that commit.
      const hunks = document.querySelectorAll('.blame-hunk, [data-testid="blame-hunk"], .react-blame-hunk');
      for (const hunk of Array.from(hunks)) {
        const commitLink = hunk.querySelector('a[href*="/commit/"]') as HTMLAnchorElement | null;
        const sha = commitLink ? (commitLink.getAttribute('href') || '').match(/\/commit\/([a-f0-9]{7,40})/)?.[1] ?? null : null;
        const message = commitLink ? txt(commitLink) : null;
        const author = txt(hunk.querySelector('.blame-commit-meta a, .react-blame-meta a'));
        const time = hunk.querySelector('relative-time, time');
        const date = time?.getAttribute('datetime') ?? null;
        const codeRows = hunk.querySelectorAll('.js-file-line, .blob-code-inner, [data-line-number]');
        codeRows.forEach((row) => {
          const lineNumber = parseInt(row.getAttribute('data-line-number') || '', 10);
          if (isNaN(lineNumber)) return;
          if (lineNumber < range.startLine || lineNumber > range.endLine) return;
          out.push({
            line: lineNumber,
            code: (row as HTMLElement).innerText ?? '',
            sha,
            author: author || null,
            date,
            message,
          });
        });
      }
      out.sort((a, b) => a.line - b.line);
      return out;
    }, { startLine: input.startLine, endLine: input.endLine });

    return { repository: `${owner}/${name}`, path: cleanPath, ref: input.ref, url, range: { startLine: input.startLine, endLine: input.endLine }, lines };
  });
}
