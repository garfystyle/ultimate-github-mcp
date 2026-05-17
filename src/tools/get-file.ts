import { z } from 'zod';
import { getContext } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const getFileShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  path: z.string().describe('Path to file inside the repo (no leading slash).'),
  ref: z
    .string()
    .default('HEAD')
    .describe('Branch, tag, or commit SHA. Defaults to HEAD (default branch).'),
  maxBytes: z
    .number()
    .int()
    .min(256)
    .max(2_000_000)
    .default(200_000)
    .describe('Maximum bytes to return.'),
};
export const getFileSchema = z.object(getFileShape);
export type GetFileInput = z.infer<typeof getFileSchema>;

export interface FileContents {
  repository: string;
  path: string;
  ref: string;
  url: string;
  bytes: number;
  truncated: boolean;
  content: string;
}

export async function getFile(input: GetFileInput): Promise<FileContents> {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const cleanPath = input.path.replace(/^\/+/, '');
  const rawUrl = `https://github.com/${owner}/${name}/raw/${input.ref}/${cleanPath}`;
  const blobUrl = `https://github.com/${owner}/${name}/blob/${input.ref}/${cleanPath}`;

  const ctx = await getContext();
  const resp = await ctx.request.get(rawUrl, { maxRedirects: 5 });
  if (!resp.ok()) {
    throw new Error(
      `Failed to fetch ${rawUrl} (status ${resp.status()}). The file may not exist or you may lack access.`,
    );
  }
  const buf = await resp.body();
  const truncated = buf.length > input.maxBytes;
  const slice = truncated ? buf.subarray(0, input.maxBytes) : buf;
  const content = slice.toString('utf8');

  return {
    repository: `${owner}/${name}`,
    path: cleanPath,
    ref: input.ref,
    url: blobUrl,
    bytes: buf.length,
    truncated,
    content,
  };
}
