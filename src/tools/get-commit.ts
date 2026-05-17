import { z } from 'zod';
import { ensureLoggedIn } from '../auth.js';
import { fetchText } from '../scrape.js';
import { withPage } from '../browser.js';
import { parseRepoRef } from '../util.js';

export const getCommitShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  sha: z.string().describe('Commit SHA (full or short).'),
  includeDiff: z.boolean().default(true).describe('Include raw unified diff content.'),
  maxDiffBytes: z.number().int().min(1024).max(5_000_000).default(300_000),
};
export const getCommitSchema = z.object(getCommitShape);
export type GetCommitInput = z.infer<typeof getCommitSchema>;

export async function getCommit(input: GetCommitInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);

  // The input.sha can be a tag/branch/short-SHA — load the page to canonicalize.
  const metaUrl = `https://github.com/${owner}/${name}/commit/${input.sha}`;
  const meta = await withPage(async (page) => {
    const resp = await page.goto(metaUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`Commit ${input.sha} not found in ${input.repo}.`);
    return page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      // Resolve full SHA from URL (after any tag/branch redirect)
      const m = window.location.pathname.match(/\/commit\/([a-f0-9]{7,40})/);
      const resolvedSha = m ? m[1] : null;

      // Title: first <h1> or the commit-title element. Newer UI uses h1 with the message.
      const titleEl = document.querySelector('main h1, .commit-title, [data-testid="commit-title"]');
      const title = titleEl ? (titleEl as HTMLElement).innerText.trim() || null : null;

      // Description (commit message body).
      const descEl = document.querySelector('.commit-desc pre, [data-testid="commit-desc"] pre');
      const desc = descEl ? (descEl as HTMLElement).innerText.trim() || null : null;

      // Author (link to user)
      const authorEl = document.querySelector('a.commit-author, a[data-hovercard-type="user"]') as HTMLAnchorElement | null;
      const author = authorEl ? txt(authorEl) || null : null;

      // Date
      const time = document.querySelector('relative-time, time');
      const date = time?.getAttribute('datetime') ?? null;

      // Parents (other commits linked on this page)
      const parents = Array.from(document.querySelectorAll('a[href*="/commit/"]'))
        .map((a) => (a.getAttribute('href') || '').match(/\/commit\/([a-f0-9]{7,40})/)?.[1])
        .filter((x): x is string => !!x && x !== resolvedSha);

      // Stats: e.g. "1 changed file +3 -1"
      const bodyTxt = document.body.innerText || '';
      const statsMatch = bodyTxt.match(/(\d+\s+changed\s+files?[^\n]+)/i);
      const statsText = statsMatch ? statsMatch[1].trim() : null;

      return { resolvedSha, title, desc, author, date, parents: Array.from(new Set(parents)), statsText };
    });
  });

  const sha = meta.resolvedSha ?? input.sha;

  // Diff via .diff URL — uses the resolved SHA.
  let diff: { bytes: number; truncated: boolean; content: string } | null = null;
  if (input.includeDiff) {
    const diffUrl = `https://github.com/${owner}/${name}/commit/${sha}.diff`;
    const r = await fetchText(diffUrl);
    if (r.ok) {
      const truncated = r.text.length > input.maxDiffBytes;
      diff = {
        bytes: r.text.length,
        truncated,
        content: truncated ? r.text.slice(0, input.maxDiffBytes) : r.text,
      };
    }
  }

  return {
    repository: `${owner}/${name}`,
    sha,
    inputRef: input.sha === sha ? undefined : input.sha,
    url: `https://github.com/${owner}/${name}/commit/${sha}`,
    title: meta.title,
    description: meta.desc,
    author: meta.author,
    date: meta.date,
    parents: meta.parents,
    stats: meta.statsText,
    diff,
  };
}
