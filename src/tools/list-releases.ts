import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const listReleasesShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  page: z.number().int().min(1).max(100).default(1),
};
export const listReleasesSchema = z.object(listReleasesShape);
export type ListReleasesInput = z.infer<typeof listReleasesSchema>;

export async function listReleases(input: ListReleasesInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}/releases?page=${input.page}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`Repo ${input.repo} not found.`);
    await page.waitForFunction(
      () => !!document.querySelector('a[href*="/releases/tag/"], [data-testid="release-card"], section[aria-labelledby]'),
      { timeout: 20000 },
    ).catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const out: any[] = [];

      // Modern layout: each release is a <section aria-labelledby="hd-..."> with all the metadata inside.
      const sections = document.querySelectorAll(
        'section[aria-labelledby^="hd-"], [data-test-selector="release-card"], section.release, .release-entry',
      );
      const seen = new Set<string>();
      sections.forEach((sec) => {
        const tagLink = sec.querySelector('a[href*="/releases/tag/"]') as HTMLAnchorElement | null;
        if (!tagLink) return;
        const tagMatch = (tagLink.getAttribute('href') || '').match(/\/releases\/tag\/(.+?)(?:[?#]|$)/);
        const tag = tagMatch ? decodeURIComponent(tagMatch[1]) : null;
        if (!tag || seen.has(tag)) return;
        seen.add(tag);

        // Release title: the section's h2 (often sr-only) holds the version/title.
        const h2 = sec.querySelector('h2[id^="hd-"], h2, h1, .Box-title');
        let title = h2 ? txt(h2) : null;
        if (title === tag) title = null; // dedupe with tag
        if (title && /^choose a tag/i.test(title)) title = null;

        // Date: <relative-time datetime=...>
        const time = sec.querySelector('relative-time, time');
        const date = time?.getAttribute('datetime') ?? null;

        // Author: hovercard user link.
        const authorEl = sec.querySelector('a[data-hovercard-type="user"]') as HTMLAnchorElement | null;
        const author = authorEl ? txt(authorEl) || null : null;

        // Commit SHA: link to /commit/SHA.
        const commitLink = sec.querySelector('a[href*="/commit/"]') as HTMLAnchorElement | null;
        const commitSha = commitLink
          ? (commitLink.getAttribute('href') || '').match(/\/commit\/([a-f0-9]{7,40})/)?.[1] ?? null
          : null;

        // Labels (Latest / Pre-release)
        const labelText = txt(sec.querySelector('[class*="Label"]')) || '';
        const isLatest = /latest/i.test(labelText) || !!sec.querySelector('span:has(svg.octicon-star)');
        const isPrerelease = /pre.?release/i.test(labelText);

        // Body: markdown content of the release notes.
        const bodyEl = sec.querySelector('.markdown-body, [data-testid="release-body"]');
        const body = (bodyEl as HTMLElement | null)?.innerText?.trim().slice(0, 4000) ?? null;

        // Assets
        const assets = Array.from(sec.querySelectorAll('a[href*="/releases/download/"]')).map((a) => ({
          name: txt(a) || null,
          url: 'https://github.com' + ((a as HTMLAnchorElement).getAttribute('href') || ''),
        }));

        out.push({ tag, title, date, author, commitSha, isLatest, isPrerelease, body, assets });
      });

      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { releases: out, hasNextPage };
    });

    return { repository: `${owner}/${name}`, page: input.page, url, ...data };
  });
}
