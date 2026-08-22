import { getSettings, saveSettings, getReadingList, importReadingListItems } from "./storage.js";

const fabToggle = document.getElementById("fab-toggle");
const contextMenuToggle = document.getElementById("context-menu-toggle");
const shortcutsBtn = document.getElementById("shortcuts-btn");
const exportBtn = document.getElementById("export-btn");
const importInput = document.getElementById("import-input");
const importStatusEl = document.getElementById("import-status");
const statusEl = document.getElementById("status");

let statusHideTimer = null;

function showSaved() {
  statusEl.textContent = chrome.i18n.getMessage("statusSaved");
  statusEl.classList.add("is-visible");
  clearTimeout(statusHideTimer);
  statusHideTimer = setTimeout(() => {
    statusEl.classList.remove("is-visible");
  }, 1200);
}

async function load() {
  const settings = await getSettings();
  fabToggle.checked = settings.fabEnabled;
  contextMenuToggle.checked = settings.contextMenuEnabled;
}

fabToggle.addEventListener("change", async () => {
  await saveSettings({ fabEnabled: fabToggle.checked });
  showSaved();
});

contextMenuToggle.addEventListener("change", async () => {
  await saveSettings({ contextMenuEnabled: contextMenuToggle.checked });
  showSaved();
});

// chrome://extensions/shortcuts can't be linked to with a plain <a href>;
// Chrome only allows navigating there from an explicit extension action
// like this, via the tabs API.
shortcutsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

function showImportStatus(message, isError = false) {
  importStatusEl.textContent = message;
  importStatusEl.classList.add("is-visible");
  importStatusEl.classList.toggle("is-error", isError);
}

exportBtn.addEventListener("click", async () => {
  const items = await getReadingList();
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `read-later-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showSaved();
});

/**
 * Minimal CSV parser (handles quoted fields, escaped quotes, and CRLF/LF)
 * — enough for Pocket's export format without pulling in a dependency.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

/**
 * Parses a Pocket-style CSV export (header row: title,url,time_added,tags,status)
 * into the shape importReadingListItems expects. Column order is looked up
 * by header name rather than assumed, so minor format variations still work.
 * @param {string} text
 * @returns {Array<{ url: string, title: string, addedAt: number, readStatus: boolean, tags: string[] }> | null}
 */
function parsePocketCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const urlCol = header.indexOf("url");
  if (urlCol === -1) return null; // doesn't look like a Pocket export

  const titleCol = header.indexOf("title");
  const timeCol = header.indexOf("time_added");
  const statusCol = header.indexOf("status");
  const tagsCol = header.indexOf("tags");

  return rows.slice(1).map((row) => {
    const timeAddedSeconds = timeCol !== -1 ? Number(row[timeCol]) : NaN;
    return {
      url: row[urlCol],
      title: titleCol !== -1 ? row[titleCol] : undefined,
      addedAt: Number.isFinite(timeAddedSeconds) ? timeAddedSeconds * 1000 : undefined,
      readStatus: statusCol !== -1 && /archive/i.test(row[statusCol] || ""),
      // Pocket separates multiple tags on one row with "|".
      tags: tagsCol !== -1 ? (row[tagsCol] || "").split("|").map((t) => t.trim()).filter(Boolean) : [],
    };
  });
}

/**
 * Parses a browser bookmarks export (the "Netscape Bookmark File Format"
 * every major browser produces from its own bookmark manager) into the
 * shape importReadingListItems expects. Flat: every <a href> becomes an
 * item, regardless of which folder it sits in — the format's folder
 * nesting isn't structured identically enough across browsers to reliably
 * derive a tag from it without risking a mis-association.
 * @param {string} text
 * @returns {Array<{ url: string, title?: string, favIconUrl: string, addedAt?: number }> | null}
 */
function parseBookmarksHtml(text) {
  if (!/<!DOCTYPE NETSCAPE-Bookmark-file-1>/i.test(text)) return null; // doesn't look like a bookmarks export

  const doc = new DOMParser().parseFromString(text, "text/html");
  return [...doc.querySelectorAll("a[href]")].map((link) => {
    const addDateSeconds = Number(link.getAttribute("add_date"));
    return {
      url: link.getAttribute("href"),
      title: link.textContent.trim() || undefined,
      favIconUrl: link.getAttribute("icon") || "",
      addedAt: Number.isFinite(addDateSeconds) && addDateSeconds > 0 ? addDateSeconds * 1000 : undefined,
    };
  });
}

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;

  const text = await file.text();
  let rawItems = null;

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rawItems = parsed;
  } catch {
    // Not JSON — fall through to the bookmarks/CSV attempts below.
  }

  if (!rawItems) rawItems = parseBookmarksHtml(text);
  if (!rawItems) rawItems = parsePocketCsv(text);

  if (!rawItems || rawItems.length === 0) {
    showImportStatus(chrome.i18n.getMessage("importErrorNoArticles"), true);
    importInput.value = "";
    return;
  }

  try {
    const { added, skipped, total, usage } = await importReadingListItems(rawItems);
    const summary = chrome.i18n.getMessage("importSummary", [String(added), String(skipped), String(total)]);
    if (usage?.isNearLimit) {
      showImportStatus(chrome.i18n.getMessage("importSummaryNearLimit", [summary, String(usage.percentUsed)]), true);
    } else {
      showImportStatus(summary);
    }
  } catch (error) {
    showImportStatus(chrome.i18n.getMessage("importFailed", [error.message]), true);
  } finally {
    importInput.value = "";
  }
});

document.addEventListener("DOMContentLoaded", load);
