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

async function visibleTitles(popup) {
  return popup.locator("#list .title").allTextContents();
}

test.describe("Sort options", () => {
  test("each sort mode orders the list correctly, and the choice persists across popup reloads", async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    // Seeded out of every natural order (index order, addedAt order, and
    // alphabetical order all disagree) so each sort mode is unambiguously testable.
    await seedItems(serviceWorker, [
      { id: "s-charlie", url: "http://example.com/charlie", title: "Charlie", favIconUrl: "", addedAt: 300, readStatus: true, tags: [] },
      { id: "s-alpha", url: "http://example.com/alpha", title: "Alpha", favIconUrl: "", addedAt: 100, readStatus: false, tags: [] },
      { id: "s-bravo", url: "http://example.com/bravo", title: "Bravo", favIconUrl: "", addedAt: 200, readStatus: false, tags: [] },
    ]);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });

    // Manual order = the saved index order (insertion order above).
    await expect(popup.locator("#sort-select")).toHaveValue("manual");
    expect(await visibleTitles(popup)).toEqual(["Charlie", "Alpha", "Bravo"]);

    await popup.locator("#sort-select").selectOption("newest");
    expect(await visibleTitles(popup)).toEqual(["Charlie", "Bravo", "Alpha"]);

    await popup.locator("#sort-select").selectOption("oldest");
    expect(await visibleTitles(popup)).toEqual(["Alpha", "Bravo", "Charlie"]);

    await popup.locator("#sort-select").selectOption("unread");
    // Alpha and Bravo (unread) keep their relative order ahead of read Charlie.
    expect(await visibleTitles(popup)).toEqual(["Alpha", "Bravo", "Charlie"]);

    await popup.locator("#sort-select").selectOption("az");
    expect(await visibleTitles(popup)).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Dragging is disabled in every non-manual mode.
    await expect(popup.locator("#list li").first()).not.toHaveAttribute("draggable", "true");

    // The chosen sort mode is saved to settings and survives a fresh popup.
    const popup2 = await context.newPage();
    await popup2.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popup2.locator("#sort-select")).toHaveValue("az");
    expect(await visibleTitles(popup2)).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Switching back to manual restores the saved index order and re-enables dragging.
    await popup2.locator("#sort-select").selectOption("manual");
    expect(await visibleTitles(popup2)).toEqual(["Charlie", "Alpha", "Bravo"]);
    await expect(popup2.locator("#list li").first()).toHaveAttribute("draggable", "true");
  });
});
