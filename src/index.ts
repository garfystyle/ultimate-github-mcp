#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeBrowser } from './browser.js';

// v0.1 tools
import { searchCode, searchCodeShape } from './tools/search-code.js';
import { searchRepos, searchReposShape } from './tools/search-repos.js';
import { getRepo, getRepoShape } from './tools/get-repo.js';
import { getFile, getFileShape } from './tools/get-file.js';
import { listTree, listTreeShape } from './tools/list-tree.js';
import { getReadme, getReadmeShape } from './tools/get-readme.js';

// v0.2 tools
import { getPrDiff, getPrDiffShape } from './tools/get-pr-diff.js';
import { compareRefs, compareRefsShape } from './tools/compare-refs.js';
import { getCommit, getCommitShape } from './tools/get-commit.js';
import { searchIssues, searchIssuesShape } from './tools/search-issues.js';
import { searchPrs, searchPrsShape } from './tools/search-prs.js';
import { searchCommits, searchCommitsShape } from './tools/search-commits.js';
import { searchUsers, searchUsersShape } from './tools/search-users.js';
import { getIssue, getIssueShape } from './tools/get-issue.js';
import { getPullRequest, getPullRequestShape } from './tools/get-pull-request.js';
import { getPrFiles, getPrFilesShape } from './tools/get-pr-files.js';
import { getFileHistory, getFileHistoryShape } from './tools/get-file-history.js';
import { listBranches, listBranchesShape } from './tools/list-branches.js';
import { listReleases, listReleasesShape } from './tools/list-releases.js';
import { getDependents, getDependentsShape } from './tools/get-dependents.js';
import { getTrending, getTrendingShape } from './tools/get-trending.js';
import { getUser, getUserShape } from './tools/get-user.js';
import { listUserRepos, listUserReposShape } from './tools/list-user-repos.js';
import { listWorkflowRuns, listWorkflowRunsShape } from './tools/list-workflow-runs.js';
import { getBlame, getBlameShape } from './tools/get-blame.js';
// v0.3 additions
import { listPrReviewComments, listPrReviewCommentsShape } from './tools/list-pr-review-comments.js';
import { getWorkflowRun, getWorkflowRunShape } from './tools/get-workflow-run.js';
import { listContributors, listContributorsShape } from './tools/list-contributors.js';
import { getGist, getGistShape } from './tools/get-gist.js';
import { listTopicRepos, listTopicReposShape } from './tools/list-topic-repos.js';

function ok(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function err(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
}

function wrap<T>(fn: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try { return ok(await fn(args)); } catch (e) { return err(e); }
  };
}

