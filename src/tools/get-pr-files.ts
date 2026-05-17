import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const getPrFilesShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  number: z.number().int().positive(),
};
export const getPrFilesSchema = z.object(getPrFilesShape);
export type GetPrFilesInput = z.infer<typeof getPrFilesSchema>;

export async function getPrFiles(input: GetPrFilesInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}/pull/${input.number}/files`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() === 404) throw new Error(`PR #${input.number} not found in ${input.repo}.`);
    await page
      .waitForFunction(() => !!document.querySelector('[id^="diff-"], a[href^="#diff-"]'), { timeout: 25000 })
      .catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }

      // The PR files page anchor list: links to each file have href="#diff-HASH" and text = filename.
      const anchors = Array.from(document.querySelectorAll('a[href^="#diff-"]')) as HTMLAnchorElement[];

      // Build map of diff anchor -> filename (use the first link with non-empty visible text per anchor).
      const filesByAnchor = new Map<string, string>();
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/^#(diff-[a-f0-9]+)$/);
        if (!m) continue;
        const t = txt(a).replace(/^[‎]+|[‎]+$/g, ''); // strip directional unicode marks
        if (!t) continue;
        // Prefer the longer (full path) over short basename.
        const prev = filesByAnchor.get(m[1]);
        if (!prev || t.length > prev.length) filesByAnchor.set(m[1], t);
      }

      // Per-file diff container has id="diff-HASH".
      const files: any[] = [];
      const seen = new Set<string>();
      const diffEls = document.querySelectorAll('[id^="diff-"]');
      diffEls.forEach((el) => {
        const id = el.id;
        if (!/^diff-[a-f0-9]+$/.test(id)) return;
        if (seen.has(id)) return;
        seen.add(id);
        const path = filesByAnchor.get(id) || null;
        if (!path) return;
        const elTxt = (el as HTMLElement).innerText || '';
        // "+3 -1" or "+3 −1" or "3 additions and 1 deletion"
        const a = elTxt.match(/[+]\s*([\d,]+)/);
        const d = elTxt.match(/[-−–]\s*([\d,]+)/);
        const addLine = elTxt.match(/([\d,]+)\s+additions?/i);
        const delLine = elTxt.match(/([\d,]+)\s+deletions?/i);
        const additions = addLine
          ? parseInt(addLine[1].replace(/,/g, ''), 10)
          : a ? parseInt(a[1].replace(/,/g, ''), 10) : null;
        const deletions = delLine
          ? parseInt(delLine[1].replace(/,/g, ''), 10)
          : d ? parseInt(d[1].replace(/,/g, ''), 10) : null;
        files.push({
          path,
          additions,
          deletions,
          anchor: `https://github.com${(document.location.pathname)}#${id}`,
        });
      });

      // Summary: try to find totals in the page header.
      const allText = document.body.innerText || '';
      const sum = allText.match(/(\d+)\s+files? changed[^\n]*/i);
      const summary = sum ? sum[0] : null;

      return { summary, files };
    });

    return { repository: `${owner}/${name}`, number: input.number, url, ...data };
  });
}
