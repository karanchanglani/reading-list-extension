import {
  getReadingList,
  removeFromReadingList,
  removeManyFromReadingList,
  bulkUpdateReadingListItems,
  updateReadingListItem,
  reorderReadingList,
  findByUrl,
  getStorageUsage,
  getSettings,
  saveSettings,
} from "./storage.js";
import { removeArticleSnapshot, getArticleSnapshots } from "./content-cache.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Static, hand-authored icon shapes (no external icon library needed).
const ICON_SHAPES = {
  check: '<polyline points="4 12 9 17 20 6"></polyline>',
  trash:
    '<line x1="3" y1="6" x2="21" y2="6"></line>' +
    '<rect x="9" y="2" width="6" height="3" rx="0.5"></rect>' +
    '<rect x="6" y="6" width="12" height="15" rx="1"></rect>' +
    '<line x1="10" y1="10" x2="10" y2="18"></line>' +
    '<line x1="14" y1="10" x2="14" y2="18"></line>',
  grip:
    '<circle cx="9" cy="6" r="1.3" style="fill:currentColor;stroke:none"></circle>' +
    '<circle cx="9" cy="12" r="1.3" style="fill:currentColor;stroke:none"></circle>' +
    '<circle cx="9" cy="18" r="1.3" style="fill:currentColor;stroke:none"></circle>' +
    '<circle cx="15" cy="6" r="1.3" style="fill:currentColor;stroke:none"></circle>' +
    '<circle cx="15" cy="12" r="1.3" style="fill:currentColor;stroke:none"></circle>' +
    '<circle cx="15" cy="18" r="1.3" style="fill:currentColor;stroke:none"></circle>',
  reader:
    '<rect x="4" y="3" width="16" height="18" rx="2"></rect>' +
    '<line x1="8" y1="8" x2="16" y2="8"></line>' +
    '<line x1="8" y1="12" x2="16" y2="12"></line>' +
    '<line x1="8" y1="16" x2="13" y2="16"></line>',
  tag:
    '<path d="M12 2h7a1 1 0 0 1 1 1v7a1 1 0 0 1-.29.71l-9 9a1 1 0 0 1-1.42 0l-7-7a1 1 0 0 1 0-1.42l9-9A1 1 0 0 1 12 2Z"></path>' +
    '<circle cx="15.5" cy="7.5" r="1.3" style="fill:currentColor;stroke:none"></circle>',
};

function createIcon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICON_SHAPES[name];
  return svg;
}

const optionsBtn = document.getElementById("options-btn");
const selectModeBtn = document.getElementById("select-mode-btn");
const saveBtn = document.getElementById("save-btn");
const saveBtnLabel = document.getElementById("save-btn-label");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("search-input");
const searchClearBtn = document.getElementById("search-clear");
const sortSelect = document.getElementById("sort-select");
const tagFilterEl = document.getElementById("tag-filter");
const listEl = document.getElementById("list");
const emptyStateEl = document.getElementById("empty-state");
const noResultsEl = document.getElementById("no-results");
const usageInfoEl = document.getElementById("usage-info");
const bulkBarEl = document.getElementById("bulk-bar");
const bulkBarCountEl = document.getElementById("bulk-bar-count");
const bulkBarSelectAllBtn = document.getElementById("bulk-bar-select-all");
const bulkBarMarkReadBtn = document.getElementById("bulk-bar-mark-read");
const bulkBarDeleteBtn = document.getElementById("bulk-bar-delete");

/** Full, unfiltered list — the source of truth for rendering. */
let allItems = [];
/** The active tab's info, prefetched on popup open so "+" saves instantly. */
let currentTab = null;
/** Tag chosen in the tag-filter row, or null for no tag filter. */
let activeTagFilter = null;
/** Id of the item currently showing its inline tag editor, or null. */
let editingTagsId = null;
/** Whether the bulk-select checkboxes/bar are showing. */
let selectMode = false;
/** Ids checked in select mode. */
const selectedIds = new Set();
/** Current sort mode; loaded from settings on startup. @type {import("./storage.js").SortMode} */
let sortMode = "manual";
/** id -> { rawText, lowerText } for cached article snapshots fetched so far this popup session. */
const snapshotTextCache = new Map();

