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

test.describe("Tags", () => {
  test("adding tags to an item shows a chip, and the tag-filter row narrows the list", async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    await seedItems(serviceWorker, [
      { id: "tag-a", url: "http://example.com/a", title: "Article A", favIconUrl: "", addedAt: 1, readStatus: false, tags: [] },
      { id: "tag-b", url: "http://example.com/b", title: "Article B", favIconUrl: "", addedAt: 2, readStatus: false, tags: [] },
    ]);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });

    // No tags exist yet, so the filter row stays hidden.
    await expect(popup.locator("#tag-filter")).toBeHidden();

    const itemA = popup.locator('#list li[data-id="tag-a"]');
    await itemA.locator(".tag-btn").click();
    const tagsInput = itemA.locator(".tags-input");
    await expect(tagsInput).toBeFocused();
    await tagsInput.fill("recipes, long-read");
    await tagsInput.press("Enter");

    // Chips render on the item, and the top filter row now offers both tags.
    await expect(itemA.locator(".tag-chips .tag-chip")).toHaveText(["recipes", "long-read"]);
    await expect(popup.locator("#tag-filter")).toBeVisible();
    await expect(popup.locator("#tag-filter .tag-chip")).toHaveText(["long-read", "recipes"]);

    // Filtering by "recipes" hides the untagged item B.
    await popup.locator('#tag-filter .tag-chip:text("recipes")').click();
    await expect(popup.locator('#list li[data-id="tag-a"]')).toBeVisible();
    await expect(popup.locator('#list li[data-id="tag-b"]')).toHaveCount(0);

    // Clicking the same chip again clears the filter.
    await popup.locator('#tag-filter .tag-chip:text("recipes")').click();
    await expect(popup.locator('#list li[data-id="tag-b"]')).toBeVisible();

    // Tags persist across a fresh popup load, confirming they were actually saved.
    const popup2 = await context.newPage();
    await popup2.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popup2.locator('#list li[data-id="tag-a"] .tag-chips .tag-chip')).toHaveText(["recipes", "long-read"]);
  });
});

test.describe("Bulk actions", () => {
  test("select mode supports bulk mark-read and bulk delete", async ({ context, serviceWorker, extensionId }) => {
    await seedItems(serviceWorker, [
      { id: "bulk-a", url: "http://example.com/bulk-a", title: "Bulk A", favIconUrl: "", addedAt: 1, readStatus: false, tags: [] },
      { id: "bulk-b", url: "http://example.com/bulk-b", title: "Bulk B", favIconUrl: "", addedAt: 2, readStatus: false, tags: [] },
      { id: "bulk-c", url: "http://example.com/bulk-c", title: "Bulk C", favIconUrl: "", addedAt: 3, readStatus: false, tags: [] },
    ]);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });

    await expect(popup.locator("#bulk-bar")).not.toHaveClass(/is-visible/);
    await popup.locator("#select-mode-btn").click();
    await expect(popup.locator("#bulk-bar")).toHaveClass(/is-visible/);
    await expect(popup.locator("#bulk-bar-count")).toHaveText("0 selected");

    // Clicking a list item in select mode toggles its checkbox rather than opening a tab.
    await popup.locator('#list li[data-id="bulk-a"]').click();
    await popup.locator('#list li[data-id="bulk-b"]').click();
    await expect(popup.locator("#bulk-bar-count")).toHaveText("2 selected");
    await expect(popup.locator('#list li[data-id="bulk-a"] .select-checkbox')).toBeChecked();
    await expect(popup.locator('#list li[data-id="bulk-c"] .select-checkbox')).not.toBeChecked();

    await popup.locator("#bulk-bar-mark-read").click();
    await expect(popup.locator('#list li[data-id="bulk-a"]')).toHaveClass(/is-read/);
    await expect(popup.locator('#list li[data-id="bulk-b"]')).toHaveClass(/is-read/);
    await expect(popup.locator('#list li[data-id="bulk-c"]')).not.toHaveClass(/is-read/);
    // Selection clears after a bulk action, but select mode itself stays on.
    await expect(popup.locator("#bulk-bar-count")).toHaveText("0 selected");
    await expect(popup.locator("#bulk-bar")).toHaveClass(/is-visible/);

    await popup.locator("#bulk-bar-select-all").click();
    await expect(popup.locator("#bulk-bar-count")).toHaveText("3 selected");
    await popup.locator("#bulk-bar-delete").click();
    await expect(popup.locator("#list li")).toHaveCount(0);
    await expect(popup.locator("#empty-state")).toBeVisible();

    const remaining = await serviceWorker.evaluate(async () => {
      const { readingListIndex = [] } = await chrome.storage.sync.get("readingListIndex");
      return readingListIndex;
    });
    expect(remaining).toHaveLength(0);
  });
});
