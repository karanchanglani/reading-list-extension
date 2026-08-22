import { getReadingList, getSettings, saveSettings, SETTINGS_KEY } from "./storage.js";
import { getArticleSnapshot, getHighlights, saveHighlights } from "./content-cache.js";

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
const highlightToolbarEl = document.getElementById("highlight-toolbar");

/** Id of the article currently loaded — set once in load(), read by the highlight handlers below. */
let currentItemId = null;
/** In-memory copy of the current article's highlights, kept in sync with chrome.storage.local. @type {import("./content-cache.js").Highlight[]} */
let highlights = [];

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

// --- Highlights -------------------------------------------------------
//
// The cached article HTML never changes after extraction, so a highlight
// can be anchored by plain character offsets into #article-content's
// rendered text — no need for anything more elaborate (e.g. XPath ranges),
// which mostly exist to survive a live page's DOM changing between visits.

/** Collects #article-content's text nodes in document order. */
function getTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

/**
 * @param {Node} root
 * @param {Range} range
 * @returns {{ start: number, end: number } | null}
 */
function rangeToOffsets(root, range) {
  let offset = 0;
  let start = null;
  let end = null;
  for (const node of getTextNodes(root)) {
    const len = node.nodeValue.length;
    if (start === null && node === range.startContainer) start = offset + range.startOffset;
    if (node === range.endContainer) {
      end = offset + range.endOffset;
      break;
    }
    offset += len;
  }
  return start !== null && end !== null ? { start, end } : null;
}

/**
 * Wraps the text at [start, end) of `root`'s text content in a <mark>,
 * splitting text nodes as needed. Re-walks `root` fresh each call — safe to
 * call once per highlight in a loop, since wrapping never changes overall
 * character count or order, only which element a given text node sits in.
 * @param {Node} root
 * @param {number} start
 * @param {number} end
 * @param {(mark: HTMLElement) => void} configureMark
 */
function wrapOffsetRange(root, start, end, configureMark) {
  let offset = 0;
  for (const node of getTextNodes(root)) {
    const len = node.nodeValue.length;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    offset += len;
    if (nodeEnd <= start || nodeStart >= end) continue;

    const overlapStart = Math.max(start, nodeStart) - nodeStart;
    const overlapEnd = Math.min(end, nodeEnd) - nodeStart;
    const before = node.nodeValue.slice(0, overlapStart);
    const middle = node.nodeValue.slice(overlapStart, overlapEnd);
    const after = node.nodeValue.slice(overlapEnd);

    const mark = document.createElement("mark");
    mark.className = "rl-highlight";
    mark.textContent = middle;
    configureMark(mark);

    const parent = node.parentNode;
    const afterNode = after ? document.createTextNode(after) : null;
    parent.insertBefore(mark, node.nextSibling);
    if (afterNode) parent.insertBefore(afterNode, mark.nextSibling);
    node.nodeValue = before;
  }
}

function applyHighlights() {
  for (const highlight of [...highlights].sort((a, b) => a.start - b.start)) {
    wrapOffsetRange(contentEl, highlight.start, highlight.end, (mark) => {
      mark.dataset.highlightId = highlight.id;
      mark.classList.toggle("has-note", Boolean(highlight.note));
    });
  }
}

function hideHighlightToolbar() {
  highlightToolbarEl.classList.remove("is-visible");
}

document.addEventListener("mouseup", (event) => {
  if (!contentEl.contains(event.target)) {
    hideHighlightToolbar();
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    hideHighlightToolbar();
    return;
  }
  const range = selection.getRangeAt(0);
  if (!contentEl.contains(range.commonAncestorContainer)) {
    hideHighlightToolbar();
    return;
  }

  const rect = range.getBoundingClientRect();
  highlightToolbarEl.style.left = `${rect.left + rect.width / 2}px`;
  highlightToolbarEl.style.top = `${rect.top - 8}px`;
  highlightToolbarEl.classList.add("is-visible");
});

highlightToolbarEl.addEventListener("mousedown", (event) => {
  // Prevent this click from collapsing the selection before its own
  // mouseup fires — a plain click on any other element does that by default.
  event.preventDefault();
});

highlightToolbarEl.addEventListener("click", async () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const offsets = rangeToOffsets(contentEl, selection.getRangeAt(0));
  hideHighlightToolbar();
  selection.removeAllRanges();
  if (!offsets || offsets.start === offsets.end) return;

  const highlight = {
    id: crypto.randomUUID(),
    start: offsets.start,
    end: offsets.end,
    text: contentEl.textContent.slice(offsets.start, offsets.end),
    note: null,
    createdAt: Date.now(),
  };
  highlights.push(highlight);
  await saveHighlights(currentItemId, highlights);
  wrapOffsetRange(contentEl, highlight.start, highlight.end, (mark) => {
    mark.dataset.highlightId = highlight.id;
  });
});

let activePopoverEl = null;

function closeHighlightPopover() {
  activePopoverEl?.remove();
  activePopoverEl = null;
}

function openHighlightPopover(mark, highlight) {
  closeHighlightPopover();

  const popover = document.createElement("div");
  popover.className = "rl-highlight-popover";

  const quote = document.createElement("p");
  quote.className = "quote";
  quote.textContent = `"${highlight.text}"`;

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Add a note…";
  textarea.value = highlight.note || "";

  const actions = document.createElement("div");
  actions.className = "actions";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", async () => {
    highlights = highlights.filter((h) => h.id !== highlight.id);
    await saveHighlights(currentItemId, highlights);
    mark.replaceWith(...mark.childNodes);
    contentEl.normalize(); // merges the text node(s) left behind back together
    closeHighlightPopover();
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "save-btn";
  saveBtn.textContent = "Save note";
  saveBtn.addEventListener("click", async () => {
    highlight.note = textarea.value.trim() || null;
    await saveHighlights(currentItemId, highlights);
    mark.classList.toggle("has-note", Boolean(highlight.note));
    closeHighlightPopover();
  });

  actions.append(removeBtn, saveBtn);
  popover.append(quote, textarea, actions);
  document.body.appendChild(popover);

  const rect = mark.getBoundingClientRect();
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 256)}px`;
  popover.style.top = `${rect.bottom + 8}px`;

  activePopoverEl = popover;
}

contentEl.addEventListener("click", (event) => {
  const mark = event.target.closest(".rl-highlight");
  if (!mark) return;
  const highlight = highlights.find((h) => h.id === mark.dataset.highlightId);
  if (highlight) openHighlightPopover(mark, highlight);
});

document.addEventListener("click", (event) => {
  if (!activePopoverEl || activePopoverEl.contains(event.target) || event.target.closest(".rl-highlight")) return;
  closeHighlightPopover();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeHighlightPopover();
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

  currentItemId = itemId;

  const [items, snapshot, storedHighlights] = await Promise.all([
    getReadingList(),
    getArticleSnapshot(itemId),
    getHighlights(itemId),
  ]);
  const item = items.find((i) => i.id === itemId);
  highlights = storedHighlights;

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
  applyHighlights();
  metaEl.classList.add("is-visible");
  settingsBtn.classList.add("is-visible");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

load();