/**
 * Batch-fetches cached snapshot text for any hasSnapshot item not already in
 * snapshotTextCache. A no-op (no storage read) once everything currently
 * known is cached, so only the first search keystroke each session pays for
 * a chrome.storage.local read — every keystroke after that is synchronous.
 */
async function ensureSnapshotTextLoaded() {
  const missingIds = allItems
    .filter((item) => item.hasSnapshot && !snapshotTextCache.has(item.id))
    .map((item) => item.id);
  if (missingIds.length === 0) return;

  const snapshots = await getArticleSnapshots(missingIds);
  for (const [id, snapshot] of snapshots) {
    const rawText = snapshot.textContent || "";
    snapshotTextCache.set(id, { rawText, lowerText: rawText.toLowerCase() });
  }
}

/** @returns {boolean} true if `item`'s title matches `query` (already lowercased). */
function titleMatches(item, query) {
  return (item.title || "").toLowerCase().includes(query);
}

/** @returns {boolean} true if `item` matches `query` (already lowercased) by title or cached article text. */
function matchesQuery(item, query) {
  if (titleMatches(item, query)) return true;
  return Boolean(snapshotTextCache.get(item.id)?.lowerText.includes(query));
}

/**
 * Builds DOM nodes for a one-line excerpt around the first match of `query`
 * inside `cached.rawText`, with the matched substring wrapped in <mark>.
 * Built from text nodes rather than innerHTML so article-derived text can
 * never be interpreted as markup.
 * @param {{ rawText: string, lowerText: string }} cached
 * @param {string} query already lowercased
 * @returns {Node[] | null}
 */
function buildSnippetNodes(cached, query) {
  const idx = cached.lowerText.indexOf(query);
  if (idx === -1) return null;

  const start = Math.max(0, idx - 40);
  const end = Math.min(cached.rawText.length, idx + query.length + 60);
  const before = (start > 0 ? "…" : "") + cached.rawText.slice(start, idx);
  const match = cached.rawText.slice(idx, idx + query.length);
  const after = cached.rawText.slice(idx + query.length, end) + (end < cached.rawText.length ? "…" : "");

  const mark = document.createElement("mark");
  mark.textContent = match;
  return [document.createTextNode(before), mark, document.createTextNode(after)];
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function showStatus(message, ms = 1800) {
  statusEl.textContent = message;
  if (ms) {
    setTimeout(() => {
      if (statusEl.textContent === message) statusEl.textContent = "";
    }, ms);
  }
}

function getFilteredItems() {
  const query = searchInput.value.trim().toLowerCase();
  return allItems.filter((item) => {
    if (query && !matchesQuery(item, query)) return false;
    if (activeTagFilter && !(item.tags || []).includes(activeTagFilter)) return false;
    return true;
  });
}

/**
 * Sorts a copy of `items` per the current sort mode. "manual" returns the
 * items as-is — their order already reflects the saved drag order.
 * @param {import("./storage.js").ReadingListItem[]} items
 */
function applySort(items) {
  switch (sortMode) {
    case "newest":
      return [...items].sort((a, b) => b.addedAt - a.addedAt);
    case "oldest":
      return [...items].sort((a, b) => a.addedAt - b.addedAt);
    case "unread":
      // Stable sort: unread items keep their relative order, read items keep theirs.
      return [...items].sort((a, b) => Number(a.readStatus) - Number(b.readStatus));
    case "az":
      return [...items].sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }));
    case "manual":
    default:
      return items;
  }
}

