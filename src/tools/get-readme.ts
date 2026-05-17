import { z } from 'zod';
import { getContext } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const getReadmeShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  ref: z.string().default('HEAD').describe('Branch, tag, or commit SHA.'),
};
export const getReadmeSchema = z.object(getReadmeShape);
export type GetReadmeInput = z.infer<typeof getReadmeSchema>;

export interface ReadmeResult {
  repository: string;
  ref: string;
  path: string;
  url: string;
  content: string;
}

const CANDIDATES = [
  'README.md',
  'README.rst',
  'README',
  'README.txt',
  'README.markdown',
  'Readme.md',
  'readme.md',
  'docs/README.md',
];

export async function getReadme(input: GetReadmeInput): Promise<ReadmeResult> {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const ctx = await getContext();

  for (const cand of CANDIDATES) {
    const raw = `https://github.com/${owner}/${name}/raw/${input.ref}/${cand}`;
    const resp = await ctx.request.get(raw, { maxRedirects: 5 }).catch(() => null);
    if (resp && resp.ok()) {
      const text = await resp.text();
      return {
        repository: `${owner}/${name}`,
        ref: input.ref,
        path: cand,
        url: `https://github.com/${owner}/${name}/blob/${input.ref}/${cand}`,
        content: text,
      };
    }
  }
  throw new Error(`No README found in ${input.repo} at ref ${input.ref}.`);
}
