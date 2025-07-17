// Set the initial state of the side panel
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Function to update the icon based on the panel's state
const updateIcon = async (windowId) => {
  const { isPanelOpen } = await chrome.storage.session.get({ [windowId]: { isPanelOpen: false } });
  const iconPath = isPanelOpen ? 'icons/icon-active.svg' : 'icons/icon-inactive.svg';
  chrome.action.setIcon({ path: { "32": iconPath } });
};

// Update icon when a new window is focused
chrome.windows.onFocusChanged.addListener(updateIcon);

// Update icon when a tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateIcon(tab.windowId);
  }
});

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (sender.tab) {
    const windowId = sender.tab.windowId;
    let isPanelOpen;

    if (message.type === 'sidepanel_opened') {
      isPanelOpen = true;
    } else if (message.type === 'sidepanel_closed') {
      isPanelOpen = false;
    }

    if (isPanelOpen !== undefined) {
      await chrome.storage.session.set({ [windowId]: { isPanelOpen } });
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