/** Distinct tags across the full list, sorted for a stable chip order. */
function getDistinctTags() {
  const tags = new Set();
  for (const item of allItems) {
    for (const tag of item.tags || []) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function renderTagFilter() {
  const tags = getDistinctTags();
  tagFilterEl.hidden = tags.length === 0;
  if (tags.length === 0) {
    activeTagFilter = null;
    return;
  }
  // The active filter's tag may have been removed from every item since the
  // last render (e.g. the last item wearing it got deleted or re-tagged).
  if (activeTagFilter && !tags.includes(activeTagFilter)) activeTagFilter = null;

  tagFilterEl.innerHTML = "";
  for (const tag of tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.classList.toggle("is-active", tag === activeTagFilter);
    chip.textContent = tag;
    chip.addEventListener("click", () => {
      activeTagFilter = activeTagFilter === tag ? null : tag;
      renderTagFilter();
      renderList();
    });
    tagFilterEl.appendChild(chip);
  }
}

function renderList() {
  const query = searchInput.value.trim();
  const lowerQuery = query.toLowerCase();
  const items = applySort(getFilteredItems());
  // Reordering a filtered or re-sorted view doesn't map cleanly onto the
  // full list's saved order, so dragging only makes sense when the whole
  // list is showing in its manual order and nothing else is mid-edit.
  const reorderable = sortMode === "manual" && !query && !activeTagFilter && !selectMode && !editingTagsId;
  const filtered = Boolean(query || activeTagFilter);

  listEl.innerHTML = "";
  emptyStateEl.hidden = allItems.length > 0;
  noResultsEl.hidden = !(allItems.length > 0 && filtered && items.length === 0);

  for (const item of items) {
    const li = document.createElement("li");
    li.title = item.url;
    li.dataset.id = item.id;
    li.classList.toggle("is-read", Boolean(item.readStatus));
    li.draggable = reorderable;
    if (reorderable) {
      li.addEventListener("dragstart", (event) => {
        if (event.target.closest("button")) {
          event.preventDefault();
          return;
        }
        li.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
      });
      li.addEventListener("dragend", () => {
        li.classList.remove("dragging");
        void persistDomOrder();
      });
    }

    let leadingSlot;
    if (selectMode) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "select-checkbox";
      checkbox.checked = selectedIds.has(item.id);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        toggleSelected(item.id, checkbox.checked);
      });
      leadingSlot = checkbox;
    } else {
      const grip = document.createElement("span");
      grip.className = "grip";
      grip.appendChild(createIcon("grip"));
      leadingSlot = grip;
    }

    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.src = item.favIconUrl || "icons/icon16.png";
    favicon.alt = "";
    favicon.addEventListener("error", () => {
      favicon.src = "icons/icon16.png";
    });

    const info = document.createElement("div");
    info.className = "info";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = item.title || item.url;
    const domain = document.createElement("div");
    domain.className = "domain";
    domain.textContent = getDomain(item.url);
    info.append(title, domain);

    // Only show a match excerpt when the search matched cached article text
    // rather than the title — if the title already matched, it's already
    // visible and an excerpt would be redundant.
    if (query && !titleMatches(item, lowerQuery)) {
      const cached = snapshotTextCache.get(item.id);
      const snippetNodes = cached && buildSnippetNodes(cached, lowerQuery);
      if (snippetNodes) {
        const snippet = document.createElement("div");
        snippet.className = "snippet";
        snippet.append(...snippetNodes);
        info.appendChild(snippet);
      }
    }

    if (editingTagsId === item.id) {
      const tagsInput = document.createElement("input");
      tagsInput.type = "text";
      tagsInput.className = "tags-input";
      tagsInput.placeholder = chrome.i18n.getMessage("tagsInputPlaceholder");
      tagsInput.value = (item.tags || []).join(", ");
      tagsInput.addEventListener("click", (event) => event.stopPropagation());
      tagsInput.addEventListener("mousedown", (event) => event.stopPropagation());
      tagsInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          tagsInput.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          tagsInput.dataset.cancelled = "1";
          tagsInput.blur();
        }
      });
      tagsInput.addEventListener("blur", () => {
        if (tagsInput.dataset.cancelled) {
          cancelEditingTags();
        } else {
          void commitTagsEdit(item.id, tagsInput.value);
        }
      });
      info.appendChild(tagsInput);
      requestAnimationFrame(() => tagsInput.focus());
    } else if (item.tags?.length) {
      const tagChips = document.createElement("div");
      tagChips.className = "tag-chips";
      for (const tag of item.tags) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = tag;
        tagChips.appendChild(chip);
      }
      info.appendChild(tagChips);
    }

    li.addEventListener("click", () => {
      if (selectMode) {
        toggleSelected(item.id, !selectedIds.has(item.id));
        return;
      }
      chrome.tabs.create({ url: item.url });
    });

    const buttons = [];
    if (!selectMode) {
      if (item.hasSnapshot) {
        const readerBtn = document.createElement("button");
        readerBtn.className = "reader-btn";
        readerBtn.type = "button";
        readerBtn.title = chrome.i18n.getMessage("readerBtnTitle");
        readerBtn.appendChild(createIcon("reader"));
        readerBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          chrome.tabs.create({ url: `reader.html?id=${encodeURIComponent(item.id)}` });
        });
        buttons.push(readerBtn);
      }

      const tagBtn = document.createElement("button");
      tagBtn.className = "tag-btn";
      tagBtn.classList.toggle("is-active", editingTagsId === item.id);
      tagBtn.type = "button";
      tagBtn.title = chrome.i18n.getMessage("tagBtnTitle");
      tagBtn.appendChild(createIcon("tag"));
      tagBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        editingTagsId === item.id ? cancelEditingTags() : startEditingTags(item.id);
      });
      buttons.push(tagBtn);

      const readBtn = document.createElement("button");
      readBtn.className = "read-btn";
      readBtn.classList.toggle("is-active", Boolean(item.readStatus));
      readBtn.type = "button";
      readBtn.title = item.readStatus
        ? chrome.i18n.getMessage("markAsUnread")
        : chrome.i18n.getMessage("markAsRead");
      readBtn.appendChild(createIcon("check"));
      readBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleRead(item.id, !item.readStatus);
      });
      buttons.push(readBtn);

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.type = "button";
      removeBtn.title = chrome.i18n.getMessage("deleteBtnTitle");
      removeBtn.appendChild(createIcon("trash"));
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeItem(item.id);
      });
      buttons.push(removeBtn);
    }

    li.append(leadingSlot, favicon, info, ...buttons);
    listEl.appendChild(li);
  }

  updateBulkBar(items);
}

