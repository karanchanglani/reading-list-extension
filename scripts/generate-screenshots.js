// One-off generator for Chrome Web Store listing screenshots (roadmap item
// 2's remaining scope, now that the icon itself is being kept as-is). Not a
// test — no assertions, just drives the real unpacked extension the same
// way tests/fixtures.js does and saves PNGs to store-assets/screenshots/.
//
// Re-run any time the UI changes enough that the screenshots go stale:
//   node scripts/generate-screenshots.js

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { chromium } = require("@playwright/test");
const { startStaticServer } = require("../tests/server");

const EXT_PATH = path.join(__dirname, "..");
const OUT_DIR = path.join(__dirname, "..", "store-assets", "screenshots");
const STORE_WIDTH = 1280;
const STORE_HEIGHT = 800;

async function seedItems(serviceWorker, items) {
  return serviceWorker.evaluate(async (seedItems) => {
    const writes = {};
    const ids = [];
    for (const item of seedItems) {
      writes[`item_${item.id}`] = item;
      ids.push(item.id);
    }
    writes.readingListIndex = ids;
    await chrome.storage.sync.set(writes);
    return ids;
  }, items);
}

/**
 * Centers a screenshot smaller than the Store's required canvas as a floating
 * card on a neutral 1280x800 background, by rendering it inline (as a data
 * URI, to sidestep file:// / http:// origin restrictions on <img src>) in a
 * throwaway page and screenshotting that instead.
 * @param {import("playwright-core").BrowserContext} context
 * @param {Buffer} imageBuffer
 * @param {string} outPath
 */
async function centerOnStoreCanvas(context, imageBuffer, outPath) {
  const page = await context.newPage();
  await page.setViewportSize({ width: STORE_WIDTH, height: STORE_HEIGHT });
  await page.setContent(`
    <!doctype html>
    <html><head><style>
      html, body { margin: 0; width: ${STORE_WIDTH}px; height: ${STORE_HEIGHT}px; background: #eef0f6; }
      body { display: flex; align-items: center; justify-content: center; }
      img { border-radius: 10px; box-shadow: 0 12px 32px rgba(30, 32, 46, 0.18); }
    </style></head><body>
      <img src="data:image/png;base64,${imageBuffer.toString("base64")}" />
    </body></html>
  `);
  await page.screenshot({ path: outPath });
  await page.close();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { url: fixturesUrl, close: closeServer } = await startStaticServer(path.join(__dirname, "..", "tests", "fixtures"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-ext-screenshots-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, "--headless=new"],
    viewport: { width: STORE_WIDTH, height: STORE_HEIGHT },
  });

  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
    const extensionId = new URL(worker.url()).host;

    await seedItems(worker, [
      {
        id: "shot-1",
        url: "https://www.nationalgeographic.com/travel/article/backcountry-navigation",
        title: "Why Backcountry Hikers Still Trust Paper Maps",
        favIconUrl: "",
        addedAt: Date.now() - 1000 * 60 * 60 * 2,
        readStatus: false,
        tags: ["outdoors"],
      },
      {
        id: "shot-2",
        url: "https://www.theatlantic.com/technology/archive/the-internet-that-wasnt",
        title: "The Internet That Wasn't: Forgotten Networks of the 1980s",
        favIconUrl: "",
        addedAt: Date.now() - 1000 * 60 * 60 * 24,
        readStatus: true,
        tags: ["tech", "history"],
      },
      {
        id: "shot-3",
        url: "https://www.newyorker.com/culture/the-quiet-return-of-the-mixtape",
        title: "The Quiet Return of the Mixtape",
        favIconUrl: "",
        addedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
        readStatus: false,
        tags: ["music"],
      },
      {
        id: "shot-4",
        url: "https://longreads.com/the-last-lighthouse-keepers",
        title: "The Last Lighthouse Keepers",
        favIconUrl: "",
        addedAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
        readStatus: false,
        tags: [],
      },
    ]);

    // Screenshot 1: the Reading List Manager (popup.html), captured *before*
    // the FAB save below — otherwise the local test-server article saved by
    // that step would show up here too, with an ugly "127.0.0.1" domain line.
    // popup.html renders at its fixed popup width, so this is captured at
    // natural size, then composited onto the Store's required 1280x800 canvas.
    const managerPage = await context.newPage();
    await managerPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await managerPage.locator("#list li").first().waitFor();
    const managerBuffer = await managerPage.locator("body").screenshot();
    await managerPage.close();
    await centerOnStoreCanvas(context, managerBuffer, path.join(OUT_DIR, "01-reading-list-manager.png"));

    // Screenshot 2: the on-page floating save button, saved (orange) state,
    // on a real article page — this fills the full 1280x800 canvas as-is.
    const articlePage = await context.newPage();
    await articlePage.goto(`${fixturesUrl}/article.html`, { waitUntil: "load" });
    await articlePage.locator("#read-later-fab").click();
    await articlePage.locator("#read-later-fab.rl-unread").waitFor();
    await articlePage.waitForTimeout(300); // let the icon swap settle before capturing
    await articlePage.screenshot({ path: path.join(OUT_DIR, "02-floating-save-button.png") });
    await articlePage.close();

    console.log(`Screenshots written to ${OUT_DIR}`);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    closeServer();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
