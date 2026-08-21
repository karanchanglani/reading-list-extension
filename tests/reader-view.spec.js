const { test, expect } = require("./fixtures");

test.describe("Article content caching / reader view", () => {
  test("FAB save extracts a readable snapshot, and the reader view renders it", async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const articleUrl = `${fixturesUrl}/article.html`;
    const page = await context.newPage();
    await page.goto(articleUrl, { waitUntil: "load" });

    await page.locator("#read-later-fab").click();
    await expect(page.locator("#read-later-fab")).toHaveClass(/rl-unread/);

    const stored = await serviceWorker.evaluate(async () => {
      const { readingListIndex = [] } = await chrome.storage.sync.get("readingListIndex");
      const items = await chrome.storage.sync.get(readingListIndex.map((id) => `item_${id}`));
      const item = Object.values(items)[0];
      const snapKey = `snapshot_${item.id}`;
      const snap = await chrome.storage.local.get(snapKey);
      return { item, snapshot: snap[snapKey] || null };
    });

    expect(stored.item.hasSnapshot).toBe(true);
    expect(stored.snapshot).not.toBeNull();
    expect(stored.snapshot.title).toContain("Paper Maps");
    expect(stored.snapshot.textContent.length).toBeGreaterThan(1000);
    expect(stored.snapshot.readingTimeMinutes).toBeGreaterThan(0);

    // The Manager should show a reader-view button for this item.
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popupPage.locator("#list .reader-btn")).toHaveCount(1);

    const [readerPage] = await Promise.all([
      // Filtered by URL: the install-triggered welcome.html tab can also
      // still be arriving as a "page" event around when this test runs.
      context.waitForEvent("page", {
        predicate: (p) => p.url().startsWith(`chrome-extension://${extensionId}/reader.html`),
      }),
      popupPage.locator("#list .reader-btn").click(),
    ]);
    await readerPage.waitForLoadState("domcontentloaded");
    await expect(readerPage.locator("#meta")).toHaveClass(/is-visible/);
    await expect(readerPage.locator("#article-title")).toContainText("Paper Maps");
    await expect(readerPage.locator("#article-content")).toContainText("Roman Empire");
    await expect(readerPage.locator("#live-link")).toHaveAttribute("href", articleUrl);

    // Deleting the item from the Manager should also remove its snapshot.
    await popupPage.bringToFront();
    await popupPage.locator("#list .remove-btn").click();
    await expect(popupPage.locator("#empty-state")).toBeVisible({ timeout: 5000 });

    const afterDelete = await serviceWorker.evaluate(async (id) => {
      const key = `snapshot_${id}`;
      const result = await chrome.storage.local.get(key);
      return result[key] || null;
    }, stored.item.id);
    expect(afterDelete).toBeNull();
  });
});
