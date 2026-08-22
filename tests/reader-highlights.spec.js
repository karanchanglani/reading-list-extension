const { test, expect } = require("./fixtures");

const ARTICLE_TEXT = "The quick brown fox jumps over the lazy dog.";

async function seedArticle(serviceWorker, { id, url, title }) {
  return serviceWorker.evaluate(
    async ({ id, url, title, text }) => {
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
          content: `<p>${text}</p>`,
          textContent: text,
          excerpt: text,
          length: text.length,
          readingTimeMinutes: 1,
          cachedAt: Date.now(),
        },
      });
    },
    { id, url, title, text: ARTICLE_TEXT }
  );
}

/** Selects `substring` within the article's single <p>, and fires the mouseup reader.js listens for. */
async function selectText(page, substring) {
  await page.evaluate((substring) => {
    const p = document.querySelector("#article-content p");
    const textNode = p.firstChild;
    const start = textNode.nodeValue.indexOf(substring);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + substring.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, substring);
}

test.describe("Reader view highlights", () => {
  test("selecting text offers a highlight action, and the highlight (with an optional note) persists and can be removed", async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    await seedArticle(serviceWorker, {
      id: "highlight-item",
      url: "https://example.com/highlight-test",
      title: "A Highlightable Article",
    });

    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${extensionId}/reader.html?id=highlight-item`, { waitUntil: "load" });
    await expect(reader.locator("#meta")).toHaveClass(/is-visible/);

    await selectText(reader, "quick brown");
    await expect(reader.locator("#highlight-toolbar")).toHaveClass(/is-visible/);
    await reader.locator("#highlight-toolbar").click();

    const mark = reader.locator("#article-content mark.rl-highlight");
    await expect(mark).toHaveText("quick brown");

    // Reopen fresh — the highlight should have persisted via chrome.storage.local.
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/reader.html?id=highlight-item`, { waitUntil: "load" });
    const reopenedMark = reopened.locator("#article-content mark.rl-highlight");
    await expect(reopenedMark).toHaveText("quick brown");
    await expect(reopenedMark).not.toHaveClass(/has-note/);

    // Add a note.
    await reopenedMark.click();
    const popover = reopened.locator(".rl-highlight-popover");
    await expect(popover).toBeVisible();
    await popover.locator("textarea").fill("This part matters.");
    await popover.locator(".save-btn").click();
    await expect(reopenedMark).toHaveClass(/has-note/);

    // Note persists too.
    const reopenedAgain = await context.newPage();
    await reopenedAgain.goto(`chrome-extension://${extensionId}/reader.html?id=highlight-item`, {
      waitUntil: "load",
    });
    const markAgain = reopenedAgain.locator("#article-content mark.rl-highlight");
    await expect(markAgain).toHaveClass(/has-note/);
    await markAgain.click();
    await expect(reopenedAgain.locator(".rl-highlight-popover textarea")).toHaveValue("This part matters.");

    // Remove it — the mark should unwrap back to plain text.
    await reopenedAgain.locator(".rl-highlight-popover .remove-btn").click();
    await expect(reopenedAgain.locator("#article-content mark.rl-highlight")).toHaveCount(0);
    await expect(reopenedAgain.locator("#article-content")).toHaveText(ARTICLE_TEXT);

    const stillGoneAfterReload = await context.newPage();
    await stillGoneAfterReload.goto(`chrome-extension://${extensionId}/reader.html?id=highlight-item`, {
      waitUntil: "load",
    });
    await expect(stillGoneAfterReload.locator("#article-content mark.rl-highlight")).toHaveCount(0);
  });

  test("deleting the article from the Manager also removes its highlights from storage", async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    await seedArticle(serviceWorker, {
      id: "highlight-cleanup-item",
      url: "https://example.com/highlight-cleanup",
      title: "Another Highlightable Article",
    });

    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${extensionId}/reader.html?id=highlight-cleanup-item`, {
      waitUntil: "load",
    });
    await selectText(reader, "lazy dog");
    await reader.locator("#highlight-toolbar").click();
    await expect(reader.locator("#article-content mark.rl-highlight")).toHaveCount(1);
    await reader.close();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await popup.locator("#list .remove-btn").click();
    await expect(popup.locator("#empty-state")).toBeVisible({ timeout: 5000 });

    const stored = await serviceWorker.evaluate(async () => {
      const result = await chrome.storage.local.get("highlights_highlight-cleanup-item");
      return result["highlights_highlight-cleanup-item"];
    });
    expect(stored).toBeUndefined();
  });
});