/** Returns the `<li>` the dragged element should be inserted before, based on cursor y. */
function getDragAfterElement(container, y) {
  const candidates = [...container.querySelectorAll("li:not(.dragging)")];
  return candidates.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

/** Reads the current DOM order of `<li>`s and saves it as the new list order. */
async function persistDomOrder() {
  const newIds = [...listEl.children].map((child) => child.dataset.id);
  allItems = await reorderReadingList(newIds);
  renderList();
}

function updateSaveButtonState() {
  if (!currentTab || !currentTab.url) {
    saveBtn.disabled = true;
    saveBtn.title = chrome.i18n.getMessage("saveBtnNoActivePage");
    return;
  }
  if (!/^https?:/i.test(currentTab.url)) {
    saveBtn.disabled = true;
    saveBtn.title = chrome.i18n.getMessage("saveBtnCantSavePage");
    return;
  }

  const alreadySaved = Boolean(findByUrl(allItems, currentTab.url));
  saveBtn.disabled = alreadySaved;
  saveBtn.classList.toggle("is-saved", alreadySaved);
  saveBtn.title = alreadySaved
    ? chrome.i18n.getMessage("saveBtnAlreadySaved")
    : chrome.i18n.getMessage("saveBtnSaveCurrentPage");
  saveBtnLabel.textContent = alreadySaved
    ? chrome.i18n.getMessage("saveBtnLabelSaved")
    : chrome.i18n.getMessage("saveBtnLabelSaveCurrentPage");
}

/** Shows a quiet "N saved" count, switching to a warning once storage is nearly full. */
function renderUsage(usage) {
  if (!usage || usage.itemCount === 0) {
    usageInfoEl.classList.remove("is-visible", "is-warning");
    return;
  }

  usageInfoEl.classList.add("is-visible");
  usageInfoEl.classList.toggle("is-warning", usage.isNearLimit);
  usageInfoEl.textContent = usage.isNearLimit
    ? chrome.i18n.getMessage("usageSavedNearLimit", [String(usage.itemCount), String(usage.maxItems), String(usage.percentUsed)])
    : chrome.i18n.getMessage("usageSaved", [String(usage.itemCount)]);
}

async function refreshList() {
  allItems = await getReadingList();
  renderTagFilter();
  renderList();
  updateSaveButtonState();
  renderUsage(await getStorageUsage());
}

async function prefetchActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  updateSaveButtonState();
}

