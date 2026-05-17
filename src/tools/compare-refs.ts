import { z } from 'zod';
import { ensureLoggedIn } from '../auth.js';
import { fetchText } from '../scrape.js';
import { parseRepoRef } from '../util.js';

export const compareRefsShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  base: z.string().describe('Base ref (branch, tag, or SHA).'),
  head: z.string().describe('Head ref (branch, tag, or SHA).'),
  format: z.enum(['diff', 'patch']).default('diff'),
  maxBytes: z.number().int().min(1024).max(5_000_000).default(500_000),
};
export const compareRefsSchema = z.object(compareRefsShape);
export type CompareRefsInput = z.infer<typeof compareRefsSchema>;

export async function compareRefs(input: CompareRefsInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}.${input.format}`;
  const { status, ok, text } = await fetchText(url);
  if (!ok) throw new Error(`Failed to fetch compare ${input.format} (status ${status}): ${url}`);
  const truncated = text.length > input.maxBytes;
  return {
    repository: `${owner}/${name}`,
    base: input.base,
    head: input.head,
    format: input.format,
    url,
    bytes: text.length,
    truncated,
    content: truncated ? text.slice(0, input.maxBytes) : text,
  };
}
