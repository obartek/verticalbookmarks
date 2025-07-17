document.addEventListener('DOMContentLoaded', () => {
  const bookmarksContainer = document.getElementById('bookmarks-container');

  function flattenBookmarkTree(bookmarkTree) {
    const bookmarks = [];
    function traverse(nodes) {
      for (const node of nodes) {
        if (node.url) {
          bookmarks.push({
            title: node.title,
            url: node.url,
          });
        }
        if (node.children) {
          traverse(node.children);
        }
      }
    }
    traverse(bookmarkTree);
    return bookmarks;
  }

  function createBookmarkElement(bookmark) {
    const bookmarkItem = document.createElement('a');
    bookmarkItem.href = bookmark.url;
    bookmarkItem.target = '_blank'; // Open in new tab
    bookmarkItem.className = 'bookmark-item';

    const favicon = document.createElement('img');
    favicon.src = 'icons/icon-inactive.svg'; // Default icon
    favicon.dataset.url = bookmark.url; // Store URL to match with response

    // Request favicon from background script
    chrome.runtime.sendMessage({ type: 'get_favicon', url: bookmark.url });

    const tooltip = document.createElement('span');
    tooltip.className = 'tooltip';
    tooltip.textContent = bookmark.title;

    bookmarkItem.appendChild(favicon);
    bookmarkItem.appendChild(tooltip);

    return bookmarkItem;
  }

  chrome.bookmarks.getTree((bookmarkTree) => {
    const allBookmarks = flattenBookmarkTree(bookmarkTree);
    allBookmarks.forEach(bookmark => {
      const bookmarkElement = createBookmarkElement(bookmark);
      bookmarksContainer.appendChild(bookmarkElement);
    });
  });

  // Listen for favicon responses
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'favicon_response' && message.dataUrl) {
      const img = document.querySelector(`img[data-url="${message.url}"]`);
      if (img) {
        img.src = message.dataUrl;
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      chrome.runtime.sendMessage({ type: 'sidepanel_closed' });
    } else if (document.visibilityState === 'visible') {
      chrome.runtime.sendMessage({ type: 'sidepanel_opened' });
    }
  });
});
