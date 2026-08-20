import { getSettings, saveSettings } from "./storage.js";

const fabToggle = document.getElementById("fab-toggle");
const contextMenuToggle = document.getElementById("context-menu-toggle");
const statusEl = document.getElementById("status");

let statusHideTimer = null;

function showSaved() {
  statusEl.textContent = "Saved";
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

document.addEventListener("DOMContentLoaded", load);
