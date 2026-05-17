import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const listContributorsShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  page: z.number().int().min(1).max(100).default(1),
};
export const listContributorsSchema = z.object(listContributorsShape);
export type ListContributorsInput = z.infer<typeof listContributorsSchema>;

export async function listContributors(input: ListContributorsInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  // The contributors page is fully JS-rendered. We wait for the list to appear.
  const url = `https://github.com/${owner}/${name}/graphs/contributors`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() === 404) throw new Error(`Contributors not available for ${input.repo}.`);

    // Wait for the dynamic contributor list to render. For very large repos this can take a while
    // and may be omitted entirely with a "line counts have been omitted" notice.
    await page
      .waitForFunction(
        () => {
          const items = document.querySelectorAll('ol.contrib-data > li, li.contrib-person, [data-testid="contributor"]');
          if (items.length > 0) return true;
          const text = document.body.innerText || '';
          if (/line counts have been omitted/i.test(text)) return true;
          if (/no contributors/i.test(text)) return true;
          return false;
        },
        { timeout: 30000 },
      )
      .catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const out: any[] = [];
      const items = document.querySelectorAll('ol.contrib-data > li, li.contrib-person, [data-testid="contributor"]');
      items.forEach((li) => {
        const a = li.querySelector('a[href^="/"]:not([href*="/"][href*="commits"])') as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute('href') || '';
        const m = href.match(/^\/([^/]+)$/);
        if (!m) return;
        const username = m[1];
        const liTxt = (li as HTMLElement).innerText || '';
        const commitsMatch = liTxt.match(/(\d[\d,]*)\s+commits?/i);
        const additionsMatch = liTxt.match(/\+\+\s*(\d[\d,]*)/);
        const deletionsMatch = liTxt.match(/--\s*(\d[\d,]*)/);
        out.push({
          username,
          url: 'https://github.com/' + username,
          commits: commitsMatch ? parseInt(commitsMatch[1].replace(/,/g, ''), 10) : null,
          additions: additionsMatch ? parseInt(additionsMatch[1].replace(/,/g, ''), 10) : null,
          deletions: deletionsMatch ? parseInt(deletionsMatch[1].replace(/,/g, ''), 10) : null,
        });
      });
      const omitted = /line counts have been omitted/i.test(document.body.innerText || '');
      return { contributors: out, lineCountsOmitted: omitted };
    });

    return { repository: `${owner}/${name}`, page: input.page, url, ...data };
  });
}
