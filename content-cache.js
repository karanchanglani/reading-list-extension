// Cached article content — the readable snapshot Readability extracts at
// save time, keyed by reading-list item id.
//
// This deliberately lives in chrome.storage.local, not chrome.storage.sync:
// full article HTML/text is easily tens of KB per article, far past sync's
// ~8KB-per-key limit that storage.js's reading-list items are built around.
// local's quota is much larger (~10MB by default) and, unlike sync, isn't
// shared across devices — snapshots are a local cache, not synced data; the
// reading-list metadata in storage.js (including the `hasSnapshot` flag)
// stays the single source of truth for what's actually saved.

const SNAPSHOT_KEY_PREFIX = "snapshot_";

/**
 * @typedef {Object} ArticleSnapshot
 * @property {string} title
 * @property {string | null} byline
 * @property {string | null} siteName
 * @property {string} content - sanitized article HTML, as produced by Readability
 * @property {string} textContent - plain text, for reading-time estimation
 * @property {string} excerpt
 * @property {number} length - character count of textContent
 * @property {number} readingTimeMinutes
 * @property {number} cachedAt - epoch ms
 */

function snapshotKey(id) {
  return `${SNAPSHOT_KEY_PREFIX}${id}`;
}

/**
 * @param {string} id
 * @param {ArticleSnapshot} snapshot
 */
export async function saveArticleSnapshot(id, snapshot) {
  await chrome.storage.local.set({ [snapshotKey(id)]: snapshot });
}

/**
 * @param {string} id
 * @returns {Promise<ArticleSnapshot | null>}
 */
export async function getArticleSnapshot(id) {
  const result = await chrome.storage.local.get(snapshotKey(id));
  return result[snapshotKey(id)] || null;
}

/**
 * Batched read of multiple snapshots in one chrome.storage.local.get call —
 * used by the Manager's content search, which needs many snapshots' text at
 * once rather than one item at a time.
 * @param {string[]} ids
 * @returns {Promise<Map<string, ArticleSnapshot>>} only ids with a cached snapshot are present
 */
export async function getArticleSnapshots(ids) {
  if (ids.length === 0) return new Map();
  const stored = await chrome.storage.local.get(ids.map(snapshotKey));
  const result = new Map();
  for (const id of ids) {
    const snap = stored[snapshotKey(id)];
    if (snap) result.set(id, snap);
  }
  return result;
}

/** @param {string} id */
export async function removeArticleSnapshot(id) {
  await chrome.storage.local.remove(snapshotKey(id));
}

// Highlights — user-created marks (with an optional note) over a cached
// snapshot's text, keyed by reading-list item id. Also chrome.storage.local,
// alongside the snapshot they annotate: small, but tied to the same cached
// content and equally irrelevant to sync across devices.

const HIGHLIGHTS_KEY_PREFIX = "highlights_";

/**
 * @typedef {Object} Highlight
 * @property {string} id
 * @property {number} start - character offset into the snapshot's rendered text (inclusive)
 * @property {number} end - character offset into the snapshot's rendered text (exclusive)
 * @property {string} text - the highlighted text itself, snapshotted at creation time
 * @property {string | null} note
 * @property {number} createdAt - epoch ms
 */

function highlightsKey(id) {
  return `${HIGHLIGHTS_KEY_PREFIX}${id}`;
}

/**
 * @param {string} id
 * @returns {Promise<Highlight[]>}
 */
export async function getHighlights(id) {
  const result = await chrome.storage.local.get(highlightsKey(id));
  return result[highlightsKey(id)] || [];
}

/**
 * @param {string} id
 * @param {Highlight[]} highlights
 */
export async function saveHighlights(id, highlights) {
  await chrome.storage.local.set({ [highlightsKey(id)]: highlights });
}

/** @param {string} id */
export async function removeHighlights(id) {
  await chrome.storage.local.remove(highlightsKey(id));
}
