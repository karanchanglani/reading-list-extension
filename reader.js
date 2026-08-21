import { getReadingList } from "./storage.js";
import { getArticleSnapshot } from "./content-cache.js";

const metaEl = document.getElementById("meta");
const titleEl = document.getElementById("article-title");
const sublineEl = document.getElementById("article-subline");
const contentEl = document.getElementById("article-content");
const liveLinkEl = document.getElementById("live-link");
const stateEl = document.getElementById("state");

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
    showState(
      `No cached content for this article — it may have been saved before Reader View was added, or extraction ` +
        `didn't work for this page. <a href="${item.url}" target="_blank" rel="noopener">Open the live page instead</a>.`
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
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

load();
