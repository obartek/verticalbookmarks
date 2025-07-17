// Set initial state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isEnabled: true });
});

// Inject content script on page load
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    chrome.storage.local.get('isEnabled', ({ isEnabled }) => {
      if (isEnabled) {
        // The content script is designed to be idempotent (it won't inject the sidebar twice),
        // so we can safely attempt to inject it on every page load.
        chrome.scripting.insertCSS({
          target: { tabId: tabId },
          files: ['style.css']
        });
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content_script.js']
        });
      }
    });
  }
});

// Toggle sidebar on action click
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !tab.url.startsWith('http')) {
    return;
  }

  const { isEnabled } = await chrome.storage.local.get('isEnabled');
  const newState = !isEnabled;
  await chrome.storage.local.set({ isEnabled: newState });

  // Try to send a message to the content script. If it fails, the catch block will handle it.
  chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar', isEnabled: newState })
    .catch((error) => {
      // This error is expected if the content script is not yet injected.
      console.log(`Could not send message: ${error.message}`);
      
      // If we are enabling the sidebar, inject the scripts now.
      if (newState) {
        console.log('Injecting scripts after enabling.');
        chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['style.css'] });
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
      }
      // If we are disabling and the script isn't there, there's nothing to do.
    });
});

// Function to recursively get all bookmarks
function getBookmarks(nodes, bookmarks) {
    for (const node of nodes) {
        if (node.url) {
            bookmarks.push({
                title: node.title,
                url: node.url
            });
        }
        if (node.children) {
            getBookmarks(node.children, bookmarks);
        }
    }
}

// Respond to messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBookmarks') {
    chrome.bookmarks.getTree((tree) => {
      let bookmarks = [];
      getBookmarks(tree, bookmarks);
      sendResponse({ bookmarks });
    });
    return true; // Keep the message channel open for sendResponse
  }
}); 