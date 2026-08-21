const { test, expect } = require("./fixtures");

async function seedArticle(serviceWorker, { id, url, title }) {
  return serviceWorker.evaluate(
    async ({ id, url, title }) => {
      await chrome.storage.sync.set({
        readingListIndex: [id],
        [`item_${id}`]: {
          id,
          url,
          title,
          favIconUrl: "",
          addedAt: Date.now(),
          readStatus: false,
          hasSnapshot: true,
          tags: [],
        },
      });
      await chrome.storage.local.set({
        [`snapshot_${id}`]: {
          title,
          byline: null,
          siteName: null,
          content: "<p>Some cached article body text.</p>",
          textContent: "Some cached article body text.",
          excerpt: "Some cached article body text.",
          length: 30,
          readingTimeMinutes: 1,
          cachedAt: Date.now(),
        },
      });
    },
    { id, url, title }
  );
}

test.describe("Reader view settings", () => {
  test("font size, font family, and width controls apply live and persist across reloads", async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    await seedArticle(serviceWorker, {
      id: "reader-settings-item",
      url: "https://example.com/reader-settings",
      title: "An Article About Reading Preferences",
    });

    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${extensionId}/reader.html?id=reader-settings-item`, {
      waitUntil: "load",
    });
    await expect(reader.locator("#meta")).toHaveClass(/is-visible/);
    await expect(reader.locator("#reader-settings-btn")).toHaveClass(/is-visible/);

    await reader.locator("#reader-settings-btn").click();
    await expect(reader.locator("#reader-settings-panel")).toHaveClass(/is-visible/);

    await reader.locator("#reader-font-size-select").selectOption("large");
    await expect(reader.locator("#article-content")).toHaveCSS("font-size", "19px");

    await reader.locator("#reader-font-family-select").selectOption("serif");
    await expect(reader.locator("#article-content")).toHaveCSS("font-family", /Georgia/);

    await reader.locator("#reader-width-select").selectOption("narrow");
    await expect(reader.locator("main")).toHaveCSS("max-width", "560px");

    // Reopen the reader view fresh — the choices should have persisted via chrome.storage.sync.
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/reader.html?id=reader-settings-item`, {
      waitUntil: "load",
    });
    await expect(reopened.locator("#article-content")).toHaveCSS("font-size", "19px");
    await expect(reopened.locator("#article-content")).toHaveCSS("font-family", /Georgia/);
    await expect(reopened.locator("main")).toHaveCSS("max-width", "560px");
    await expect(reopened.locator("#reader-font-size-select")).toHaveValue("large");
    await expect(reopened.locator("#reader-font-family-select")).toHaveValue("serif");
    await expect(reopened.locator("#reader-width-select")).toHaveValue("narrow");
  });
});
