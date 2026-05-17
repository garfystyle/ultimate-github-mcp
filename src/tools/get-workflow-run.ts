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
    // Wait for the actual status icons to render inside the job rows — these load AFTER the names.
    await page
      .waitForFunction(
        () =>
          !!document.querySelector(
            'a[href*="/job/"] [class*="LeadingVisual"] svg.octicon-x-circle-fill, ' +
              'a[href*="/job/"] [class*="LeadingVisual"] svg.octicon-check-circle-fill, ' +
              'a[href*="/job/"] [class*="LeadingVisual"] svg.octicon-clock, ' +
              'a[href*="/job/"] [class*="LeadingVisual"] svg.octicon-skip, ' +
              'a[href*="/job/"] [class*="LeadingVisual"] svg.octicon-stop, ' +
              'a[href*="/job/"] [class*="LeadingVisual"] svg.octicon-dot-fill',
          ),
        { timeout: 20000 },
      )
      .catch(() => {});

    const data = await page.evaluate(() => {
      function txt(el: Element | null) { return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }

      // Helper: read SVG class via getAttribute (SVG.className is SVGAnimatedString, not a string).
      function svgClasses(el: Element | null): string {
        return el?.getAttribute?.('class') ?? '';
      }
      function statusFromIcon(el: Element | null): string {
        const cls = svgClasses(el);
        if (/check-circle-fill/.test(cls)) return 'success';
        if (/x-circle-fill/.test(cls)) return 'failure';
        if (/stop/.test(cls)) return 'cancelled';
        if (/octicon-skip/.test(cls)) return 'skipped';
        if (/clock|dot-fill|hourglass|sync/.test(cls)) return 'in_progress';
        const aria = el?.getAttribute?.('aria-label') || '';
        if (/success/i.test(aria)) return 'success';
        if (/^failed?\b|^fail/i.test(aria)) return 'failure';
        if (/cancel/i.test(aria)) return 'cancelled';
        if (/skip/i.test(aria)) return 'skipped';
        if (/in.progress|running|queued|pending/i.test(aria)) return 'in_progress';
        return 'unknown';
      }

      // Title: usually the workflow name or first commit title.
      const title = txt(document.querySelector('main h1'));
      const bodyText = document.body.innerText || '';

      // Run-level status: pick the first status octicon that has a color-fg-* class.
      // These are the real status indicators — plain `octicon-x-circle-fill` is also reused for unrelated buttons.
      let status = 'unknown';
      const statusIcons = Array.from(
        document.querySelectorAll(
          'svg.octicon-check-circle-fill, svg.octicon-x-circle-fill, svg.octicon-stop, svg.octicon-skip, svg.octicon-clock, svg.octicon-dot-fill',
        ),
      );
      const realRunIcon = statusIcons.find((s) => /color-fg-/.test(svgClasses(s)));
      if (realRunIcon) status = statusFromIcon(realRunIcon);
      if (status === 'unknown') {
        if (/\bsuccessful\b/i.test(bodyText)) status = 'success';
        else if (/\b(failed?|failing)\b/i.test(bodyText)) status = 'failure';
        else if (/\bcancelled\b/i.test(bodyText)) status = 'cancelled';
        else if (/\b(in progress|running|queued)\b/i.test(bodyText)) status = 'in_progress';
      }

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
        // Job status icon is inside the LeadingVisual span of the ActionListItem.
        const statusSvg =
          jobRow?.querySelector(
            '[class*="LeadingVisual"] svg.octicon-check-circle-fill, ' +
              '[class*="LeadingVisual"] svg.octicon-x-circle-fill, ' +
              '[class*="LeadingVisual"] svg.octicon-skip, ' +
              '[class*="LeadingVisual"] svg.octicon-dot-fill, ' +
              '[class*="LeadingVisual"] svg.octicon-clock, ' +
              '[class*="LeadingVisual"] svg.octicon-stop',
          ) ?? null;
        const jobStatus = statusFromIcon(statusSvg);
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
