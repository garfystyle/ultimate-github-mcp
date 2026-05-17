import { z } from 'zod';
import { ensureLoggedIn } from '../auth.js';
import { fetchText } from '../scrape.js';
import { parseRepoRef } from '../util.js';

export const getPrDiffShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  number: z.number().int().positive().describe('Pull request number.'),
  format: z.enum(['diff', 'patch']).default('diff').describe('"diff" (unified) or "patch" (with author/email/date).'),
  maxBytes: z.number().int().min(1024).max(5_000_000).default(500_000).describe('Cap on returned size.'),
};
export const getPrDiffSchema = z.object(getPrDiffShape);
export type GetPrDiffInput = z.infer<typeof getPrDiffSchema>;

export async function getPrDiff(input: GetPrDiffInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}/pull/${input.number}.${input.format}`;
  const { status, ok, text } = await fetchText(url);
  if (!ok) throw new Error(`Failed to fetch PR ${input.format} (status ${status}): ${url}`);
  const truncated = text.length > input.maxBytes;
  return {
    repository: `${owner}/${name}`,
    number: input.number,
    format: input.format,
    url,
    bytes: text.length,
    truncated,
    content: truncated ? text.slice(0, input.maxBytes) : text,
  };
}
