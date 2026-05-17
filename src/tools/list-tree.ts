import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const listTreeShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  path: z.string().default('').describe('Directory path inside the repo. Empty string = root.'),
  ref: z.string().default('HEAD').describe('Branch, tag, or commit SHA. Defaults to HEAD.'),
};
export const listTreeSchema = z.object(listTreeShape);
export type ListTreeInput = z.infer<typeof listTreeSchema>;

export interface TreeEntry {
  name: string;
  type: 'file' | 'dir' | 'submodule' | 'symlink' | 'unknown';
  path: string;
  url: string;
}

export interface ListTreeResult {
  repository: string;
  ref: string;
  path: string;
  url: string;
  entries: TreeEntry[];
}

export async function listTree(input: ListTreeInput): Promise<ListTreeResult> {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const cleanPath = input.path.replace(/^\/+|\/+$/g, '');
  const url = cleanPath
    ? `https://github.com/${owner}/${name}/tree/${input.ref}/${cleanPath}`
    : `https://github.com/${owner}/${name}/tree/${input.ref}`;

  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) {
      throw new Error(`Path "${cleanPath}" at ref "${input.ref}" not found in ${input.repo}.`);
    }

    await page
      .waitForFunction(
        () => {
          if (document.querySelector('table[aria-labelledby*="files" i], [role="grid"] [role="row"]')) return true;
          if (document.querySelector('a[aria-label*="(File)" i], a[aria-label*="(Directory)" i]')) return true;
          return false;
        },
        { timeout: 15000 },
      )
      .catch(() => {});

    const entries = await page.evaluate(() => {
      const out: Array<{ name: string; type: string; path: string; href: string }> = [];

      // Newer file browser uses role=row entries with svg icon (file/folder/submodule)
      const rows = document.querySelectorAll('[role="row"]');
      rows.forEach((row) => {
        const link = row.querySelector('a[href*="/blob/"], a[href*="/tree/"]') as HTMLAnchorElement | null;
        if (!link) return;
        const href = link.getAttribute('href') || '';
        const isDir = /\/tree\//.test(href);
        const isFile = /\/blob\//.test(href);
        if (!isDir && !isFile) return;
        const aria = link.getAttribute('aria-label') || '';
        let type = 'unknown';
        if (/submodule/i.test(aria)) type = 'submodule';
        else if (/symlink/i.test(aria)) type = 'symlink';
        else if (isDir) type = 'dir';
        else if (isFile) type = 'file';
        const name = (link.textContent || '').trim();
        if (!name) return;
        out.push({ name, type, path: '', href });
      });

      // Fallback for older HTML or non-row layouts
      if (out.length === 0) {
        const anchors = document.querySelectorAll(
          'a[href*="/blob/"], a[href*="/tree/"]',
        );
        const seen = new Set<string>();
        anchors.forEach((a) => {
          const href = (a as HTMLAnchorElement).getAttribute('href') || '';
          if (!/\/(blob|tree)\//.test(href)) return;
          if (seen.has(href)) return;
          seen.add(href);
          const name = ((a as HTMLAnchorElement).textContent || '').trim();
          if (!name || name.includes('\n')) return;
          out.push({
            name,
            type: /\/tree\//.test(href) ? 'dir' : 'file',
            path: '',
            href,
          });
        });
      }

      return out;
    });

    const result: TreeEntry[] = [];
    const seen = new Set<string>();
    for (const e of entries) {
      const m = e.href.match(/\/(blob|tree)\/[^/]+\/(.+)$/);
      const innerPath = m ? decodeURIComponent(m[2]) : '';
      if (!innerPath) continue;
      // Restrict to direct children of cleanPath
      const prefix = cleanPath ? cleanPath + '/' : '';
      if (prefix && !innerPath.startsWith(prefix)) continue;
      const rel = innerPath.slice(prefix.length);
      if (!rel || rel.includes('/')) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      result.push({
        name: rel,
        type: (e.type as TreeEntry['type']) || 'unknown',
        path: innerPath,
        url: 'https://github.com' + e.href,
      });
    }

    result.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (b.type === 'dir' && a.type !== 'dir') return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      repository: `${owner}/${name}`,
      ref: input.ref,
      path: cleanPath,
      url,
      entries: result,
    };
  });
}
