import { withPage, PROFILE_DIR } from './browser.js';

export async function isLoggedIn(): Promise<boolean> {
  return withPage(async (page) => {
    await page.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loggedIn = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="user-login"]') as HTMLMetaElement | null;
      if (meta && meta.content && meta.content.trim().length > 0) return true;
      const avatar = document.querySelector(
        'header [aria-label*="View profile" i], header img.avatar-user, header [data-login]',
      );
      return !!avatar;
    });
    return loggedIn;
  });
}

export async function ensureLoggedIn(): Promise<void> {
  const ok = await isLoggedIn();
  if (!ok) {
    throw new Error(
      `Not logged in to GitHub. Run \`npm run login\` in this MCP server's directory ` +
        `(profile dir: ${PROFILE_DIR}). A browser window will open. After signing in, just close it.`,
    );
  }
}