async function saveCurrentPage() {
  if (!currentTab || !currentTab.url) return;

  saveBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      action: "ADD_TO_READING_LIST",
      payload: {
        url: currentTab.url,
        title: currentTab.title,
        favIconUrl: currentTab.favIconUrl,
      },
    });

    if (!response?.ok) {
      showStatus(response?.error || chrome.i18n.getMessage("statusCouldntSavePage"));
      return;
    }

    if (response.added && response.usage?.isNearLimit) {
      showStatus(chrome.i18n.getMessage("statusSavedNearLimit", [String(response.usage.percentUsed)]), 3200);
    } else {
      showStatus(
        response.added
          ? chrome.i18n.getMessage("statusSavedExclaim")
          : chrome.i18n.getMessage("statusAlreadySaved")
      );
    }
    await refreshList();
  } finally {
    updateSaveButtonState();
  }
}

async function removeItem(id) {
  allItems = await removeFromReadingList(id);
  await removeArticleSnapshot(id);
  selectedIds.delete(id);
  renderTagFilter();
  renderList();
  updateSaveButtonState();
  renderUsage(await getStorageUsage());
}

async function toggleRead(id, readStatus) {
  allItems = await updateReadingListItem(id, { readStatus });
  renderList();
}

function startEditingTags(id) {
  editingTagsId = id;
  renderList();
}

function cancelEditingTags() {
  editingTagsId = null;
  renderList();
}

async function commitTagsEdit(id, rawValue) {
  editingTagsId = null;
  allItems = await updateReadingListItem(id, { tags: rawValue.split(",") });
  renderTagFilter();
  renderList();
}

function toggleSelected(id, isSelected) {
  if (isSelected) selectedIds.add(id);
  else selectedIds.delete(id);
  updateBulkBar(getFilteredItems());
  // Only the checkbox state needs to change, but re-rendering keeps
  // "select all" style dependent styling (none today) accurate for free.
  const li = listEl.querySelector(`li[data-id="${CSS.escape(id)}"]`);
  const checkbox = li?.querySelector(".select-checkbox");
  if (checkbox) checkbox.checked = isSelected;
}

function setSelectMode(enabled) {
  selectMode = enabled;
  selectModeBtn.classList.toggle("is-active", enabled);
  selectModeBtn.title = enabled
    ? chrome.i18n.getMessage("selectModeExit")
    : chrome.i18n.getMessage("selectModeEnter");
  if (!enabled) selectedIds.clear();
  renderList();
}

