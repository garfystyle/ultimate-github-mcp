import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';

export const listTopicReposShape = {
  topic: z.string().describe('Topic slug (e.g. "machine-learning", "mcp-server").'),
  page: z.number().int().min(1).max(100).default(1),
};
export const listTopicReposSchema = z.object(listTopicReposShape);
export type ListTopicReposInput = z.infer<typeof listTopicReposSchema>;

export async function listTopicRepos(input: ListTopicReposInput) {
  await ensureLoggedIn();
  const topic = encodeURIComponent(input.topic.toLowerCase().trim());
  const url = `https://github.com/topics/${topic}?page=${input.page}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`Topic "${input.topic}" not found.`);
    await page.waitForFunction(() => !!document.querySelector('article'), { timeout: 15000 }).catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }

      // The topic page has a layout container `.container-lg` whose first h1 is the topic name.
      // Avoid the global search h1 which precedes it.
      let headline: string | null = null;
      const containerH1 = document.querySelector('.container-lg h1, main .application-main h1, .topic-name');
      if (containerH1) headline = txt(containerH1) || null;
      if (!headline) {
        const allH1 = Array.from(document.querySelectorAll('h1')).map(txt).filter((t) => t && !/search code/i.test(t));
        headline = allH1[0] || null;
      }

      const out: any[] = [];
      const seen = new Set<string>();
      const articles = document.querySelectorAll('article');
      articles.forEach((card) => {
        const links = Array.from(card.querySelectorAll('a[href^="/"]')) as HTMLAnchorElement[];
        let repo = '';
        for (const a of links) {
          const m = (a.getAttribute('href') || '').match(/^\/([^/?#]+)\/([^/?#]+)$/);
          if (m) { repo = `${m[1]}/${m[2]}`; break; }
        }
        if (!repo || seen.has(repo)) return;
        seen.add(repo);

        // Description: <p> in card with content (skip language indicators and error placeholders)
        let description: string | null = null;
        const ps = card.querySelectorAll('p, div.f6');
        for (const p of Array.from(ps)) {
          const t = txt(p);
          if (!t) continue;
          if (t.length < 15 || t.length > 600) continue;
          if (/^\s*\d+(\.\d+)?[kmb]?\s*$/i.test(t)) continue;
          if (/error while loading|please reload this page|something went wrong/i.test(t)) continue;
          description = t;
          break;
        }

        const language = txt(card.querySelector('[itemprop="programmingLanguage"], span[itemprop="programmingLanguage"]')) || null;

        // Stars: each card uses #repo-stars-counter-star with title="N" (id is reused per-card despite being an "id").
        const starEl = card.querySelector('#repo-stars-counter-star, [id*="stars-counter"]');
        let stars: number | null = null;
        if (starEl) {
          const titleAttr = starEl.getAttribute('title') || '';
          const m = titleAttr.replace(/,/g, '').match(/\d+/);
          if (m) stars = parseInt(m[0], 10);
          else {
            const t = (starEl.textContent || '').replace(/\s+/g, '').replace(/,/g, '').toLowerCase();
            const mm = t.match(/^([\d.]+)([kmb]?)/);
            if (mm) {
              let n = parseFloat(mm[1]);
              if (mm[2] === 'k') n *= 1_000;
              else if (mm[2] === 'm') n *= 1_000_000;
              else if (mm[2] === 'b') n *= 1_000_000_000;
              stars = Math.round(n);
            }
          }
        }

        const time = card.querySelector('relative-time, time');
        const updated = time?.getAttribute('datetime') ?? null;

        out.push({
          repository: repo,
          url: `https://github.com/${repo}`,
          description,
          language,
          stars,
          updated,
        });
      });

      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { headline, repos: out, hasNextPage };
    });

    return { topic: input.topic, page: input.page, url, ...data };
  });
}
