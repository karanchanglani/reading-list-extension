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
const ITEM_KEY_PREFIX = "item_";
const LEGACY_STORAGE_KEY = "readingList"; // old single-blob format

// chrome.storage.sync hard limits (see chrome.storage.sync.QUOTA_BYTES*).
// A single oversized item (e.g. a data: URL favicon) can still blow the
// per-item quota on its own, so we guard against that at write time.
const SYNC_QUOTA_BYTES_PER_ITEM = chrome.storage.sync.QUOTA_BYTES_PER_ITEM ?? 8192;

/**
 * @typedef {Object} ReadingListItem
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} favIconUrl
 * @property {number} addedAt - epoch ms
 * @property {boolean} readStatus - false = unread, true = read
 */

function itemKey(id) {
  return `${ITEM_KEY_PREFIX}${id}`;
}

/**
 * @param {{ url: string, title?: string, favIconUrl?: string }} source
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
 * @param {{ url: string, title?: string, favIconUrl?: string }} source
 * @returns {Promise<{ added: boolean, item: ReadingListItem, list: ReadingListItem[] }>}
 */
export async function addToReadingList(source) {
  if (!source?.url || !/^https?:/i.test(source.url)) {
    throw new Error("Only http(s) pages can be saved.");
  }

  const ids = await getIndex();
  const existingItems = await getItemsByIds(ids);

  const existing = findByUrl(existingItems, source.url);
  if (existing) {
    return { added: false, item: existing, list: existingItems };
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

  return { added: true, item, list: [item, ...existingItems] };
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

  await chrome.storage.sync.set({ [itemKey(id)]: { ...existing, ...changes } });
  return getItemsByIds(ids);
}
