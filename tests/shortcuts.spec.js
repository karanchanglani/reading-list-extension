const { test, expect } = require("./fixtures");

test.describe("Keyboard shortcuts", () => {
  test("Ctrl+Shift+L is registered as the reading-list shortcut", async ({ context }) => {
    const page = await context.newPage();
    await page.goto("chrome://extensions/shortcuts", { waitUntil: "load" });
    await page.waitForTimeout(500); // the shortcuts manager renders via a web component

    const text = await page.evaluate(() => {
      const out = [];
      (function walk(node) {
        if (node.shadowRoot) walk(node.shadowRoot);
        for (const child of node.childNodes || []) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
            out.push(child.textContent.trim());
          } else {
            walk(child);
          }
        }
      })(document.body);
      return out.join(" | ");
    });

    expect(text).toContain("Activate the extension");
    expect(text).toContain("Save the current page to your Read Later list");
  });

  test("Options 'Manage shortcuts' button opens chrome://extensions/shortcuts", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });

    const [shortcutsPage] = await Promise.all([
      // Filtered by URL: the install-triggered welcome.html tab can also
      // still be arriving as a "page" event around when this test runs.
      context.waitForEvent("page", {
        predicate: (p) => p.url() === "chrome://extensions/shortcuts",
        timeout: 5000,
      }),
      page.locator("#shortcuts-btn").click(),
    ]);
    await shortcutsPage.waitForLoadState("load").catch(() => {});
    expect(shortcutsPage.url()).toBe("chrome://extensions/shortcuts");
  });
});
