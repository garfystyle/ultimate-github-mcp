import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef, parseCount } from '../util.js';

export const getRepoShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
};
export const getRepoSchema = z.object(getRepoShape);
export type GetRepoInput = z.infer<typeof getRepoSchema>;

export interface RepoInfo {
  repository: string;
  url: string;
  description: string | null;
  defaultBranch: string | null;
  isArchived: boolean;
  isFork: boolean;
  isPrivate: boolean;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  openIssues: number | null;
  openPullRequests: number | null;
  topics: string[];
  languages: Array<{ name: string; percent: number | null }>;
  license: string | null;
  homepage: string | null;
  latestRelease: { tag: string | null; url: string | null } | null;
  lastCommit: {
    sha: string | null;
    date: string | null;
    message: string | null;
    url: string | null;
  } | null;
}

export async function getRepo(input: GetRepoInput): Promise<RepoInfo> {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}`;

  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) {
      throw new Error(`Repository "${input.repo}" not found (404).`);
    }

    const info = await page.evaluate(() => {
      function txt(el: Element | null): string {
        return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      }
      function attr(el: Element | null, k: string): string | null {
        return el?.getAttribute(k) ?? null;
      }

      // Description from About panel or meta.
      const aboutP = document.querySelector('.BorderGrid-cell p.f4, [class*="About"] p, p.f4.my-3');
      const description =
        txt(aboutP) ||
        attr(document.querySelector('meta[name="description"]'), 'content') ||
        null;

      // Default branch: from the branch button or data attr.
      const branchEl =
        document.querySelector(
          '#branch-picker-repos-header-ref-selector .prc-Button-Label-pTQ3x, ' +
            'summary[data-hotkey="w"] span, ' +
            'button[data-component="branch-picker"] span',
        ) ||
        document.querySelector('[data-default-branch]');
      let defaultBranch: string | null =
        attr(document.querySelector('[data-default-branch]'), 'data-default-branch') ||
        (branchEl ? txt(branchEl) : null);
      if (defaultBranch && !/^[\w.\-/]+$/.test(defaultBranch)) defaultBranch = null;

      const bodyText = document.body.innerText || '';
      const isArchived =
        !!document.querySelector('[data-testid="archived-banner"]') ||
        /This repository has been archived/i.test(bodyText);
      const isFork = /forked from\s+[\w./-]+/i.test(bodyText);
      const isPrivate = !!document.querySelector('header [aria-label="Private"]');

      // Stable counters by ID.
      function exactCount(id: string): number | null {
        const el = document.getElementById(id);
        if (!el) return null;
        const title = el.getAttribute('title');
        if (title) {
          const m = title.replace(/,/g, '').match(/\d+/);
          if (m) return parseInt(m[0], 10);
        }
        return null;
      }
      function counterText(id: string): string | null {
        const el = document.getElementById(id);
        return el ? (el.textContent || '').trim() || null : null;
      }

      const starsExact = exactCount('repo-stars-counter-star');
      const starsText = counterText('repo-stars-counter-star');
      const forksExact = exactCount('repo-network-counter');
      const forksText = counterText('repo-network-counter');

      // Watchers: try header counter, else sidebar link.
      const watchersHeader = document.getElementById('repo-notifications-counter');
      const watchersText = watchersHeader ? (watchersHeader.textContent || '').trim() : null;
      // Sidebar "Watchers" link
      let watchersExact: number | null = null;
      if (!watchersText) {
        const wLink = document.querySelector(
          'a[href$="/watchers"]',
        ) as HTMLAnchorElement | null;
        if (wLink) {
          const m = (wLink.textContent || '').replace(/\s+/g, ' ').match(/([\d,]+)/);
          if (m) watchersExact = parseInt(m[1].replace(/,/g, ''), 10);
        }
      }

      const issuesEl = document.getElementById('issues-repo-tab-count');
      const prsEl = document.getElementById('pull-requests-repo-tab-count');
      function tabCount(el: Element | null): number | null {
        if (!el) return null;
        const titleAttr = el.getAttribute('title');
        if (titleAttr) {
          const m = titleAttr.replace(/,/g, '').match(/\d+/);
          if (m) return parseInt(m[0], 10);
        }
        const t = (el.textContent || '').replace(/\s+/g, '');
        const v = parseInt(t.replace(/[^\d]/g, ''), 10);
        return isNaN(v) ? null : v;
      }
      const openIssues = tabCount(issuesEl);
      const openPullRequests = tabCount(prsEl);

      // Topics
      const topics = Array.from(document.querySelectorAll('a[href*="/topics/"]'))
        .map((a) => (a.textContent || '').trim())
        .filter(Boolean);

      // Languages
      const langs: Array<{ name: string; percent: number | null }> = [];
      const langLinks = document.querySelectorAll('a[href*="/search?l="]');
      const seenLang = new Set<string>();
      langLinks.forEach((a) => {
        const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
        // The link text is typically "TypeScript 92.1%"
        const m = t.match(/^([A-Za-z0-9 +#.\-/]+?)(?:\s+([\d.]+)%)?$/);
        if (!m) return;
        const langName = m[1].trim();
        if (!langName || seenLang.has(langName)) return;
        seenLang.add(langName);
        langs.push({ name: langName, percent: m[2] ? parseFloat(m[2]) : null });
      });

      // License: link in sidebar/About.
      let license: string | null = null;
      const licenseEl =
        document.querySelector('a[href*="/blob/"][href$="/LICENSE"]') ||
        document.querySelector('a[href*="LICENSE" i]');
      if (licenseEl) {
        const t = (licenseEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 80) license = t;
      }

      // Homepage: the About panel has an external link with an octicon-link-external.
      let homepage: string | null = null;
      const homepageEl = document.querySelector(
        '.BorderGrid-cell a[href^="http"]:not([href*="github.com"])',
      ) as HTMLAnchorElement | null;
      if (homepageEl) homepage = homepageEl.href;

      // Latest release
      let latestRelease: { tag: string | null; url: string | null } | null = null;
      const releaseEl = document.querySelector(
        'a[href*="/releases/tag/"]',
      ) as HTMLAnchorElement | null;
      if (releaseEl) {
        const tagMatch = (releaseEl.getAttribute('href') || '').match(/\/releases\/tag\/(.+?)$/);
        const tag = tagMatch ? decodeURIComponent(tagMatch[1]) : (releaseEl.textContent || '').trim();
        latestRelease = { tag: tag || null, url: releaseEl.href };
      }

      // Last commit: stable testid container.
      let lastCommit: {
        sha: string | null;
        date: string | null;
        message: string | null;
        url: string | null;
      } | null = null;
      const commitContainer = document.querySelector('[data-testid="latest-commit-html"]');
      if (commitContainer) {
        // The main commit message link
        const commitA = commitContainer.querySelector(
          'a[href*="/commit/"]',
        ) as HTMLAnchorElement | null;
        const sha = commitA
          ? (commitA.getAttribute('href') || '').match(/\/commit\/([a-f0-9]{7,40})/)?.[1] ?? null
          : null;
        // Combine the title pieces into one message
        const message = (commitContainer.textContent || '').replace(/\s+/g, ' ').trim() || null;
        // Find a related time element nearby (usually adjacent .ml-2)
        let date: string | null = null;
        const row = commitContainer.closest('[class*="react-directory-row"], div, section');
        const rt =
          (row?.querySelector('relative-time') as HTMLElement | null) ||
          (document.querySelector('relative-time') as HTMLElement | null);
        if (rt) {
          date = rt.getAttribute('datetime') || rt.getAttribute('title') || (rt.textContent || '').trim() || null;
        }
        lastCommit = {
          sha,
          date,
          message,
          url: commitA ? 'https://github.com' + (commitA.getAttribute('href') || '') : null,
        };
      }

      return {
        description,
        defaultBranch,
        isArchived,
        isFork,
        isPrivate,
        starsExact,
        starsText,
        forksExact,
        forksText,
        watchersExact,
        watchersText,
        openIssues,
        openPullRequests,
        topics,
        langs,
        license,
        homepage,
        latestRelease,
        lastCommit,
      };
    });

    return {
      repository: `${owner}/${name}`,
      url,
      description: info.description,
      defaultBranch: info.defaultBranch,
      isArchived: info.isArchived,
      isFork: info.isFork,
      isPrivate: info.isPrivate,
      stars: info.starsExact ?? parseCount(info.starsText),
      forks: info.forksExact ?? parseCount(info.forksText),
      watchers: info.watchersExact ?? parseCount(info.watchersText),
      openIssues: info.openIssues,
      openPullRequests: info.openPullRequests,
      topics: info.topics,
      languages: info.langs,
      license: info.license,
      homepage: info.homepage,
      latestRelease: info.latestRelease,
      lastCommit: info.lastCommit,
    };
  });
}
