"use strict";

const PENDING_SELECTION_KEY = "pendingSelection";
const BADGE_COLOR = "#C42B1F";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "slop-check-selection",
    title: "Check selection for slop",
    contexts: ["selection"],
  });
});

function updateAction(tabId, count) {
  const text = count > 999 ? "999+" : count > 0 ? String(count) : "";
  const title = count > 0
    ? `Slop Detector: ${count} finding${count === 1 ? "" : "s"}`
    : "Slop Detector";
  void Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }),
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setTitle({ tabId, title }),
  ]).catch(() => {
    /* The tab may have closed before the badge update completed. */
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "slop:finding-count" || sender.tab?.id === undefined) return;
  if (!Number.isSafeInteger(message.count) || message.count < 0) return;
  updateAction(sender.tab.id, message.count);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") updateAction(tabId, 0);
});

async function openSelection(text, tab) {
  try {
    await chrome.storage.session.set({ [PENDING_SELECTION_KEY]: text });
  } catch {
    return;
  }
  try {
    await chrome.action.openPopup(tab?.windowId === undefined ? {} : { windowId: tab.windowId });
  } catch {
    /* The stored selection remains available on the next manual popup open. */
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const text = info.selectionText?.trim();
  if (info.menuItemId !== "slop-check-selection" || !text) return;
  void openSelection(text, tab);
});
