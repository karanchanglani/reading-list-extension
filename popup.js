import {
  getReadingList,
  removeFromReadingList,
  updateReadingListItem,
  reorderReadingList,
  findByUrl,
} from "./storage.js";

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
const saveBtn = document.getElementById("save-btn");
const saveBtnLabel = document.getElementById("save-btn-label");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("search-input");
const searchClearBtn = document.getElementById("search-clear");
const listEl = document.getElementById("list");
const emptyStateEl = document.getElementById("empty-state");
const noResultsEl = document.getElementById("no-results");

/** Full, unfiltered list — the source of truth for rendering. */
let allItems = [];
/** The active tab's info, prefetched on popup open so "+" saves instantly. */
let currentTab = null;

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
  if (!query) return allItems;
  return allItems.filter((item) => (item.title || "").toLowerCase().includes(query));
}

function renderList() {
  const query = searchInput.value.trim();
  const items = getFilteredItems();
  // Reordering a filtered subset doesn't map cleanly onto the full list's
  // order, so dragging is only enabled when the whole list is showing.
  const reorderable = !query;

  listEl.innerHTML = "";
  emptyStateEl.hidden = allItems.length > 0;
  noResultsEl.hidden = !(allItems.length > 0 && query && items.length === 0);

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

    const grip = document.createElement("span");
    grip.className = "grip";
    grip.appendChild(createIcon("grip"));

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

    const readBtn = document.createElement("button");
    readBtn.className = "read-btn";
    readBtn.classList.toggle("is-active", Boolean(item.readStatus));
    readBtn.type = "button";
    readBtn.title = item.readStatus ? "Mark as unread" : "Mark as read";
    readBtn.appendChild(createIcon("check"));
    readBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRead(item.id, !item.readStatus);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.type = "button";
    removeBtn.title = "Delete";
    removeBtn.appendChild(createIcon("trash"));
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      removeItem(item.id);
    });

    li.addEventListener("click", () => {
      chrome.tabs.create({ url: item.url });
    });

    li.append(grip, favicon, info, readBtn, removeBtn);
    listEl.appendChild(li);
  }
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
    saveBtn.title = "No active page to save";
    return;
  }
  if (!/^https?:/i.test(currentTab.url)) {
    saveBtn.disabled = true;
    saveBtn.title = "This page can't be saved";
    return;
  }

  const alreadySaved = Boolean(findByUrl(allItems, currentTab.url));
  saveBtn.disabled = alreadySaved;
  saveBtn.classList.toggle("is-saved", alreadySaved);
  saveBtn.title = alreadySaved ? "Already saved" : "Save the current page";
  saveBtnLabel.textContent = alreadySaved ? "Saved" : "Save Current Page";
}

async function refreshList() {
  allItems = await getReadingList();
  renderList();
  updateSaveButtonState();
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
      showStatus(response?.error || "Couldn't save this page.");
      return;
    }

    showStatus(response.added ? "Saved!" : "Already saved.");
    await refreshList();
  } finally {
    updateSaveButtonState();
  }
}

async function removeItem(id) {
  allItems = await removeFromReadingList(id);
  renderList();
  updateSaveButtonState();
}

async function toggleRead(id, readStatus) {
  allItems = await updateReadingListItem(id, { readStatus });
  renderList();
}

optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

saveBtn.addEventListener("click", saveCurrentPage);

searchInput.addEventListener("input", () => {
  searchClearBtn.hidden = searchInput.value.length === 0;
  renderList();
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

document.addEventListener("DOMContentLoaded", () => {
  // Fetch the list and the active tab in parallel so the popup is ready
  // (and the Save button already reflects "saved"/"unsaved") the instant it opens.
  refreshList();
  prefetchActiveTab();
});
