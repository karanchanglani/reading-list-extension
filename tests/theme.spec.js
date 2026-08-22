const { test, expect } = require("./fixtures");

async function seedTheme(serviceWorker, theme) {
  return serviceWorker.evaluate(async (theme) => {
    await chrome.storage.sync.set({ settings: { theme } });
  }, theme);
}

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
          content: "<p>Body text.</p>",
          textContent: "Body text.",
          excerpt: "Body text.",
          length: 10,
          readingTimeMinutes: 1,
          cachedAt: Date.now(),
        },
      });
    },
    { id, url, title }
  );
}

const DARK_BG = "rgb(27, 28, 33)";
const LIGHT_BG = "rgb(255, 255, 255)";

test.describe("Theme picker (Light / Dark / System)", () => {
  test("an explicit Dark choice applies even when the OS is light", async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    await seedTheme(serviceWorker, "dark");
    await seedArticle(serviceWorker, { id: "theme-dark-item", url: "https://example.com/a", title: "A" });

    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: "light" });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popup.locator("body")).toHaveCSS("background-color", DARK_BG);

    const reader = await context.newPage();
    await reader.emulateMedia({ colorScheme: "light" });
    await reader.goto(`chrome-extension://${extensionId}/reader.html?id=theme-dark-item`, { waitUntil: "load" });
    await expect(reader.locator("body")).toHaveCSS("background-color", DARK_BG);

    const privacy = await context.newPage();
    await privacy.emulateMedia({ colorScheme: "light" });
    await privacy.goto(`chrome-extension://${extensionId}/privacy.html`, { waitUntil: "load" });
    await expect(privacy.locator("body")).toHaveCSS("background-color", DARK_BG);
  });

  test("an explicit Light choice applies even when the OS is dark", async ({ context, serviceWorker, extensionId }) => {
    await seedTheme(serviceWorker, "light");

    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: "dark" });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(popup.locator("body")).toHaveCSS("background-color", LIGHT_BG);

    const welcome = await context.newPage();
    await welcome.emulateMedia({ colorScheme: "dark" });
    await welcome.goto(`chrome-extension://${extensionId}/welcome.html`, { waitUntil: "load" });
    await expect(welcome.locator("body")).toHaveCSS("background-color", LIGHT_BG);
  });

  test("System (the default) still follows the OS in both directions", async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    await seedTheme(serviceWorker, "system");

    const dark = await context.newPage();
    await dark.emulateMedia({ colorScheme: "dark" });
    await dark.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(dark.locator("body")).toHaveCSS("background-color", DARK_BG);

    const light = await context.newPage();
    await light.emulateMedia({ colorScheme: "light" });
    await light.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await expect(light.locator("body")).toHaveCSS("background-color", LIGHT_BG);
  });

  test("the Options theme select persists across reloads and forces the choice regardless of OS", async ({
    context,
    extensionId,
  }) => {
    const options = await context.newPage();
    await options.emulateMedia({ colorScheme: "light" });
    await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });

    await options.locator("#theme-select").selectOption("dark");
    await expect(options.locator("body")).toHaveCSS("background-color", DARK_BG);

    const reopened = await context.newPage();
    await reopened.emulateMedia({ colorScheme: "light" });
    await reopened.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });
    await expect(reopened.locator("#theme-select")).toHaveValue("dark");
    await expect(reopened.locator("body")).toHaveCSS("background-color", DARK_BG);
  });
});
