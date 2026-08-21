import {
  INDEX_KEY,
  SETTINGS_KEY,
  getReadingList,
  addToReadingList,
  removeFromReadingList,
  updateReadingListItem,
  findByUrl,
  migrateLegacyStorage,
  getSettings,
} from "./storage.js";
import { saveArticleSnapshot, removeArticleSnapshot } from "./content-cache.js";

const BADGE_IDLE_COLOR = "#4f46e5"; // indigo — normal unread count
const BADGE_SUCCESS_COLOR = "#16a34a"; // green — item added
const BADGE_INFO_COLOR = "#d97706"; // amber — already saved
const BADGE_ERROR_COLOR = "#dc2626"; // red — couldn't save
const BADGE_SUCCESS_TEXT = "SAVED";
const BADGE_FLASH_MS = 1400; // a few beats longer — "SAVED" has more to read than a glyph

const ADD_MENU_ID = "read-later-add"; // right-click on a page or link
const MANAGER_MENU_ID = "read-later-open-manager"; // right-click on the toolbar icon
const QUICK_SAVE_COMMAND = "quick-save";
const MANAGER_URL = "popup.html";

let flashCounter = 0;
let activeFlashToken = 0;

async function renderCountBadge() {
  const items = await getReadingList();
  const count = items.length;
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_IDLE_COLOR });
}

/** Briefly flashes a badge (e.g. "SAVED" on success), then reverts to the item count. */
function flashBadge(text, color, ms = BADGE_FLASH_MS) {
  const token = ++flashCounter;
  activeFlashToken = token;

  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });

  setTimeout(() => {
    if (activeFlashToken === token) {
      activeFlashToken = 0;
      renderCountBadge();
    }
  }, ms);
}

/**
 * Shows an in-page toast on the given tab, if its content script is
 * present. Also carries the item's id/readStatus so the floating button
 * can update its own state (which color, whether double-click-to-mark-read
 * applies) even when the save happened somewhere other than the FAB itself.
 */
function notifyTab(tabId, text, kind, item) {
  if (!tabId) return;
  chrome.tabs.sendMessage(
    tabId,
    { action: "SHOW_TOAST", text, kind, id: item?.id, readStatus: item?.readStatus },
    () => {
      // No content script on this tab (chrome:// pages, the Web Store, a
      // freshly-opened tab that hasn't loaded yet, etc.) — nothing to do.
      void chrome.runtime.lastError;
    }
  );
}

/**
 * Badge text and toast message for a successful new save. Once storage is
 * within 10% of chrome.storage.sync's item/byte ceiling, this swaps the
 * usual "SAVED" flash for the actual percentage and nudges toward Export —
 * quieter than blocking the save, since the item was saved successfully.
 * @param {import("./storage.js").StorageUsage} [usage]
 */
function successFeedback(usage) {
  if (usage?.isNearLimit) {
    return {
      badgeText: `${usage.percentUsed}%`,
      message: `Article added! Storage ${usage.percentUsed}% full — export a backup from Options soon.`,
    };
  }
  return { badgeText: BADGE_SUCCESS_TEXT, message: "Article added!" };
}

/**
 * Adds a page to the reading list and reports the outcome via a badge flash
 * plus an in-page toast (when a tab is available). Used by the entry points
 * that don't already show their own feedback — the keyboard shortcut and
 * the page/link context menu item (the FAB shows its own inline checkmark;
 * the popup shows its own status line).
 * @param {{ url: string, title?: string, favIconUrl?: string }} source
 * @param {number} [tabId]
 */
async function quickSave(source, tabId) {
  try {
    const { added, item, usage } = await addToReadingList(source);
    if (added) {
      const { badgeText, message } = successFeedback(usage);
      flashBadge(badgeText, BADGE_SUCCESS_COLOR);
      notifyTab(tabId, message, "saved", item);
    } else {
      flashBadge("•", BADGE_INFO_COLOR); // already on the list
      notifyTab(tabId, "Already added", "info", item);
    }
  } catch (error) {
    console.error("[Read Later] Quick save failed:", error);
    flashBadge("!", BADGE_ERROR_COLOR);
    notifyTab(tabId, "Couldn't save this page", "error");
  }
}

function quickSaveTab(tab) {
  if (!tab?.url) {
    flashBadge("!", BADGE_ERROR_COLOR);
    return;
  }
  quickSave({ url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl }, tab.id);
}

/** Opens the reading list UI (popup.html) as a standalone app-style window. */
function openManagerWindow() {
  chrome.windows.create(
    {
      url: chrome.runtime.getURL(MANAGER_URL),
      type: "popup",
      width: 400,
      height: 600,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error("[Read Later] Failed to open manager window:", chrome.runtime.lastError.message);
      }
    }
  );
}

function createMenuItem(options) {
  chrome.contextMenus.create(options, () => {
    if (chrome.runtime.lastError) {
      console.error(
        `[Read Later] Failed to create context menu item "${options.id}":`,
        chrome.runtime.lastError.message
      );
    }
  });
}

