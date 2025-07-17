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
  updateIcon(windowId);
});

// Function to update the icon based on the panel's state
const updateIcon = async (windowId) => {
  const storageKey = `window_${windowId}_panel_state`;
  const result = await chrome.storage.session.get(storageKey);
  const isPanelOpen = result[storageKey] || false;
  
  const iconPath = isPanelOpen ? {
    "16": "icons/logo/logo-16.png",
    "32": "icons/logo/logo-32.png",
    "48": "icons/logo/logo-48.png",
    "128": "icons/logo/logo-128.png"
  } : {
    "16": "icons/logo/logo-16-inactive.png",
    "32": "icons/logo/logo-32-inactive.png",
    "48": "icons/logo/logo-48-inactive.png",
    "128": "icons/logo/logo-128-inactive.png"
  };
  
  chrome.action.setIcon({ path: iconPath, windowId: windowId });
};

// Update icon when a new window is focused
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    updateIcon(windowId);
  }
});

// Update icon when a tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateIcon(tab.windowId);
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
      updateIcon(windowId);
    }
  }

  if (message.type === 'get_favicon') {
    const domain = new URL(message.url).hostname;
    const faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;
    
    fetch(faviconUrl)
      .then(response => response.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          chrome.runtime.sendMessage({
            type: 'favicon_response',
            url: message.url,
            dataUrl: reader.result
          });
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {
        // Ignore errors, default icon will be used
      });
    return true; // Indicates that the response is sent asynchronously
  }
});
