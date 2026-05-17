import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseCount } from '../util.js';

export const getTrendingShape = {
  language: z.string().default('').describe('Empty = all languages. Use lowercase: "javascript", "typescript", "go", etc.'),
  since: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  spokenLanguage: z.string().default('').describe('Optional 2-letter spoken language filter (e.g. "en", "ru").'),
};
export const getTrendingSchema = z.object(getTrendingShape);
export type GetTrendingInput = z.infer<typeof getTrendingSchema>;

export async function getTrending(input: GetTrendingInput) {
  await ensureLoggedIn();
  const lang = input.language.toLowerCase().trim();
  const path = lang ? `/trending/${encodeURIComponent(lang)}` : '/trending';
  const params = new URLSearchParams();
  params.set('since', input.since);
  if (input.spokenLanguage) params.set('spoken_language_code', input.spokenLanguage);
  const url = `https://github.com${path}?${params.toString()}`;

  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const out: any[] = [];
      const articles = document.querySelectorAll('article.Box-row, .Box-row');
      articles.forEach((row) => {
        const h2 = row.querySelector('h2 a, h1 a');
        const a = h2 as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute('href') || '';
        const m = href.match(/^\/([^/]+)\/([^/]+)$/);
        if (!m) return;
        const repository = `${m[1]}/${m[2]}`;
        const description = txt(row.querySelector('p'));
        const language = txt(row.querySelector('[itemprop="programmingLanguage"], span[itemprop="programmingLanguage"]'));
        const starLink = row.querySelector('a[href$="/stargazers"]');
        const forkLink = row.querySelector('a[href$="/network/members"]');
        const todayMatch = txt(row).match(/([\d,]+)\s+stars?\s+(?:today|this week|this month)/i);
        const todayStars = todayMatch ? parseInt(todayMatch[1].replace(/,/g, ''), 10) : null;
        out.push({
          repository,
          url: 'https://github.com' + href,
          description: description || null,
          language: language || null,
          totalStars: starLink ? (function () {
            const t = (starLink.textContent || '').replace(/\s+/g, '').replace(/,/g, '');
            const m = t.match(/[\d.]+[kmb]?/i);
            if (!m) return null;
            return (function p(t: string) {
              const r = t.toLowerCase().match(/^([\d.]+)([kmb]?)/);
              if (!r) return null;
              let n = parseFloat(r[1]);
              if (r[2] === 'k') n *= 1_000;
              else if (r[2] === 'm') n *= 1_000_000;
              else if (r[2] === 'b') n *= 1_000_000_000;
              return Math.round(n);
            })(m[0]);
          })() : null,
          totalForks: forkLink ? (function () {
            const t = (forkLink.textContent || '').replace(/\s+/g, '').replace(/,/g, '');
            const m = t.match(/[\d.]+[kmb]?/i);
            if (!m) return null;
            const r = m[0].toLowerCase().match(/^([\d.]+)([kmb]?)/);
            if (!r) return null;
            let n = parseFloat(r[1]);
            if (r[2] === 'k') n *= 1_000;
            else if (r[2] === 'm') n *= 1_000_000;
            else if (r[2] === 'b') n *= 1_000_000_000;
            return Math.round(n);
          })() : null,
          starsToday: todayStars,
          builtBy: Array.from(row.querySelectorAll('a[href^="/"] img.avatar'))
            .map((img) => (img as HTMLImageElement).alt?.replace(/^@/, '') || null)
            .filter(Boolean) as string[],
        });
      });
      return { repos: out };
    });

    return {
      language: input.language || null,
      since: input.since,
      spokenLanguage: input.spokenLanguage || null,
      url,
      ...data,
    };
  });
}