async function setupContextMenu() {
  const settings = await getSettings();
  chrome.contextMenus.removeAll(() => {
    if (settings.contextMenuEnabled) {
      createMenuItem({
        id: ADD_MENU_ID,
        title: "Add link/page to Reading List",
        contexts: ["page", "link"],
      });
    }
    // Not gated by the same toggle — this opens the manager from the
    // toolbar icon itself, a separate feature from the page/link menu.
    createMenuItem({
      id: MANAGER_MENU_ID,
      title: "Open Reading List Manager",
      contexts: ["action"],
    });
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  // One-time cleanup for lists saved under the old single-key storage
  // format, which capped out at ~8KB total and silently stopped accepting
  // new saves once a list grew past that. No-op if there's nothing to migrate.
  await migrateLegacyStorage();

  renderCountBadge();
  setupContextMenu();

  if (details.reason === "install") {
    // There's no API for an extension to pin itself to the toolbar — that's
    // a deliberate Chrome restriction — so the best we can do is ask.
    chrome.notifications.create("read-later-pin-nudge", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Read Later is installed",
      message:
        "Click the puzzle-piece icon in Chrome's toolbar and pin Read Later so it stays right next to the address bar.",
      priority: 1,
    });

    chrome.tabs.create({ url: "welcome.html" });
  }
});

chrome.runtime.onStartup.addListener(() => {
  renderCountBadge();
});

// Keep the badge count in sync if the list changes from any source
// (popup edits, another synced device, etc.) while we're not mid-flash.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;

  if (changes[INDEX_KEY] && !activeFlashToken) {
    renderCountBadge();
  }

  // Options page (or another synced device) toggled a setting — re-apply
  // the context menu immediately rather than waiting for the next reload.
  if (changes[SETTINGS_KEY]) {
    setupContextMenu();
  }
});

// Note: there's no chrome.action.onClicked listener — default_popup is set
// in the manifest, so clicking the toolbar icon always opens popup.html
// (the reading list), and Chrome never fires onClicked while a popup is set.

// Keyboard shortcut (Ctrl+Shift+S by default on every platform, user-
// configurable at chrome://extensions/shortcuts) — saves the active tab
// without opening the popup. Chrome 96+ passes the active tab as the
// second argument.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== QUICK_SAVE_COMMAND) return;

  if (tab) {
    quickSaveTab(tab);
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
      quickSaveTab(activeTab);
    });
  }
});

// Right-click menu — either on the page/a link, or (via contexts: ["action"])
// on the toolbar icon itself, where it opens the full manager window.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MANAGER_MENU_ID) {
    openManagerWindow();
    return;
  }

  if (info.menuItemId !== ADD_MENU_ID) return;

  const isLink = Boolean(info.linkUrl);
  const url = info.linkUrl || info.pageUrl || tab?.url;

  if (!url) {
    flashBadge("!", BADGE_ERROR_COLOR);
    return;
  }

  quickSave(
    {
      url,
      // For a link we only have its URL, not a page title — storage.js
      // falls back to the URL itself when title is omitted.
      title: isLink ? undefined : tab?.title,
      favIconUrl: isLink ? undefined : tab?.favIconUrl,
    },
    tab?.id
  );
});

// Lets the content script (the floating button) check on page load whether
// the current URL is already saved, so it can render its saved/unread/read
// state up front instead of only finding out after the user clicks it.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== "CHECK_IS_SAVED") {
    return false;
  }

  getReadingList()
    .then((items) => {
      const match = findByUrl(items, message.url);
      sendResponse({
        ok: true,
        saved: Boolean(match),
        id: match?.id ?? null,
        readStatus: Boolean(match?.readStatus),
      });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

// Lets the content script toggle read/unread from a double-click on the
// floating button, without needing direct storage access.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== "TOGGLE_READ_STATUS") {
    return false;
  }

  updateReadingListItem(message.id, { readStatus: Boolean(message.readStatus) })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

// Lets the content script remove an item after a 2.5s press-and-hold on the
// floating button, without needing direct storage access.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== "REMOVE_FROM_READING_LIST") {
    return false;
  }

  Promise.all([removeFromReadingList(message.id), removeArticleSnapshot(message.id)])
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== "ADD_TO_READING_LIST") {
    return false; // not for us — let other listeners handle it
  }

  const source = message.payload || {};
  const page = {
    url: source.url,
    title: source.title,
    favIconUrl: source.favIconUrl,
    hasSnapshot: Boolean(source.snapshot),
  };

  addToReadingList(page)
    .then(async ({ added, item, list, usage }) => {
      // Only cache the snapshot for a genuinely new save — re-saving an
      // already-saved page doesn't refresh its cached content in this
      // first pass, so a stale re-extraction here can't overwrite it.
      if (added && source.snapshot) {
        await saveArticleSnapshot(item.id, source.snapshot).catch((error) => {
          console.error("[Read Later] Failed to cache article snapshot:", error);
        });
      }

      if (added) {
        flashBadge(successFeedback(usage).badgeText, BADGE_SUCCESS_COLOR);
      } else {
        flashBadge("•", BADGE_INFO_COLOR);
      }
      sendResponse({ ok: true, added, item, count: list.length, usage });
    })
    .catch((error) => {
      console.error("[Read Later] Failed to add page:", error);
      flashBadge("!", BADGE_ERROR_COLOR);
      sendResponse({ ok: false, error: error.message });
    });

  return true; // keep the message channel open for the async sendResponse
});
