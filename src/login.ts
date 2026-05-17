import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const PROFILE_DIR =
  process.env.ULTIMATE_GITHUB_PROFILE_DIR ??
  path.join(os.homedir(), '.ultimate-github-mcp', 'profile');

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  console.log(`[ultimate-github-mcp] Profile dir: ${PROFILE_DIR}`);
  console.log('[ultimate-github-mcp] Opening browser. Sign in to GitHub, then close the window.');

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://github.com/login');

  await new Promise<void>((resolve) => {
    ctx.once('close', () => resolve());
  });
  console.log('[ultimate-github-mcp] Browser closed. Session saved.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[ultimate-github-mcp] Login error:', err);
  process.exit(1);
});
