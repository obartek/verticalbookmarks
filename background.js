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
    const tryGetFavicon = async (url, forceRefresh = false) => {
      const domain = new URL(url).hostname;
      
      // First try to get favicon from tab if it's the current tab
      try {
        const tabs = await chrome.tabs.query({ url: url });
        if (tabs.length > 0 && tabs[0].favIconUrl && tabs[0].favIconUrl !== '') {
          const response = await fetch(tabs[0].favIconUrl);
          if (response.ok) {
            const blob = await response.blob();
            if (blob.size > 0 && blob.type.startsWith('image/')) {
              return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
              });
            }
          }
        }
      } catch (error) {
        // Continue to manual favicon detection
      }
      
      // List of potential favicon URLs to try in order
      const faviconUrls = [
        `${new URL(url).origin}/favicon.ico`,
        `${new URL(url).origin}/favicon.png`,
        `${new URL(url).origin}/apple-touch-icon.png`,
        `https://www.google.com/s2/favicons?sz=32&domain=${domain}`,
        `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(url)}`
      ];
      
      for (const faviconUrl of faviconUrls) {
        try {
          const response = await fetch(faviconUrl);
          if (response.ok) {
            const blob = await response.blob();
            
            // Check if it's a valid image (not a 404 page or empty response)
            if (blob.size > 0 && blob.type.startsWith('image/')) {
              return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
              });
            }
          }
        } catch (error) {
          // Continue to next URL
          continue;
        }
      }
      
      return null;
    };
    
    tryGetFavicon(message.url, message.force_refresh)
      .then(dataUrl => {
        if (dataUrl) {
          chrome.runtime.sendMessage({
            type: 'favicon_response',
            url: message.url,
            dataUrl: dataUrl
          });
        }
      })
      .catch(() => {
        // Ignore errors, default icon will be used
      });
    
    return true; // Indicates that the response is sent asynchronously
  }
});
