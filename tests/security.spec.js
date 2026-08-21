const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { test, expect } = require("./fixtures");

test.describe("Security", () => {
  test("reader view doesn't allow HTML/attribute injection via an imported URL", async ({
    context,
    extensionId,
  }) => {
    // A URL that passes the http(s)-prefix check but carries a
    // double-quote and a bare tag in it — exactly what naive string
    // interpolation into an href="..." attribute would let escape the
    // attribute and inject an element.
    const maliciousUrl = `https://example.com/x?y="><img src=x onerror="window.__injected=true">`;

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });

    // JSON import (not CSV) deliberately, so JSON.stringify handles all
    // escaping correctly — this test is about reader.js's rendering, not
    // about CSV-parser quoting, which is a separate concern.
    const jsonPath = path.join(os.tmpdir(), `malicious-import-${Date.now()}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify([{ url: maliciousUrl, title: "Crafted" }]), "utf8");
    await optionsPage.locator("#import-input").setInputFiles(jsonPath);
    await expect(optionsPage.locator("#import-status")).toContainText(/^1 added/, { timeout: 5000 });

    const itemId = await optionsPage.evaluate(async () => {
      const { readingListIndex = [] } = await chrome.storage.sync.get("readingListIndex");
      return readingListIndex[0];
    });

    // No cached snapshot for an imported item, so the reader view hits the
    // "no cached content" branch — the exact code path that builds a link
    // out of item.url.
    const readerPage = await context.newPage();
    let dialogFired = false;
    readerPage.on("dialog", (dialog) => {
      dialogFired = true;
      dialog.dismiss();
    });

    await readerPage.goto(`chrome-extension://${extensionId}/reader.html?id=${itemId}`, { waitUntil: "load" });
    await expect(readerPage.locator("#state")).toBeVisible();

    const injected = await readerPage.evaluate(() => window.__injected);
    expect(injected).toBeUndefined();
    expect(dialogFired).toBe(false);

    // No rogue <img> should have escaped into the page outside the one
    // legitimate <a> link we build.
    await expect(readerPage.locator("#state img")).toHaveCount(0);

    // The link itself should still exist, with the raw URL intact in its
    // href — proving the fix escapes correctly rather than just refusing
    // to render the link at all.
    const link = readerPage.locator("#state a");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", maliciousUrl);
  });
});
