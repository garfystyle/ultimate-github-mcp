import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { fetchText } from '../scrape.js';

export const getGistShape = {
  gistId: z.string().describe('Gist ID (e.g. "abc123..." or "{username}/{gistId}").'),
  includeFiles: z.boolean().default(true),
  maxFileBytes: z.number().int().min(256).max(1_000_000).default(100_000),
};
export const getGistSchema = z.object(getGistShape);
export type GetGistInput = z.infer<typeof getGistSchema>;

export async function getGist(input: GetGistInput) {
  await ensureLoggedIn();
  // Accept both raw id and username/id
  const cleanId = input.gistId.replace(/^\/+|\/+$/g, '');
  const url = `https://gist.github.com/${cleanId}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() === 404) throw new Error(`Gist "${input.gistId}" not found.`);

    const meta = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const title = txt(document.querySelector('.gist-banner-secondary, [data-testid="gist-description"], main h1'));
      const description = txt(document.querySelector('.gist-description, [data-testid="gist-description"]'));
      const ownerEl = document.querySelector('a[data-hovercard-type="user"], header a[href^="/"]') as HTMLAnchorElement | null;
      const owner = ownerEl ? (ownerEl.getAttribute('href') || '').replace(/^\//, '') : null;
      const time = document.querySelector('relative-time, time');
      const updated = time?.getAttribute('datetime') ?? null;
      // File names: from each file's <a href="...raw/...">.
      // Skip nav buttons like "Raw"/"Download" — those have role=button or end with the same text without an actual filename.
      const fileNames = Array.from(document.querySelectorAll('.file .file-info a, [data-testid="file-name"], .file-header a, .file-info > strong'))
        .map((a) => txt(a))
        .filter((t) => t && t.length > 0 && t.length < 200 && !/^(Raw|Download|Copy|Edit|View)$/i.test(t));
      // Raw URLs
      const rawUrls = Array.from(document.querySelectorAll('a[href*="/raw/"]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter(Boolean);
      return { title, description, owner, updated, fileNames: Array.from(new Set(fileNames)), rawUrls: Array.from(new Set(rawUrls)) };
    });

    const files: any[] = [];
    if (input.includeFiles) {
      for (const rawUrl of meta.rawUrls.slice(0, 20)) {
        const r = await fetchText(rawUrl);
        if (!r.ok) continue;
        const truncated = r.text.length > input.maxFileBytes;
        // Filename from URL last segment
        const nm = decodeURIComponent(rawUrl.split('/').pop() || '');
        files.push({
          name: nm,
          rawUrl,
          bytes: r.text.length,
          truncated,
          content: truncated ? r.text.slice(0, input.maxFileBytes) : r.text,
        });
      }
    }

    return {
      gistId: cleanId,
      url,
      title: meta.title || null,
      description: meta.description || null,
      owner: meta.owner,
      updated: meta.updated,
      fileNames: meta.fileNames,
      files,
    };
  });
}
