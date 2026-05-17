import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const listPrReviewCommentsShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  number: z.number().int().positive(),
  maxComments: z.number().int().min(1).max(500).default(100),
};
export const listPrReviewCommentsSchema = z.object(listPrReviewCommentsShape);
export type ListPrReviewCommentsInput = z.infer<typeof listPrReviewCommentsSchema>;

export async function listPrReviewComments(input: ListPrReviewCommentsInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}/pull/${input.number}/files`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() === 404) throw new Error(`PR #${input.number} not found in ${input.repo}.`);
    await page.waitForFunction(
      () => !!document.querySelector('[id^="diff-"], .review-comment, .js-comment'),
      { timeout: 20000 },
    ).catch(() => {});

    const data = await page.evaluate((max) => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      function md(el: Element | null) { return (el as HTMLElement | null)?.innerText?.trim() ?? ''; }
      const out: any[] = [];
      // Review comments live inside inline comment thread blocks within the file diff.
      const threads = document.querySelectorAll('.js-inline-comments-container, .inline-comments, .review-thread-component, [data-resolved], .js-review-thread');
      threads.forEach((thread) => {
        // Determine file path of the enclosing diff
        const diff = thread.closest('[id^="diff-"]') as HTMLElement | null;
        let filePath: string | null = null;
        if (diff) {
          const pathLink = document.querySelector(`a[href="#${diff.id}"]`);
          if (pathLink) filePath = (pathLink as HTMLElement).innerText.trim().replace(/^[‎]+|[‎]+$/g, '');
        }
        const items = thread.querySelectorAll('.review-comment, .js-comment, [data-testid="comment"]');
        items.forEach((c) => {
          if (out.length >= max) return;
          const author = (c.querySelector('a.author, a[data-hovercard-type="user"]') as HTMLAnchorElement | null);
          const time = c.querySelector('relative-time, time');
          const body = c.querySelector('.comment-body, .markdown-body, [data-testid="comment-body"]');
          const lineMeta = txt(c.querySelector('.review-comment-contents-meta, .js-line-number, [data-testid="line-meta"]')) || null;
          out.push({
            filePath,
            author: author ? txt(author) || null : null,
            date: time?.getAttribute('datetime') ?? null,
            body: md(body),
            lineMeta,
          });
        });
      });
      return { comments: out };
    }, input.maxComments);

    return { repository: `${owner}/${name}`, number: input.number, url, ...data };
  });
}
