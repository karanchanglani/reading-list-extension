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
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

load();