async function main() {
  const server = new McpServer({ name: 'ultimate-github', version: '0.2.0' });

  // ─── Search ────────────────────────────────────────────────────────────
  server.tool('search_code',
    'Search code across all of GitHub via the web UI. Supports full GitHub code-search syntax (language:, repo:, org:, path:, "phrase", -term).',
    searchCodeShape, wrap(searchCode));
  server.tool('search_repositories',
    'Search repositories on GitHub via the web UI. Supports stars:>N, language:X, topic:Y, archived:false, user:foo.',
    searchReposShape, wrap(searchRepos));
  server.tool('search_issues',
    'Search issues. Supports is:open is:closed label:bug author:foo assignee:bar repo:owner/name org:foo "phrase".',
    searchIssuesShape, wrap(searchIssues));
  server.tool('search_pull_requests',
    'Search pull requests. Supports is:open is:merged is:closed draft:true review:approved reviewed-by:foo author:foo repo:owner/name.',
    searchPrsShape, wrap(searchPrs));
  server.tool('search_commits',
    'Search commits by message/author/repo/date. Supports repo:owner/name author:foo committer:bar author-date:>2024-01-01 hash:abc.',
    searchCommitsShape, wrap(searchCommits));
  server.tool('search_users',
    'Search users and organizations. Supports type:user type:org location:Berlin followers:>1000 language:Go.',
    searchUsersShape, wrap(searchUsers));

  // ─── Repository metadata ───────────────────────────────────────────────
  server.tool('get_repo_info',
    'Repository metadata: stars/forks/watchers/topics/languages/license/last commit/latest release/open issues/PRs.',
    getRepoShape, wrap(getRepo));
  server.tool('get_file_contents',
    'Raw file contents at a ref. Works for private repos you can access.',
    getFileShape, wrap(getFile));
  server.tool('list_directory',
    'List direct entries (files/dirs) at a path in a repo at a ref.',
    listTreeShape, wrap(listTree));
  server.tool('get_readme',
    'Fetch the README content of a repo (tries README.md, README.rst, etc).',
    getReadmeShape, wrap(getReadme));
  server.tool('list_branches',
    "List a repo's branches with last commit info; supports name substring filter.",
    listBranchesShape, wrap(listBranches));
  server.tool('list_releases',
    'List releases with tags, notes, and downloadable assets.',
    listReleasesShape, wrap(listReleases));

  // ─── Git history ──────────────────────────────────────────────────────
  server.tool('get_commit',
    'Commit metadata + optional unified diff.',
    getCommitShape, wrap(getCommit));
  server.tool('get_file_history',
    'Recent commits that modified a specific file.',
    getFileHistoryShape, wrap(getFileHistory));
  server.tool('get_file_blame',
    'Line-by-line blame: which commit and author last touched each line of a file (range-limited).',
    getBlameShape, wrap(getBlame));
  server.tool('compare_refs',
    'Diff between two refs (branches/tags/SHAs) as a unified diff or git patch.',
    compareRefsShape, wrap(compareRefs));

  // ─── PRs / Issues ─────────────────────────────────────────────────────
  server.tool('get_issue',
    'Full issue: title, body, state, author, labels, assignees, and comments.',
    getIssueShape, wrap(getIssue));
  server.tool('get_pull_request',
    'Full PR: title, body, state, base/head branches, checks, reviewers, labels, and comments.',
    getPullRequestShape, wrap(getPullRequest));
  server.tool('get_pull_request_diff',
    'Raw unified diff (or git patch) of a PR via the .diff / .patch endpoint.',
    getPrDiffShape, wrap(getPrDiff));
  server.tool('get_pull_request_files',
    'Per-file changed-files summary of a PR with +/- line counts.',
    getPrFilesShape, wrap(getPrFiles));

  // ─── Users / Orgs ─────────────────────────────────────────────────────
  server.tool('get_user_profile',
    "User or org profile: bio, location, company, blog, follower counts, pinned repos.",
    getUserShape, wrap(getUser));
  server.tool('list_user_repos',
    "List a user/org's repositories with filters (type, language, sort).",
    listUserReposShape, wrap(listUserRepos));

  // ─── Discovery (web-only goldmine) ────────────────────────────────────
  server.tool('get_dependents',
    "List the 'Used by' dependents of a repo — repositories or packages that depend on this one. This data isn't exposed via the GitHub API.",
    getDependentsShape, wrap(getDependents));
  server.tool('get_trending',
    'Trending repositories on GitHub for a language and timeframe (daily/weekly/monthly).',
    getTrendingShape, wrap(getTrending));

  // ─── CI / Actions ─────────────────────────────────────────────────────
  server.tool('list_workflow_runs',
    'List GitHub Actions workflow runs with status/branch/actor/event filters. Great for CI debugging.',
    listWorkflowRunsShape, wrap(listWorkflowRuns));
  server.tool('get_workflow_run',
    'Details of a single workflow run: status, triggered_by, jobs and their statuses, duration, branch, commit SHA.',
    getWorkflowRunShape, wrap(getWorkflowRun));

  // ─── PR review comments ───────────────────────────────────────────────
  server.tool('list_pull_request_review_comments',
    'Inline code review comments on a PR (with file path and line context). Essential for understanding why a PR was reviewed a given way.',
    listPrReviewCommentsShape, wrap(listPrReviewComments));

  // ─── Contributors / discovery ────────────────────────────────────────
  server.tool('list_contributors',
    'Top contributors of a repo with commit counts and +/- line stats.',
    listContributorsShape, wrap(listContributors));
  server.tool('list_topic_repos',
    'Explore repos by GitHub topic (e.g. "mcp-server", "rust", "machine-learning").',
    listTopicReposShape, wrap(listTopicRepos));

  // ─── Gists ───────────────────────────────────────────────────────────
  server.tool('get_gist',
    'Fetch a gist: title, description, owner, list of files + their contents.',
    getGistShape, wrap(getGist));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = async () => {
    try { await closeBrowser(); } finally { process.exit(0); }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('[ultimate-github-mcp] fatal:', err);
  process.exit(1);
});
