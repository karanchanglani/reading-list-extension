const { test, expect } = require("./fixtures");

test.describe("Approaching-quota warning", () => {
  test("badge, FAB label, popup indicator, and import summary all warn once storage nears its limit", async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    // Seed 459 dummy items directly — 90% of the effective 510-item ceiling
    // (chrome.storage.sync's 512-key limit minus the 2 keys this extension
    // reserves for itself) — rather than clicking "save" 459 times.
    const seeded = await serviceWorker.evaluate(async () => {
      const ids = [];
      const writes = {};
      for (let i = 0; i < 459; i++) {
        const id = `seed-${i}`;
        ids.push(id);
        writes[`item_${id}`] = {
          id,
          url: `http://example.com/seed-${i}`,
          title: `Seed Article ${i}`,
          favIconUrl: "",
          addedAt: Date.now(),
          readStatus: false,
        };
      }
      writes.readingListIndex = ids;
      await chrome.storage.sync.set(writes);
      return ids.length;
    });
    expect(seeded).toBe(459);

    // Saving one more via the FAB should push us over the 90% threshold.
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}/index.html`, { waitUntil: "load" });
    await page.locator("#read-later-fab").click();
    await expect(page.locator("#read-later-fab")).toHaveClass(/rl-unread/);

    const badgeText = await serviceWorker.evaluate(() => chrome.action.getBadgeText({}));
    expect(badgeText).toMatch(/^\d+%$/);

    const fabLabel = await page.locator("#read-later-fab").getAttribute("aria-label");
    expect(fabLabel).toMatch(/storage/i);
    expect(fabLabel).toMatch(/%/);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popupPage.locator("#usage-info")).toHaveClass(/is-warning/);
    await expect(popupPage.locator("#usage-info")).toContainText("460 / 510");

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });
    const csvPath = require("node:path").join(require("node:os").tmpdir(), `one-more-${Date.now()}.csv`);
    require("node:fs").writeFileSync(
      csvPath,
      'title,url,time_added,tags,status\n"One More","http://example.com/one-more-import",1700000000,,unread\n',
      "utf8"
    );
    await optionsPage.locator("#import-input").setInputFiles(csvPath);
    await expect(optionsPage.locator("#import-status")).toContainText("1 added", { timeout: 5000 });
    await expect(optionsPage.locator("#import-status")).toContainText(/full/i);
  });
});
