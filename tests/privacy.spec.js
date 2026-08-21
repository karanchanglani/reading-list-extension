const { test, expect } = require("./fixtures");

test.describe("Privacy policy", () => {
  test("is linked from the Options footer and states the no-server / no-tracking summary", async ({
    context,
    extensionId,
  }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });

    const privacyLink = optionsPage.locator('footer a[href="privacy.html"]');
    await expect(privacyLink).toBeVisible();

    const [privacyPage] = await Promise.all([
      // Filtered by URL: the install-triggered welcome.html tab can also
      // still be arriving as a "page" event around when this test runs.
      context.waitForEvent("page", {
        predicate: (p) => p.url() === `chrome-extension://${extensionId}/privacy.html`,
      }),
      privacyLink.click(),
    ]);
    await privacyPage.waitForLoadState("domcontentloaded");

    expect(privacyPage.url()).toBe(`chrome-extension://${extensionId}/privacy.html`);
    await expect(privacyPage.locator("h1")).toContainText("Privacy Policy");
    await expect(privacyPage.locator("body")).toContainText(/doesn't have a server/i);
    await expect(privacyPage.locator("body")).toContainText(/no analytics/i);
  });
});
