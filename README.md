# ultimate-github-mcp

Powerful MCP server for GitHub that drives the **web UI** (not the REST/GraphQL API) via Playwright.

No API rate limits. Code search returns the same results you'd see logged in to github.com — including the ones API search misses.

## 30 tools across 8 categories

### Search (6)
- `search_code` — code across all of GitHub (the marquee feature)
- `search_repositories` — repo search with stars/language/topic filters
- `search_issues` — full issue-search syntax
- `search_pull_requests` — PR search with reviewer / state / draft filters
- `search_commits` — commit message search
- `search_users` — users and organizations

### Repository (6)
- `get_repo_info` — stars/forks/topics/languages/license/last commit/latest release
- `get_file_contents` — raw file at any ref
- `list_directory` — directory listing at a ref
- `get_readme` — README content (tries common candidates)
- `list_branches` — branches with last commit info
- `list_releases` — releases with tags, notes, assets

### Git history (4)
- `get_commit` — commit metadata + unified diff
- `get_file_history` — recent commits that modified a file
- `get_file_blame` — line-by-line blame (range-limited)
- `compare_refs` — diff between two refs

### PRs & Issues (5)
- `get_issue` — title, body, state, author, labels, assignees, comments
- `get_pull_request` — same plus base/head branches, checks, reviewers
- `get_pull_request_diff` — raw unified diff via the `.diff` endpoint
- `get_pull_request_files` — per-file +/- counts
- `list_pull_request_review_comments` — inline code review comments

### Users & Orgs (2)
- `get_user_profile` — bio, location, company, follower counts, pinned repos
- `list_user_repos` — repos owned by a user/org with filters

### CI / Actions (2)
- `list_workflow_runs` — runs with status/branch/actor/event filters
- `get_workflow_run` — single run with all jobs and statuses

### Discovery (3)
- `get_dependents` — "Used by" repos and packages (**not exposed via the GitHub API**)
- `get_trending` — daily/weekly/monthly trending by language
- `list_topic_repos` — explore repos by GitHub topic
- `list_contributors` — top contributors with commit counts

### Misc (1)
- `get_gist` — gist contents

## Setup

```powershell
git clone https://github.com/<you>/ultimate-github-mcp.git
cd ultimate-github-mcp
npm install
npm run build
npm run login   # opens a browser, sign in to GitHub, then close it
```

The session is saved to `%USERPROFILE%\.ultimate-github-mcp\profile` (or `$HOME/.ultimate-github-mcp/profile` on macOS/Linux).

## Register with Claude Code

```powershell
claude mcp add ultimate-github -s user -- node "C:\path\to\ultimate-github-mcp\dist\index.js"
```

Then ask Claude:
> найди в GitHub коде упоминания StreamQosCookie

## Env vars

- `ULTIMATE_GITHUB_PROFILE_DIR` — override the Playwright profile location
- `ULTIMATE_GITHUB_HEADLESS=0` — run the browser visibly (debugging)

## How it works

A Playwright Chromium with a persistent profile authenticates as you once and stays logged in across sessions. Every tool either:
- Hits a `.diff` / `.patch` / `/raw/` endpoint for plain text (fastest, most reliable), or
- Scrapes the rendered DOM with selectors targeted to GitHub's current React UI.

The Playwright instance is a singleton inside the MCP process — pages are opened and closed per request.
