import { chromium, BrowserContext, Page } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const PROFILE_DIR =
  process.env.ULTIMATE_GITHUB_PROFILE_DIR ??
  path.join(os.homedir(), '.ultimate-github-mcp', 'profile');

const HEADLESS = (process.env.ULTIMATE_GITHUB_HEADLESS ?? '1') !== '0';

let _ctxPromise: Promise<BrowserContext> | null = null;
let _closing = false;

async function launchContext(): Promise<BrowserContext> {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreHTTPSErrors: true,
  });
  ctx.on('close', () => {
    _ctxPromise = null;
  });
  return ctx;
}

export async function getContext(): Promise<BrowserContext> {
  if (!_ctxPromise) _ctxPromise = launchContext();
  return _ctxPromise;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    if (!_closing) await page.close().catch(() => {});
  }
}

export async function closeBrowser(): Promise<void> {
  _closing = true;
  if (_ctxPromise) {
    const ctx = await _ctxPromise.catch(() => null);
    if (ctx) await ctx.close().catch(() => {});
    _ctxPromise = null;
  }
}
