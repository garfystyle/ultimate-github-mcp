import { z } from 'zod';
import { withPage } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { parseRepoRef } from '../util.js';

export const getWorkflowRunShape = {
  repo: z.string().describe('Repository in "owner/name" form.'),
  runId: z.string().describe('Workflow run ID (numeric, as a string).'),
};
export const getWorkflowRunSchema = z.object(getWorkflowRunShape);
export type GetWorkflowRunInput = z.infer<typeof getWorkflowRunSchema>;

export async function getWorkflowRun(input: GetWorkflowRunInput) {
  await ensureLoggedIn();
  const { owner, name } = parseRepoRef(input.repo);
  const url = `https://github.com/${owner}/${name}/actions/runs/${input.runId}`;
  return withPage(async (page) => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() === 404) throw new Error(`Workflow run ${input.runId} not found in ${input.repo}.`);
    await page.waitForFunction(
      () => !!document.querySelector('main h1, [class*="ActionListItem"], [data-testid="action-job"]'),
      { timeout: 20000 },
    ).catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }

      // Title: usually the workflow name or first commit title.
      const title = txt(document.querySelector('main h1'));
      // Status header text
      const bodyText = document.body.innerText || '';
      let status = 'unknown';
      const statusEl = document.querySelector('[aria-label*="Workflow run" i], [data-testid="run-status"]');
      const aria = statusEl?.getAttribute('aria-label') || '';
      if (/success/i.test(aria)) status = 'success';
      else if (/fail/i.test(aria) || /error/i.test(aria)) status = 'failure';
      else if (/cancel/i.test(aria)) status = 'cancelled';
      else if (/in.progress|running|queued/i.test(aria)) status = 'in_progress';

      // Trigger info from sidebar
      const triggerMatch = bodyText.match(/Triggered (?:via|by)\s+([\w-]+)/i);
      const triggeredBy = triggerMatch ? triggerMatch[1] : null;
      const durationMatch = bodyText.match(/(?:Total duration|Elapsed)\s*([^\n]+)/i);
      const duration = durationMatch ? durationMatch[1].trim().slice(0, 40) : null;

      // Jobs list (left sidebar) — dedupe by job ID, take first occurrence (clean URL without #step).
      const jobs: any[] = [];
      const seenJobs = new Set<string>();
      const jobItems = document.querySelectorAll('a[href*="/actions/runs/"][href*="/job/"], [data-testid="action-job"] a');
      jobItems.forEach((a) => {
        const href = (a as HTMLAnchorElement).getAttribute('href') || '';
        const m = href.match(/\/job\/(\d+)/);
        if (!m) return;
        const jobId = m[1];
        if (seenJobs.has(jobId)) return;
        seenJobs.add(jobId);
        const jobName = txt(a) || null;
        const jobRow = a.closest('li, div[class*="ActionList"], li[class*="ActionListItem"]') as HTMLElement | null;
        // Look for any svg with octicon class indicating status, or aria-label containing status keyword.
        let jobStatus = 'unknown';
        const statusSvg = jobRow?.querySelector('svg.octicon-check-circle-fill, svg.octicon-x-circle-fill, svg.octicon-skip, svg.octicon-dot-fill, svg.octicon-clock, svg.octicon-stop, svg[class*="octicon"][aria-label]');
        if (statusSvg) {
          const aria = statusSvg.getAttribute('aria-label') || '';
          const cl = statusSvg.classList.toString();
          if (/success/i.test(aria) || /check-circle-fill/.test(cl)) jobStatus = 'success';
          else if (/fail/i.test(aria) || /x-circle-fill/.test(cl)) jobStatus = 'failure';
          else if (/cancel/i.test(aria) || /stop/.test(cl)) jobStatus = 'cancelled';
          else if (/skip/i.test(aria) || /octicon-skip/.test(cl)) jobStatus = 'skipped';
          else if (/in.progress|running|queued/i.test(aria) || /clock|dot-fill/.test(cl)) jobStatus = 'in_progress';
        }
        // Clean URL — strip the #step anchor.
        const cleanHref = href.replace(/#step:.*$/, '');
        jobs.push({
          id: jobId,
          name: jobName,
          status: jobStatus,
          url: 'https://github.com' + cleanHref,
        });
      });

      // Trigger event (push/pull_request/etc)
      const eventMatch = bodyText.match(/\b(push|pull_request|workflow_dispatch|schedule|release|workflow_run|repository_dispatch)\b/i);
      const event = eventMatch ? eventMatch[1] : null;

      // Commit / branch
      const branchEl = document.querySelector('.commit-ref, [class*="branch-name" i], [data-testid="branch-name"]');
      const branch = branchEl ? txt(branchEl) || null : null;
      const commitLink = document.querySelector('a[href*="/commit/"]') as HTMLAnchorElement | null;
      const commitSha = commitLink
        ? (commitLink.getAttribute('href') || '').match(/\/commit\/([a-f0-9]{7,40})/)?.[1] ?? null
        : null;

      return { title, status, triggeredBy, duration, jobs, event, branch, commitSha };
    });

    return { repository: `${owner}/${name}`, runId: input.runId, url, ...data };
  });
}
