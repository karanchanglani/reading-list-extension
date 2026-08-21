const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { test, expect } = require("./fixtures");

test.describe("Export / import", () => {
  test("exports the list as JSON, and re-importing it skips duplicates", async ({
    context,
    extensionId,
    fixturesUrl,
  }) => {
    // Seed two saved articles via the FAB on two different pages.
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}/index.html`, { waitUntil: "load" });
    await page.locator("#read-later-fab").click();
    await expect(page.locator("#read-later-fab")).toHaveClass(/rl-unread/);

    await page.goto(`${fixturesUrl}/index.html?article=2`, { waitUntil: "load" });
    await page.locator("#read-later-fab").click();
    await expect(page.locator("#read-later-fab")).toHaveClass(/rl-unread/);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });

    const [download] = await Promise.all([
      optionsPage.waitForEvent("download", { timeout: 5000 }),
      optionsPage.locator("#export-btn").click(),
    ]);
    const exportPath = path.join(os.tmpdir(), `read-later-export-${Date.now()}.json`);
    await download.saveAs(exportPath);

    const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
    expect(exported).toHaveLength(2);
    for (const item of exported) {
      expect(item).toEqual(
        expect.objectContaining({
          url: expect.any(String),
          title: expect.any(String),
          readStatus: expect.any(Boolean),
          addedAt: expect.any(Number),
        })
      );
    }

    // Re-importing the same export should skip both as duplicates.
    await optionsPage.locator("#import-input").setInputFiles(exportPath);
    await expect(optionsPage.locator("#import-status")).toContainText(/^0 added, 2 skipped/, { timeout: 5000 });
  });

  test("imports new items from a Pocket CSV export, skipping duplicate URLs", async ({
    context,
    extensionId,
    fixturesUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}/index.html`, { waitUntil: "load" });
    await page.locator("#read-later-fab").click();
    await expect(page.locator("#read-later-fab")).toHaveClass(/rl-unread/);
    const existingUrl = page.url();

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });

    const csvPath = path.join(os.tmpdir(), `pocket-export-${Date.now()}.csv`);
    fs.writeFileSync(
      csvPath,
      "title,url,time_added,tags,status\n" +
        `"Existing Article","${existingUrl}",1700000000,,unread\n` +
        `"Brand New From Pocket","http://example.com/pocket-new-${Date.now()}",1700000001,,archive\n`,
      "utf8"
    );

    await optionsPage.locator("#import-input").setInputFiles(csvPath);
    await expect(optionsPage.locator("#import-status")).toContainText(/^1 added, 1 skipped/, { timeout: 5000 });
  });
});
