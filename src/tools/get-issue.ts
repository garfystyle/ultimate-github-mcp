import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const getIssueShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  number: z.number().int().positive(),
  includeComments: z.boolean().default(true),
  maxComments: z.number().int().min(0).max(200).default(50),
};
export const getIssueSchema = z.object(getIssueShape);
export type GetIssueInput = z.infer<typeof getIssueSchema>;

export async function getIssue(input: GetIssueInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}/issues/${input.number}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`Issue #${input.number} not found in ${input.repo}.`);
    await page.waitForFunction(
      () => !!document.querySelector('main h1, [class*="StateLabel"], .markdown-body'),
      { timeout: 20000 },
    ).catch(() => {});

    const data = await page.evaluate((opts) => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      function md(el: Element | null) { return (el as HTMLElement | null)?.innerText?.trim() ?? ''; }

      // Title — main h1 contains "Title text#NUMBER".
      let title = '';
      const h1 = document.querySelector('main h1') as HTMLElement | null;
      if (h1) {
        const full = (h1.innerText || '').trim();
        // Strip trailing "#NUMBER" anywhere it appears at the end.
        title = full.replace(/\s*#\d+\s*$/, '').trim();
      }

      // State — look for the StateLabel/PRStateLabel.
      let state = 'unknown';
      const stateLabels = Array.from(document.querySelectorAll('[class*="StateLabel"]'));
      for (const sl of stateLabels) {
        const t = txt(sl).toLowerCase();
        if (/^(open|closed|merged|draft)$/.test(t)) { state = t; break; }
      }
      if (state === 'unknown') {
        const aria = document.querySelector('main [aria-label*="Status:" i]');
        if (aria) {
          const t = (aria.getAttribute('aria-label') || '').toLowerCase();
          if (/open/.test(t)) state = 'open';
          else if (/closed/.test(t)) state = 'closed';
        }
      }

      // Author of first comment (the issue opener)
      const firstComment = document.querySelector('[class*="TimelineItem"] [class*="Comment-module"], .timeline-comment, [data-testid="comment"]');
      const authorEl = (firstComment ?? document).querySelector('a.author, a[data-hovercard-type="user"]') as HTMLAnchorElement | null;
      const author = authorEl ? txt(authorEl) || null : null;

      // CreatedAt — datetime on the first relative-time inside the first comment header (not the action bar).
      let createdAt: string | null = null;
      const firstTime = (firstComment ?? document).querySelector('relative-time, time');
      if (firstTime) createdAt = firstTime.getAttribute('datetime');

      // Body — the body of the first comment (issue/PR description).
      const bodyEl = (firstComment ?? document).querySelector('.comment-body, .markdown-body, [data-testid="comment-body"], .markdown-content');
      const body = md(bodyEl);

      // Labels: sidebar links to /labels/
      const labels = Array.from(document.querySelectorAll('a[href*="/labels/"]'))
        .map((l) => txt(l))
        .filter((t) => t && t.length < 60 && t.length > 0);

      // Assignees — sidebar
      const assignees = Array.from(document.querySelectorAll('.js-issue-sidebar-form a.assignee, aside a[data-hovercard-type="user"]'))
        .map((a) => txt(a)).filter(Boolean);

      // Comments
      const comments: any[] = [];
      if (opts.includeComments) {
        const commentEls = Array.from(document.querySelectorAll('[class*="TimelineItem"] [class*="Comment-module"], .timeline-comment, [data-testid="comment"]'));
        // Skip first (it's the body)
        for (let i = 1; i < commentEls.length && comments.length < opts.maxComments; i++) {
          const c = commentEls[i];
          const ca = c.querySelector('a.author, a[data-hovercard-type="user"]') as HTMLAnchorElement | null;
          const ct = c.querySelector('relative-time, time');
          const cb = c.querySelector('.comment-body, .markdown-body, [data-testid="comment-body"]');
          const body2 = md(cb);
          if (!ca && !body2) continue;
          comments.push({
            author: ca ? txt(ca) || null : null,
            date: ct?.getAttribute('datetime') ?? null,
            body: body2,
          });
        }
      }

      return { title, state, author, createdAt, body, labels: Array.from(new Set(labels)), assignees: Array.from(new Set(assignees)), comments };
    }, { includeComments: input.includeComments, maxComments: input.maxComments });

    return { repository: `${owner}/${name}`, number: input.number, url, ...data };
  });
}