function updateBulkBar(visibleItems) {
  bulkBarEl.classList.toggle("is-visible", selectMode);
  if (!selectMode) return;

  bulkBarCountEl.textContent = chrome.i18n.getMessage("bulkBarCount", [String(selectedIds.size)]);
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedIds.has(item.id));
  bulkBarSelectAllBtn.textContent = allVisibleSelected
    ? chrome.i18n.getMessage("bulkBarClear")
    : chrome.i18n.getMessage("bulkBarSelectAll");
  bulkBarMarkReadBtn.disabled = selectedIds.size === 0;
  bulkBarDeleteBtn.disabled = selectedIds.size === 0;
}

bulkBarSelectAllBtn.addEventListener("click", () => {
  const visibleItems = getFilteredItems();
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedIds.has(item.id));
  if (allVisibleSelected) {
    for (const item of visibleItems) selectedIds.delete(item.id);
  } else {
    for (const item of visibleItems) selectedIds.add(item.id);
  }
  renderList();
});

bulkBarMarkReadBtn.addEventListener("click", async () => {
  if (selectedIds.size === 0) return;
  allItems = await bulkUpdateReadingListItems([...selectedIds], { readStatus: true });
  showStatus(chrome.i18n.getMessage("bulkMarkedRead", [String(selectedIds.size)]));
  selectedIds.clear();
  renderList();
});

bulkBarDeleteBtn.addEventListener("click", async () => {
  if (selectedIds.size === 0) return;
  const ids = [...selectedIds];
  allItems = await removeManyFromReadingList(ids);
  await Promise.all(ids.map((id) => removeArticleSnapshot(id)));
  showStatus(
    ids.length === 1
      ? chrome.i18n.getMessage("bulkDeletedSingular")
      : chrome.i18n.getMessage("bulkDeletedPlural", [String(ids.length)])
  );
  selectedIds.clear();
  renderTagFilter();
  renderList();
  updateSaveButtonState();
  renderUsage(await getStorageUsage());
});

selectModeBtn.addEventListener("click", () => setSelectMode(!selectMode));

sortSelect.addEventListener("change", async () => {
  sortMode = sortSelect.value;
  renderList();
  await saveSettings({ sortMode });
});

optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

saveBtn.addEventListener("click", saveCurrentPage);

let searchDebounceTimer = null;

searchInput.addEventListener("input", () => {
  searchClearBtn.hidden = searchInput.value.length === 0;
  renderList(); // immediate: title/tag filtering is synchronous and free

  // Cached article text may need a one-time chrome.storage.local read (only
  // for snapshots not already in snapshotTextCache) — debounced so a fast
  // typist doesn't trigger a read per keystroke.
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    await ensureSnapshotTextLoaded();
    renderList();
  }, 150);
});

searchClearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchClearBtn.hidden = true;
  renderList();
  searchInput.focus();
});

// Live-reorders the DOM as an item is dragged over the list; the actual
// storage write happens once, in the dragged item's "dragend" handler.
listEl.addEventListener("dragover", (event) => {
  const dragging = listEl.querySelector("li.dragging");
  if (!dragging) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const afterElement = getDragAfterElement(listEl, event.clientY);
  if (afterElement == null) {
    listEl.appendChild(dragging);
  } else {
    listEl.insertBefore(dragging, afterElement);
  }
});

listEl.addEventListener("drop", (event) => {
  if (listEl.querySelector("li.dragging")) event.preventDefault();
});

async function loadInitialSort() {
  const settings = await getSettings();
  sortMode = settings.sortMode;
  sortSelect.value = sortMode;
  renderList();
}

document.addEventListener("DOMContentLoaded", () => {
  // Fetch the list, the active tab, and the saved sort mode in parallel so
  // the popup is ready (and the Save button already reflects
  // "saved"/"unsaved") the instant it opens. Each path re-renders the list
  // once it resolves, so whichever finishes last ends up reflecting both.
  refreshList();
  prefetchActiveTab();
  loadInitialSort();
});
