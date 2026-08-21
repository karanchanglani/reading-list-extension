// Shared storage utilities for the Read Later reading list.
// Backed by chrome.storage.sync so the list follows the user across devices.
// Imported as an ES module by both background.js (service worker) and popup.js.
//
// Each article is stored under its OWN key (`item_<id>`), with a separate
// `readingListIndex` key holding just the ordered list of ids. This is
// deliberate: chrome.storage.sync caps any single key at ~8KB
// (QUOTA_BYTES_PER_ITEM). An earlier version stored the entire list as one
// JSON array under one key, so the effective capacity was "however many
// articles fit in 8KB total" — every save after that silently failed once
// the array crossed the limit. Splitting into one key per item means the
// only thing that has to fit in 8KB is a single article's metadata.

export const INDEX_KEY = "readingListIndex";
export const SETTINGS_KEY = "settings";
const ITEM_KEY_PREFIX = "item_";
const LEGACY_STORAGE_KEY = "readingList"; // old single-blob format

/** @typedef {"manual" | "newest" | "oldest" | "unread" | "az"} SortMode */

/**
 * @typedef {Object} Settings
 * @property {boolean} fabEnabled - show the on-page floating save button
 * @property {boolean} contextMenuEnabled - show "Add link/page to Reading List" on right-click
 * @property {SortMode} sortMode - how the popup's Reading List Manager orders items
 */
export const DEFAULT_SETTINGS = {
  fabEnabled: true,
  contextMenuEnabled: true,
  sortMode: "manual",
};

// chrome.storage.sync hard limits (see chrome.storage.sync.QUOTA_BYTES*).
// A single oversized item (e.g. a data: URL favicon) can still blow the
// per-item quota on its own, so we guard against that at write time.
const SYNC_QUOTA_BYTES_PER_ITEM = chrome.storage.sync.QUOTA_BYTES_PER_ITEM ?? 8192;

// MAX_ITEMS caps the total number of *keys* in sync storage, not just
// reading-list items — INDEX_KEY and SETTINGS_KEY each take one of those
// slots too, on top of one key per article.
const SYNC_MAX_ITEMS = chrome.storage.sync.MAX_ITEMS ?? 512;
const SYNC_QUOTA_BYTES_TOTAL = chrome.storage.sync.QUOTA_BYTES ?? 102400;
const RESERVED_KEYS = 2; // INDEX_KEY + SETTINGS_KEY
const NEAR_LIMIT_RATIO = 0.9;

/**
 * @typedef {Object} StorageUsage
 * @property {number} itemCount
 * @property {number} maxItems - article ceiling, accounting for this extension's own reserved keys
 * @property {number} bytesInUse
 * @property {number} quotaBytes
 * @property {boolean} isNearLimit - true once within 10% of either ceiling
 * @property {number} percentUsed - the higher of the two ratios, as a rounded percentage
 */

/** @returns {Promise<StorageUsage>} */
export async function getStorageUsage() {
  const ids = await getIndex();
  const maxItems = SYNC_MAX_ITEMS - RESERVED_KEYS;
  const bytesInUse = await chrome.storage.sync.getBytesInUse(null);

  const itemRatio = ids.length / maxItems;
  const byteRatio = bytesInUse / SYNC_QUOTA_BYTES_TOTAL;

  return {
    itemCount: ids.length,
    maxItems,
    bytesInUse,
    quotaBytes: SYNC_QUOTA_BYTES_TOTAL,
    isNearLimit: itemRatio >= NEAR_LIMIT_RATIO || byteRatio >= NEAR_LIMIT_RATIO,
    percentUsed: Math.round(Math.max(itemRatio, byteRatio) * 100),
  };
}

/**
 * @typedef {Object} ReadingListItem
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} favIconUrl
 * @property {number} addedAt - epoch ms
 * @property {boolean} readStatus - false = unread, true = read
 * @property {boolean} hasSnapshot - true if a readable content-cache.js snapshot exists for this id
 * @property {string[]} tags - user-assigned labels, e.g. ["recipes", "long-read"]
 */

function itemKey(id) {
  return `${ITEM_KEY_PREFIX}${id}`;
}

