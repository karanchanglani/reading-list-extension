const { test, expect } = require("./fixtures");

test.describe("Internationalization", () => {
  test("manifest name/description resolve via messages.json, and UI strings come from chrome.i18n", async ({
    serviceWorker,
    context,
    extensionId,
  }) => {
    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe("Read Later");
    expect(manifest.description).toBe("Save the current page to your reading list and revisit it anytime.");

    const messages = await serviceWorker.evaluate(() => ({
      statusSaved: chrome.i18n.getMessage("statusSaved"),
      contextMenuAddToList: chrome.i18n.getMessage("contextMenuAddToList"),
      fabLabelDefault: chrome.i18n.getMessage("fabLabelDefault"),
    }));
    expect(messages.statusSaved).toBe("Saved");
    expect(messages.contextMenuAddToList).toBe("Add link/page to Reading List");
    expect(messages.fabLabelDefault).toBe("Save this page to Read Later");

    // options.js reads the same catalog to render its "Saved" status pill.
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });
    await optionsPage.locator("#export-btn").click();
    await expect(optionsPage.locator("#status")).toHaveText("Saved");
  });
});
