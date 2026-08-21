// Shared Playwright fixtures for testing the unpacked extension end to end
// in a real Chromium instance — not mocks, the actual manifest/background/
// content scripts loaded exactly as Chrome would load them.
//
// Each test gets its own fresh browser profile (so storage state never
// leaks between tests) and its own instance of the tests/fixtures static
// server, torn down after the test completes.

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { test: base, chromium } = require("@playwright/test");
const { startStaticServer } = require("./server");

const EXT_PATH = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(__dirname, "fixtures");

const test = base.extend({
  // Overrides Playwright Test's built-in `context` fixture. Loading an
  // unpacked extension requires launchPersistentContext (a plain
  // browser.newContext() can't do it), and chrome.commands / the service
  // worker / chrome.action all need a real, non-incognito-style profile.
  //
  // `headless: false` + the explicit `--headless=new` arg is deliberate,
  // not redundant: Playwright's own `headless: true` selects Chromium's
  // legacy headless mode for launchPersistentContext, which does NOT load
  // extensions at all (confirmed empirically — the service worker never
  // registers). Chromium's newer "--headless=new" mode does support
  // extensions; passing it as a raw arg while telling Playwright itself
  // "headless: false" avoids Playwright injecting the legacy flag instead.
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-ext-test-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--headless=new",
      ],
    });

    await use(context);

    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  /** The extension's chrome-extension:// id, derived from its service worker's URL. */
  extensionId: async ({ context }, use) => {
    const worker = await getServiceWorker(context);
    await use(new URL(worker.url()).host);
  },

  /** The background service worker, for reading/seeding chrome.storage directly. */
  serviceWorker: async ({ context }, use) => {
    await use(await getServiceWorker(context));
  },

  /** Base URL of a static server serving tests/fixtures/*.html over real http://. */
  fixturesUrl: async ({}, use) => {
    const { url, close } = await startStaticServer(FIXTURES_DIR);
    await use(url);
    close();
  },
});

async function getServiceWorker(context) {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker", { timeout: 10_000 });
}

module.exports = { test, expect: base.expect };
