import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const getPullRequestShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  number: z.number().int().positive(),
  includeComments: z.boolean().default(true),
  maxComments: z.number().int().min(0).max(200).default(50),
};
export const getPullRequestSchema = z.object(getPullRequestShape);
export type GetPullRequestInput = z.infer<typeof getPullRequestSchema>;

export async function getPullRequest(input: GetPullRequestInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}/pull/${input.number}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`PR #${input.number} not found in ${input.repo}.`);
    await page.waitForFunction(
      () => !!document.querySelector('main h1, [class*="StateLabel"], .markdown-body'),
      { timeout: 20000 },
    ).catch(() => {});

    const data = await page.evaluate((opts) => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      function md(el: Element | null) { return (el as HTMLElement | null)?.innerText?.trim() ?? ''; }

      // Title
      let title = '';
      const h1 = document.querySelector('main h1') as HTMLElement | null;
      if (h1) title = (h1.innerText || '').trim().replace(/\s*#\d+\s*$/, '').trim();

      // State
      let state = 'unknown';
      const stateLabels = Array.from(document.querySelectorAll('[class*="StateLabel"]'));
      for (const sl of stateLabels) {
        const t = txt(sl).toLowerCase();
        if (/^(open|closed|merged|draft)$/.test(t)) { state = t; break; }
      }

      const firstComment = document.querySelector('[class*="TimelineItem"] [class*="Comment-module"], .timeline-comment, [data-testid="comment"]');
      const authorEl = (firstComment ?? document).querySelector('a.author, a[data-hovercard-type="user"]') as HTMLAnchorElement | null;
      const author = authorEl ? txt(authorEl) || null : null;

      let createdAt: string | null = null;
      const firstTime = (firstComment ?? document).querySelector('relative-time, time');
      if (firstTime) createdAt = firstTime.getAttribute('datetime');

      const bodyEl = (firstComment ?? document).querySelector('.comment-body, .markdown-body, [data-testid="comment-body"], .markdown-content');
      const body = md(bodyEl);

      // Base/head branches: spans with class containing "commit-ref" or "BranchName"
      const branchEls = Array.from(document.querySelectorAll('.commit-ref, [class*="commit-ref"], [class*="BranchName"], [class*="head-ref"]'));
      const branchTexts = branchEls.map((b) => txt(b)).filter((t) => t && t.length < 200);
      const baseBranch = branchTexts[0] ?? null;
      const headBranch = branchTexts[1] ?? null;

      const isMerged = state === 'merged';
      const isDraft = state === 'draft';

      // Checks
      let checks: { passed: number | null; failed: number | null; pending: number | null; raw: string | null } = {
        passed: null, failed: null, pending: null, raw: null,
      };
      const bodyTxt = (document.body.innerText || '').slice(0, 8000);
      const allRaw = bodyTxt;
      const p = allRaw.match(/(\d+)\s+(?:successful|passed|checks? passed)/i);
      const f = allRaw.match(/(\d+)\s+(?:failed|failing|errored|errors?)/i);
      const w = allRaw.match(/(\d+)\s+(?:pending|in progress|queued|skipped)/i);
      checks.passed = p ? parseInt(p[1], 10) : null;
      checks.failed = f ? parseInt(f[1], 10) : null;
      checks.pending = w ? parseInt(w[1], 10) : null;
      if (p || f || w) checks.raw = [p?.[0], f?.[0], w?.[0]].filter(Boolean).join(' · ');

      // Reviewers
      const reviewers = Array.from(document.querySelectorAll('aside a[data-hovercard-type="user"], .js-issue-sidebar-form a[data-hovercard-type="user"]'))
        .map((a) => txt(a)).filter(Boolean);

      const labels = Array.from(document.querySelectorAll('a[href*="/labels/"]'))
        .map((l) => txt(l)).filter((t) => t && t.length < 60);

      const comments: any[] = [];
      if (opts.includeComments) {
        const commentEls = Array.from(document.querySelectorAll('[class*="TimelineItem"] [class*="Comment-module"], .timeline-comment, [data-testid="comment"]'));
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

      return {
        title, state, author, createdAt, body,
        baseBranch, headBranch, isMerged, isDraft,
        checks,
        reviewers: Array.from(new Set(reviewers)),
        labels: Array.from(new Set(labels)),
        comments,
      };
    }, { includeComments: input.includeComments, maxComments: input.maxComments });

    return { repository: `${owner}/${name}`, number: input.number, url, ...data };
  });
}
