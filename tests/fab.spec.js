const { test, expect } = require("./fixtures");

test.describe("Floating action button", () => {
  test("click saves the page and turns orange", async ({ context, fixturesUrl }) => {
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}/index.html`, { waitUntil: "load" });

    const fab = page.locator("#read-later-fab");
    await expect(fab).toBeAttached();
    await expect(fab).not.toHaveClass(/rl-unread|rl-read/);

    await fab.click();
    await expect(fab).toHaveClass(/rl-unread/);
    await expect(fab).toHaveCSS("background-color", "rgb(217, 119, 6)"); // #d97706
  });

  test("double-click toggles read status, and it persists across a reload", async ({ context, fixturesUrl }) => {
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}/index.html`, { waitUntil: "load" });

    const fab = page.locator("#read-later-fab");
    await fab.click();
    await expect(fab).toHaveClass(/rl-unread/);

    await fab.dblclick();
    await expect(fab).toHaveClass(/rl-read/);
    await expect(fab).toHaveCSS("background-color", "rgb(0, 255, 127)"); // #00ff7f

    await page.reload({ waitUntil: "load" });
    await expect(page.locator("#read-later-fab")).toHaveClass(/rl-read/);

    await page.locator("#read-later-fab").dblclick();
    await expect(page.locator("#read-later-fab")).toHaveClass(/rl-unread/);
  });

  test("holding for 2.5s removes the item; releasing early does not", async ({ context, fixturesUrl }) => {
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}/index.html`, { waitUntil: "load" });

    const fab = page.locator("#read-later-fab");
    await fab.click();
    await expect(fab).toHaveClass(/rl-unread/);

    // Release after less than a second: should cancel, nothing removed.
    const box = await fab.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await expect(fab).toHaveClass(/rl-holding/);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(fab).toHaveClass(/rl-unread/);
    await expect(fab).not.toHaveClass(/rl-holding/);

    // Hold for the full 2.5s: should remove and revert to the default state.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(2800);
    await page.mouse.up();

    await expect(fab).not.toHaveClass(/rl-unread|rl-read/, { timeout: 5000 });

    // The trailing "click" from the mouseup shouldn't re-save it.
    await page.waitForTimeout(500);
    await expect(fab).not.toHaveClass(/rl-unread|rl-read/);

    await page.reload({ waitUntil: "load" });
    await expect(page.locator("#read-later-fab")).not.toHaveClass(/rl-unread|rl-read/);
  });
});
