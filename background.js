// Set the initial state of the side panel
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Handle action click to toggle panel state
chrome.action.onClicked.addListener(async (tab) => {
  const windowId = tab.windowId;
  const storageKey = `window_${windowId}_panel_state`;
  const result = await chrome.storage.session.get(storageKey);
  const isPanelOpen = result[storageKey] || false;
  
  // Toggle the state
  const newState = !isPanelOpen;
  await chrome.storage.session.set({ [storageKey]: newState });
});

// Function to notify side panel about bookmark changes
const notifyBookmarkChange = () => {
  chrome.runtime.sendMessage({
    type: 'bookmarks_changed'
  }).catch(() => {
    // Ignore errors if side panel is not open
  });
};

// Listen for bookmark changes and notify side panel
chrome.bookmarks.onCreated.addListener((id, bookmark) => {
  console.log('Bookmark created:', bookmark);
  notifyBookmarkChange();
});

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  console.log('Bookmark removed:', id);
  notifyBookmarkChange();
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  console.log('Bookmark changed:', id, changeInfo);
  notifyBookmarkChange();
});

chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
  console.log('Bookmark moved:', id, moveInfo);
  notifyBookmarkChange();
});

chrome.bookmarks.onChildrenReordered.addListener((id, reorderInfo) => {
  console.log('Bookmark children reordered:', id, reorderInfo);
  notifyBookmarkChange();
});

// Update icon when a new window is focused
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    // The updateIcon function has been removed to prevent errors.
  }
});

// Update icon when a tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // The updateIcon function has been removed to prevent errors.
  }
});

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener(async (message, sender) => {
  let windowId;
  
  // Get window ID from sender context
  if (sender.tab) {
    windowId = sender.tab.windowId;
  } else {
    // If no tab context, get current window
    const windows = await chrome.windows.getAll();
    const currentWindow = windows.find(w => w.focused) || windows[0];
    windowId = currentWindow?.id;
  }
  
  if (windowId) {
    const storageKey = `window_${windowId}_panel_state`;
    let isPanelOpen;

    if (message.type === 'sidepanel_opened') {
      isPanelOpen = true;
    } else if (message.type === 'sidepanel_closed') {
      isPanelOpen = false;
    }

    if (isPanelOpen !== undefined) {
      await chrome.storage.session.set({ [storageKey]: isPanelOpen });
    }
  }

  if (message.type === 'get_favicon') {
    const FAVICON_CACHE_KEY = 'favicon_cache';

    // Function to get favicons from cache
    const getCachedFavicon = async (url) => {
      const result = await chrome.storage.local.get(FAVICON_CACHE_KEY);
      const cache = result[FAVICON_CACHE_KEY] || {};
      return cache[url];
    };

    // Function to set favicon in cache
    const setCachedFavicon = async (url, dataUrl) => {
      const result = await chrome.storage.local.get(FAVICON_CACHE_KEY);
      const cache = result[FAVICON_CACHE_KEY] || {};
      cache[url] = dataUrl;
      await chrome.storage.local.set({ [FAVICON_CACHE_KEY]: cache });
    };

    const fetchAndCacheFavicon = async (url) => {
      const googleFaviconUrl = `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(url)}`;
      
      try {
        const response = await fetch(googleFaviconUrl);
        if (response.ok) {
          const blob = await response.blob();
          
          if (blob.size > 0 && blob.type.startsWith('image/')) {
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const dataUrl = reader.result;
                setCachedFavicon(url, dataUrl);
                resolve(dataUrl);
              };
              reader.readAsDataURL(blob);
            });
          }
        }
      } catch (error) {
        console.error(`Failed to fetch favicon for ${url}:`, error);
      }
      return null;
    };
    
    (async () => {
      try {
        let dataUrl;
        if (!message.force_refresh) {
          dataUrl = await getCachedFavicon(message.url);
        }

        if (!dataUrl) {
          dataUrl = await fetchAndCacheFavicon(message.url);
        }
        
        if (dataUrl) {
          chrome.runtime.sendMessage({
            type: 'favicon_response',
            url: message.url,
            dataUrl: dataUrl
          }).catch(err => {
            if (!err.message.includes('Receiving end does not exist')) {
                console.error('Error sending favicon response:', err);
            }
          });
        }
      } catch (error) {
        console.error('Error in get_favicon handler:', error);
      }
    })();
    
    return true; // Indicates that the response is sent asynchronously
  }
});
