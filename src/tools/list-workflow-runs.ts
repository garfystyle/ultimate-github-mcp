import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const listWorkflowRunsShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  workflowFile: z.string().optional().describe('Workflow filename (e.g. "ci.yml") to scope to one workflow.'),
  status: z.enum(['all', 'success', 'failure', 'in_progress', 'queued', 'cancelled', 'skipped']).default('all'),
  branch: z.string().optional(),
  actor: z.string().optional(),
  event: z.string().optional().describe('Trigger event filter (push, pull_request, etc).'),
  page: z.number().int().min(1).max(100).default(1),
};
export const listWorkflowRunsSchema = z.object(listWorkflowRunsShape);
export type ListWorkflowRunsInput = z.infer<typeof listWorkflowRunsSchema>;

export async function listWorkflowRuns(input: ListWorkflowRunsInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const base = input.workflowFile
    ? `https://github.com/${owner}/${name}/actions/workflows/${encodeURIComponent(input.workflowFile)}`
    : `https://github.com/${owner}/${name}/actions`;
  const params = new URLSearchParams();
  const q: string[] = [];
  if (input.status !== 'all') q.push(`is:${input.status}`);
  if (input.branch) q.push(`branch:${input.branch}`);
  if (input.actor) q.push(`actor:${input.actor}`);
  if (input.event) q.push(`event:${input.event}`);
  if (q.length > 0) params.set('query', q.join(' '));
  params.set('page', String(input.page));
  const url = `${base}?${params.toString()}`;

  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() === 404) throw new Error(`Actions page not found for ${input.repo}.`);
    await page.waitForFunction(
      () => !!document.querySelector('a[href*="/actions/runs/"], [data-testid="actions-run-row"], .Box-row'),
      { timeout: 15000 },
    ).catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
      const out: any[] = [];
      const seen = new Set<string>();
      const links = Array.from(document.querySelectorAll('a[href*="/actions/runs/"]')) as HTMLAnchorElement[];
      for (const a of links) {
        const m = (a.getAttribute('href') || '').match(/\/actions\/runs\/(\d+)/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const row = a.closest('li, .Box-row, [data-testid="actions-run-row"], .ActionListItem-module__item') as HTMLElement | null;
        if (!row) continue;
        const title = txt(row.querySelector('h3, .h4, [class*="title"]')) || txt(a);
        const branchEl = row.querySelector('.commit-ref, [class*="commit-ref" i], [data-testid="branch-name"]');
        const branch = txt(branchEl) || null;
        const time = row.querySelector('relative-time, time');
        const date = time?.getAttribute('datetime') ?? null;
        // Status: icon className or aria-label
        const statusIcon = row.querySelector('[aria-label*="Workflow run" i], svg.octicon-check-circle-fill, svg.octicon-x-circle-fill, svg.octicon-skip, svg.octicon-clock');
        const statusAria = statusIcon?.getAttribute('aria-label') || '';
        let status: string = 'unknown';
        if (/success/i.test(statusAria)) status = 'success';
        else if (/fail/i.test(statusAria) || /error/i.test(statusAria)) status = 'failure';
        else if (/cancel/i.test(statusAria)) status = 'cancelled';
        else if (/skip/i.test(statusAria)) status = 'skipped';
        else if (/in.progress|running|queued/i.test(statusAria)) status = 'in_progress';
        else if (statusIcon?.classList) {
          const cl = statusIcon.classList.toString();
          if (/check-circle-fill/.test(cl)) status = 'success';
          else if (/x-circle-fill/.test(cl)) status = 'failure';
          else if (/skip/.test(cl)) status = 'skipped';
          else if (/clock/.test(cl)) status = 'in_progress';
        }
        // Duration & event
        const rowTxt = (row.innerText || '').replace(/\s+/g, ' ');
        const durationMatch = rowTxt.match(/(\d+m\s*\d+s|\d+s|\d+\s*minutes?|\d+\s*seconds?)\b/);
        const duration = durationMatch ? durationMatch[1] : null;
        const actorImg = row.querySelector('img.avatar') as HTMLImageElement | null;
        const actor = actorImg?.alt?.replace(/^@/, '') || null;
        out.push({
          id, title, branch, date, status, duration, actor,
          url: 'https://github.com' + (a.getAttribute('href') || ''),
        });
      }
      const hasNextPage = !!document.querySelector('a[rel="next"], a[aria-label*="Next"]');
      return { runs: out, hasNextPage };
    });

    return { repository: `${owner}/${name}`, workflowFile: input.workflowFile ?? null, page: input.page, url, ...data };
  });
}
