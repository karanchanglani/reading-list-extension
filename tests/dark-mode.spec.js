const { test, expect } = require("./fixtures");

test.describe("Dark mode", () => {
  test("popup and options pick up prefers-color-scheme: dark, and the FAB's saved-state colors don't change with it", async ({
    context,
    extensionId,
    fixturesUrl,
  }) => {
    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: "dark" });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popup.locator("body")).toHaveCSS("background-color", "rgb(27, 28, 33)");

    const options = await context.newPage();
    await options.emulateMedia({ colorScheme: "dark" });
    await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });
    await expect(options.locator("body")).toHaveCSS("background-color", "rgb(27, 28, 33)");

    // Light mode still renders the original light surface.
    const popupLight = await context.newPage();
    await popupLight.emulateMedia({ colorScheme: "light" });
    await popupLight.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popupLight.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");

    // The FAB is an opaque, self-contained widget — its saved-state colors
    // (the thing users actually rely on to read status at a glance) are
    // deliberately identical regardless of the host page's color scheme.
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${fixturesUrl}/index.html`, { waitUntil: "load" });
    const fab = page.locator("#read-later-fab");
    await fab.click();
    await expect(fab).toHaveCSS("background-color", "rgb(217, 119, 6)"); // #d97706, unread/orange
    await fab.dblclick();
    await expect(fab).toHaveCSS("background-color", "rgb(0, 255, 127)"); // #00ff7f, read/spring-green
  });
});
