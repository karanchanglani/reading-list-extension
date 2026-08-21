const { test, expect } = require("./fixtures");

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

async function seedSnapshot(serviceWorker, id, textContent) {
  return serviceWorker.evaluate(
    async ({ id, textContent }) => {
      await chrome.storage.local.set({ [`snapshot_${id}`]: { textContent } });
    },
    { id, textContent }
  );
}

test.describe("Content search", () => {
  test("search also matches cached article text, with an excerpt, without false-positiving on items with no snapshot", async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    await seedItems(serviceWorker, [
      {
        id: "with-snapshot",
        url: "https://example.com/backcountry",
        title: "Why Hikers Still Trust Paper Maps",
        favIconUrl: "",
        addedAt: 3,
        readStatus: false,
        hasSnapshot: true,
        tags: [],
      },
      {
        id: "no-snapshot",
        url: "https://example.com/unrelated",
        title: "An Unrelated Article About Cooking",
        favIconUrl: "",
        addedAt: 2,
        readStatus: false,
        hasSnapshot: false,
        tags: [],
      },
      {
        id: "title-match",
        url: "https://example.com/xylophone",
        title: "The History of the Xylophone Parade",
        favIconUrl: "",
        addedAt: 1,
        readStatus: false,
        hasSnapshot: false,
        tags: [],
      },
    ]);
    await seedSnapshot(
      serviceWorker,
      "with-snapshot",
      "Long before GPS, a xylophone parade marched through the valley every spring, and hikers still carried paper maps just in case."
    );

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popup.locator("#list li")).toHaveCount(3);

    await popup.locator("#search-input").fill("xylophone parade");
    // Content search resolves after the debounce; wait for the list to settle at 2 matches
    // (the title-match item, plus the snapshot item matched by body text alone).
    await expect(popup.locator("#list li")).toHaveCount(2);

    const snapshotItem = popup.locator('#list li[data-id="with-snapshot"]');
    await expect(snapshotItem).toBeVisible();
    await expect(snapshotItem.locator(".snippet mark")).toHaveText("xylophone parade");

    const titleMatchItem = popup.locator('#list li[data-id="title-match"]');
    await expect(titleMatchItem).toBeVisible();
    await expect(titleMatchItem.locator(".snippet")).toHaveCount(0); // title already shows the match, no redundant excerpt

    await expect(popup.locator('#list li[data-id="no-snapshot"]')).toHaveCount(0);
  });
});