/** @param {unknown} tags @returns {string[]} */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  for (const raw of tags) {
    const tag = typeof raw === "string" ? raw.trim() : "";
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/**
 * @param {{ url: string, title?: string, favIconUrl?: string, hasSnapshot?: boolean, tags?: string[] }} source
 * @returns {ReadingListItem}
 */
export function createReadingListItem(source) {
  return {
    id: crypto.randomUUID(),
    url: source.url,
    title: source.title?.trim() || source.url,
    favIconUrl: source.favIconUrl || "",
    addedAt: Date.now(),
    readStatus: false,
    hasSnapshot: Boolean(source.hasSnapshot),
    tags: normalizeTags(source.tags),
  };
}

async function getIndex() {
  const result = await chrome.storage.sync.get(INDEX_KEY);
  return result[INDEX_KEY] || [];
}

/** @param {string[]} ids @returns {Promise<ReadingListItem[]>} */
async function getItemsByIds(ids) {
  if (ids.length === 0) return [];
  const stored = await chrome.storage.sync.get(ids.map(itemKey));
  // Filter out any id whose item record is missing (e.g. storage desync)
  // rather than surfacing a hole in the list as a rendering bug.
  return ids.map((id) => stored[itemKey(id)]).filter(Boolean);
}

/** @returns {Promise<ReadingListItem[]>} */
export async function getReadingList() {
  return getItemsByIds(await getIndex());
}

/**
 * One-time cleanup for lists saved before the per-item storage split. Reads
 * the old single-key array (if any), fans it out into the new per-item
 * keys, and removes the legacy key. Safe to call on every startup — it's a
 * no-op once the legacy key is gone.
 */
export async function migrateLegacyStorage() {
  const { [LEGACY_STORAGE_KEY]: legacyItems } = await chrome.storage.sync.get(LEGACY_STORAGE_KEY);
  if (!Array.isArray(legacyItems) || legacyItems.length === 0) {
    if (legacyItems !== undefined) await chrome.storage.sync.remove(LEGACY_STORAGE_KEY);
    return;
  }

  const existingIds = await getIndex();
  const seen = new Set(existingIds);
  const newIds = [...existingIds];
  const writes = {};

  for (const item of legacyItems) {
    if (!item?.id || seen.has(item.id)) continue;
    writes[itemKey(item.id)] = item;
    newIds.push(item.id);
    seen.add(item.id);
  }

  writes[INDEX_KEY] = newIds;
  await chrome.storage.sync.set(writes);
  await chrome.storage.sync.remove(LEGACY_STORAGE_KEY);
}

/**
 * Normalizes a URL for duplicate comparison (ignores a trailing slash and
 * any #fragment, since those rarely indicate a meaningfully different page).
 * @param {string} url
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * @param {ReadingListItem[]} items
 * @param {string} url
 * @returns {ReadingListItem | undefined}
 */
export function findByUrl(items, url) {
  const target = normalizeUrl(url);
  return items.find((item) => normalizeUrl(item.url) === target);
}

/**
 * Adds a page to the reading list, skipping it if the URL is already saved.
 * @param {{ url: string, title?: string, favIconUrl?: string, hasSnapshot?: boolean }} source
 * @returns {Promise<{ added: boolean, item: ReadingListItem, list: ReadingListItem[], usage: StorageUsage }>}
 */
export async function addToReadingList(source) {
  if (!source?.url || !/^https?:/i.test(source.url)) {
    throw new Error("Only http(s) pages can be saved.");
  }

  const ids = await getIndex();
  const existingItems = await getItemsByIds(ids);

  const existing = findByUrl(existingItems, source.url);
  if (existing) {
    return { added: false, item: existing, list: existingItems, usage: await getStorageUsage() };
  }

  const item = createReadingListItem(source);
  const bytes = new TextEncoder().encode(JSON.stringify(item)).length;
  if (bytes > SYNC_QUOTA_BYTES_PER_ITEM) {
    // Extremely long title/favicon data URL — drop the favicon rather than
    // failing the save outright.
    item.favIconUrl = "";
  }

  await chrome.storage.sync.set({
    [INDEX_KEY]: [item.id, ...ids],
    [itemKey(item.id)]: item,
  });

  return { added: true, item, list: [item, ...existingItems], usage: await getStorageUsage() };
}

/**
 * @param {string} id
 * @returns {Promise<ReadingListItem[]>}
 */
export async function removeFromReadingList(id) {
  const ids = await getIndex();
  const newIds = ids.filter((existingId) => existingId !== id);

  await chrome.storage.sync.remove(itemKey(id));
  await chrome.storage.sync.set({ [INDEX_KEY]: newIds });

  return getItemsByIds(newIds);
}

/**
 * @param {string} id
 * @param {Partial<ReadingListItem>} changes
 * @returns {Promise<ReadingListItem[]>}
 */
export async function updateReadingListItem(id, changes) {
  const ids = await getIndex();
  const result = await chrome.storage.sync.get(itemKey(id));
  const existing = result[itemKey(id)];
  if (!existing) return getItemsByIds(ids);

  const normalizedChanges = "tags" in changes ? { ...changes, tags: normalizeTags(changes.tags) } : changes;
  await chrome.storage.sync.set({ [itemKey(id)]: { ...existing, ...normalizedChanges } });
  return getItemsByIds(ids);
}

/**
 * Removes multiple items in a single batched write — used by the popup's
 * bulk-delete action, so selecting dozens of items doesn't fire one
 * chrome.storage.sync write per item (see importReadingListItems for the
 * same MAX_WRITE_OPERATIONS_PER_MINUTE concern on the write side).
 * @param {string[]} ids
 * @returns {Promise<ReadingListItem[]>}
 */
export async function removeManyFromReadingList(ids) {
  const idSet = new Set(ids);
  const currentIds = await getIndex();
  const newIds = currentIds.filter((id) => !idSet.has(id));

  await chrome.storage.sync.remove(ids.map(itemKey));
  await chrome.storage.sync.set({ [INDEX_KEY]: newIds });

  return getItemsByIds(newIds);
}

/**
 * Applies the same field changes (e.g. { readStatus: true }) to multiple
 * items in a single batched write. See removeManyFromReadingList for why
 * batching matters here.
 * @param {string[]} ids
 * @param {Partial<ReadingListItem>} changes
 * @returns {Promise<ReadingListItem[]>}
 */
export async function bulkUpdateReadingListItems(ids, changes) {
  const currentIds = await getIndex();
  const existingItems = await getItemsByIds(ids);
  const normalizedChanges = "tags" in changes ? { ...changes, tags: normalizeTags(changes.tags) } : changes;

  const writes = {};
  for (const item of existingItems) {
    writes[itemKey(item.id)] = { ...item, ...normalizedChanges };
  }
  await chrome.storage.sync.set(writes);

  return getItemsByIds(currentIds);
}

/**
 * Persists a manually-reordered list (e.g. after a drag-and-drop reorder in
 * the popup) by rewriting the index key with the new id order. Any id the
 * caller didn't include — e.g. an item another synced device added mid-drag
 * — is appended at the end rather than silently dropped.
 * @param {string[]} orderedIds
 * @returns {Promise<ReadingListItem[]>}
 */
export async function reorderReadingList(orderedIds) {
  const currentIds = await getIndex();
  const currentSet = new Set(currentIds);
  const deduped = orderedIds.filter((id) => currentSet.has(id));
  const missing = currentIds.filter((id) => !deduped.includes(id));
  const newIds = [...deduped, ...missing];

  await chrome.storage.sync.set({ [INDEX_KEY]: newIds });
  return getItemsByIds(newIds);
}

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

/**
 * @param {Partial<Settings>} changes
 * @returns {Promise<Settings>}
 */
export async function saveSettings(changes) {
  const next = { ...(await getSettings()), ...changes };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Bulk-imports items (from an export of this extension, or a Pocket-style
 * CSV export), deduping by URL against what's already saved. Unlike calling
 * addToReadingList in a loop, this does a single chrome.storage.sync.set
 * for the whole batch — a large import (hundreds of items) done one write
 * per item would risk tripping sync's MAX_WRITE_OPERATIONS_PER_MINUTE.
 * @param {Array<{ url?: string, title?: string, favIconUrl?: string, addedAt?: number, readStatus?: boolean, tags?: string[] }>} rawItems
 * @returns {Promise<{ added: number, skipped: number, total: number, usage: StorageUsage }>}
 */
export async function importReadingListItems(rawItems) {
  const ids = await getIndex();
  const existingItems = await getItemsByIds(ids);
  const seenUrls = new Set(existingItems.map((item) => normalizeUrl(item.url)));

  const newIds = [...ids];
  const writes = {};
  let added = 0;
  let skipped = 0;

  for (const raw of rawItems) {
    if (!raw?.url || !/^https?:/i.test(raw.url)) {
      skipped++;
      continue;
    }
    const key = normalizeUrl(raw.url);
    if (seenUrls.has(key)) {
      skipped++;
      continue;
    }

    const item = {
      id: crypto.randomUUID(),
      url: raw.url,
      title: (typeof raw.title === "string" && raw.title.trim()) || raw.url,
      favIconUrl: typeof raw.favIconUrl === "string" ? raw.favIconUrl : "",
      addedAt: Number.isFinite(raw.addedAt) ? raw.addedAt : Date.now(),
      readStatus: Boolean(raw.readStatus),
      tags: normalizeTags(raw.tags),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(item)).length;
    if (bytes > SYNC_QUOTA_BYTES_PER_ITEM) {
      item.favIconUrl = "";
    }

    writes[itemKey(item.id)] = item;
    newIds.push(item.id);
    seenUrls.add(key);
    added++;
  }

  if (added > 0) {
    writes[INDEX_KEY] = newIds;
    await chrome.storage.sync.set(writes);
  }

  return { added, skipped, total: rawItems.length, usage: await getStorageUsage() };
}
