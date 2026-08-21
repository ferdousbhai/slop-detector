chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "slop-check-selection",
    title: "Check selection for slop",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "slop-check-selection" || !tab?.id) return;
  chrome.tabs
    .sendMessage(tab.id, { type: "slop:analyze", text: info.selectionText || "" })
    .catch(() => {
      /* Page without content script (e.g. chrome://). Nothing to do. */
    });
});
