const { test, expect } = require("./fixtures");

test.describe("First-run onboarding", () => {
  test("opens automatically on install and covers the toolbar icon, shortcuts, FAB, and Options", async ({
    context,
    extensionId,
  }) => {
    const welcomePage = await findWelcomePage(context, extensionId);

    await expect(welcomePage.locator("h1")).toContainText("Welcome to Read Later");
    await expect(welcomePage.locator("body")).toContainText(/toolbar icon/i);
    await expect(welcomePage.locator("body")).toContainText(/Ctrl\+Shift\+S/);
    await expect(welcomePage.locator("body")).toContainText(/Ctrl\+Shift\+L/);
    await expect(welcomePage.locator("body")).toContainText(/hold for 2\.5s/i);
    await expect(welcomePage.locator("body")).toContainText(/Options page/i);
  });
});

/** The install-triggered tab may already be open, or still be arriving as a "page" event. */
async function findWelcomePage(context, extensionId) {
  const url = `chrome-extension://${extensionId}/welcome.html`;
  const existing = context.pages().find((p) => p.url() === url);
  if (existing) return existing;

  const page = await context.waitForEvent("page", {
    predicate: (p) => p.url() === url,
    timeout: 10_000,
  });
  await page.waitForLoadState("domcontentloaded");
  return page;
}
