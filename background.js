// Clicking the toolbar icon opens the export page, bound to the tab the user clicked from.
// The export only runs against that tab, so the user must be on app.mealime.com or my.mealime.com and logged in.
chrome.action.onClicked.addListener(async (tab) => {
  const url = chrome.runtime.getURL(`export.html?tab=${tab.id}`);
  const base = chrome.runtime.getURL('export.html');
  const existing = await chrome.tabs.query({ url: `${base}*` });
  await Promise.all(existing.map((t) => chrome.tabs.remove(t.id))); // one export page at a time
  await chrome.tabs.create({ url, index: tab.index + 1, openerTabId: tab.id });
});
