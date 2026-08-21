import { getReadingList, getSettings, saveSettings, SETTINGS_KEY } from "./storage.js";
import { getArticleSnapshot } from "./content-cache.js";

const metaEl = document.getElementById("meta");
const titleEl = document.getElementById("article-title");
const sublineEl = document.getElementById("article-subline");
const contentEl = document.getElementById("article-content");
const liveLinkEl = document.getElementById("live-link");
const stateEl = document.getElementById("state");
const settingsBtn = document.getElementById("reader-settings-btn");
const settingsPanel = document.getElementById("reader-settings-panel");
const fontSizeSelect = document.getElementById("reader-font-size-select");
const fontFamilySelect = document.getElementById("reader-font-family-select");
const widthSelect = document.getElementById("reader-width-select");

const FONT_SIZE_PRESETS = {
  small: { fontSize: "14px", lineHeight: "1.6" },
  medium: { fontSize: "16.5px", lineHeight: "1.7" },
  large: { fontSize: "19px", lineHeight: "1.75" },
  xlarge: { fontSize: "22px", lineHeight: "1.8" },
};
const FONT_FAMILY_PRESETS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
};
const WIDTH_PRESETS = { narrow: "560px", default: "680px", wide: "860px" };

/** @param {import("./storage.js").Settings} settings */
function applyReaderSettings(settings) {
  const size = FONT_SIZE_PRESETS[settings.readerFontSize] || FONT_SIZE_PRESETS.medium;
  const root = document.documentElement.style;
  root.setProperty("--reader-font-size", size.fontSize);
  root.setProperty("--reader-line-height", size.lineHeight);
  root.setProperty("--reader-font-family", FONT_FAMILY_PRESETS[settings.readerFontFamily] || FONT_FAMILY_PRESETS.sans);
  root.setProperty("--reader-max-width", WIDTH_PRESETS[settings.readerWidth] || WIDTH_PRESETS.default);

  fontSizeSelect.value = settings.readerFontSize;
  fontFamilySelect.value = settings.readerFontFamily;
  widthSelect.value = settings.readerWidth;
}

function closeSettingsPanel() {
  settingsPanel.classList.remove("is-visible");
  settingsBtn.classList.remove("is-active");
}

settingsBtn.addEventListener("click", () => {
  const opening = !settingsPanel.classList.contains("is-visible");
  settingsPanel.classList.toggle("is-visible", opening);
  settingsBtn.classList.toggle("is-active", opening);
});

document.addEventListener("click", (event) => {
  if (!settingsPanel.classList.contains("is-visible")) return;
  if (event.target === settingsBtn || settingsPanel.contains(event.target)) return;
  closeSettingsPanel();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettingsPanel();
});

fontSizeSelect.addEventListener("change", async () => {
  applyReaderSettings(await saveSettings({ readerFontSize: fontSizeSelect.value }));
});
fontFamilySelect.addEventListener("change", async () => {
  applyReaderSettings(await saveSettings({ readerFontFamily: fontFamilySelect.value }));
});
widthSelect.addEventListener("change", async () => {
  applyReaderSettings(await saveSettings({ readerWidth: widthSelect.value }));
});

// Picks up a reading-preference change made from another reader.html tab
// open at the same time — mirrors the same live-update pattern content.js
// already uses for the fabEnabled setting. saveSettings() always writes the
// full merged Settings object, so newValue here is never partial.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[SETTINGS_KEY]) return;
  applyReaderSettings(changes[SETTINGS_KEY].newValue);
});

function showState(html) {
  stateEl.innerHTML = html;
  stateEl.hidden = false;
  metaEl.classList.remove("is-visible");
}

function formatDate(epochMs) {
  try {
    return new Date(epochMs).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

async function load() {
  applyReaderSettings(await getSettings());

  const itemId = new URLSearchParams(location.search).get("id");
  if (!itemId) {
    showState("No article specified.");
    return;
  }

  const [items, snapshot] = await Promise.all([getReadingList(), getArticleSnapshot(itemId)]);
  const item = items.find((i) => i.id === itemId);

  if (!item) {
    showState("This article is no longer in your reading list.");
    return;
  }

  liveLinkEl.href = item.url;
  liveLinkEl.hidden = false;

  if (!snapshot) {
    // item.url can come from an imported file (JSON/Pocket CSV), not just a
    // real browser-normalized location.href, so it isn't trusted input.
    // Building the link via DOM (safe .href assignment) and reading back
    // .outerHTML lets the browser's own serializer escape it correctly for
    // an HTML attribute — plain string interpolation here would only be
    // safe against text-node injection, not the "break out of the href
    // attribute" case, since a raw double-quote in the URL wouldn't be
    // escaped by a text-content-oriented helper like escapeHtml() below.
    const liveLink = document.createElement("a");
    liveLink.href = item.url;
    liveLink.target = "_blank";
    liveLink.rel = "noopener";
    liveLink.textContent = "Open the live page instead";

    showState(
      `No cached content for this article — it may have been saved before Reader View was added, or extraction ` +
        `didn't work for this page. ${liveLink.outerHTML}.`
    );
    return;
  }

  document.title = `${snapshot.title || item.title} — Read Later`;
  titleEl.textContent = snapshot.title || item.title;

  const subParts = [];
  if (snapshot.siteName) subParts.push(snapshot.siteName);
  if (snapshot.byline) subParts.push(snapshot.byline);
  subParts.push(`${snapshot.readingTimeMinutes} min read`);
  if (item.addedAt) subParts.push(`Saved ${formatDate(item.addedAt)}`);
  sublineEl.innerHTML = subParts.map((part) => `<span>${escapeHtml(part)}</span>`).join("");

  // Readability's output is sanitized as part of extraction (scripts and
  // event-handler attributes are stripped), and the page's own CSP blocks
  // inline script execution regardless — this mirrors how Firefox's Reader
  // View treats the same library's output.
  contentEl.innerHTML = snapshot.content;
  metaEl.classList.add("is-visible");
  settingsBtn.classList.add("is-visible");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

load();
