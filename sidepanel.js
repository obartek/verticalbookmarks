document.addEventListener('DOMContentLoaded', () => {
  // Notify that panel is opened when DOM is loaded
  chrome.runtime.sendMessage({ type: 'sidepanel_opened' });
  
  const favoritesContainer = document.getElementById('favorites-container');
  const bookmarksContainer = document.getElementById('bookmarks-container');

  // Storage key for favorites
  const FAVORITES_KEY = 'vertical_bookmarks_favorites';

  // Get favorites from storage
  function getFavorites() {
    return new Promise((resolve) => {
      chrome.storage.local.get([FAVORITES_KEY], (result) => {
        resolve(result[FAVORITES_KEY] || []);
      });
    });
  }

  // Save favorites to storage
  function saveFavorites(favorites) {
    chrome.storage.local.set({ [FAVORITES_KEY]: favorites });
  }

  // Create favorite bookmark element (icon only)
  function createFavoriteElement(bookmark) {
    const favoriteItem = document.createElement('div');
    favoriteItem.className = 'favorite-item';

    const link = document.createElement('a');
    link.href = bookmark.url;
    link.target = '_blank';
    link.className = 'favorite-link';

    const favicon = document.createElement('img');
    favicon.src = 'icons/logo/logo-16-inactive.png';
    favicon.dataset.url = bookmark.url;

    // Request favicon from background script
    chrome.runtime.sendMessage({ type: 'get_favicon', url: bookmark.url });

    const tooltip = document.createElement('span');
    tooltip.className = 'tooltip';
    tooltip.textContent = bookmark.title;

    // Remove from favorites button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-favorite-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove from favorites';
    
    removeBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const favorites = await getFavorites();
      const updatedFavorites = favorites.filter(fav => fav.url !== bookmark.url);
      saveFavorites(updatedFavorites);
      renderFavorites();
    });

    link.appendChild(favicon);
    link.appendChild(tooltip);
    
    favoriteItem.appendChild(link);
    favoriteItem.appendChild(removeBtn);

    return favoriteItem;
  }

  // Create bookmark tree element
  function createBookmarkTreeElement(bookmark, isFolder = false) {
    const item = document.createElement('div');
    item.className = isFolder ? 'bookmark-folder' : 'bookmark-item-tree';

    if (isFolder) {
      const folderHeader = document.createElement('div');
      folderHeader.className = 'folder-header';
      
      const expandIcon = document.createElement('span');
      expandIcon.className = 'expand-icon';
      expandIcon.textContent = '▶';
      
      const folderIcon = document.createElement('span');
      folderIcon.className = 'folder-icon';
      folderIcon.textContent = '📁';
      
      const title = document.createElement('span');
      title.className = 'folder-title';
      title.textContent = bookmark.title;
      
      folderHeader.appendChild(expandIcon);
      folderHeader.appendChild(folderIcon);
      folderHeader.appendChild(title);
      
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'folder-children';
      childrenContainer.style.display = 'none';
      
      folderHeader.addEventListener('click', () => {
        const isExpanded = childrenContainer.style.display !== 'none';
        childrenContainer.style.display = isExpanded ? 'none' : 'block';
        expandIcon.textContent = isExpanded ? '▶' : '▼';
      });
      
      item.appendChild(folderHeader);
      item.appendChild(childrenContainer);
      
      return { element: item, childrenContainer };
    } else {
      const link = document.createElement('a');
      link.href = bookmark.url;
      link.target = '_blank';
      link.className = 'bookmark-link';
      
      const favicon = document.createElement('img');
      favicon.src = 'icons/logo/logo-16-inactive.png';
      favicon.dataset.url = bookmark.url;
      favicon.className = 'bookmark-favicon';
      
      // Request favicon from background script
      chrome.runtime.sendMessage({ type: 'get_favicon', url: bookmark.url });
      
      const title = document.createElement('span');
      title.className = 'bookmark-title';
      title.textContent = bookmark.title;
      
      // Add to favorites button
      const addToFavoritesBtn = document.createElement('button');
      addToFavoritesBtn.className = 'add-to-favorites-btn';
      addToFavoritesBtn.textContent = '★';
      addToFavoritesBtn.title = 'Add to favorites';
      
      addToFavoritesBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const favorites = await getFavorites();
        if (!favorites.some(fav => fav.url === bookmark.url)) {
          favorites.push({ title: bookmark.title, url: bookmark.url });
          saveFavorites(favorites);
          renderFavorites();
        }
      });
      
      link.appendChild(favicon);
      link.appendChild(title);
      link.appendChild(addToFavoritesBtn);
      
      item.appendChild(link);
      return { element: item };
    }
  }

  // Render bookmarks tree
  function renderBookmarkTree(bookmarkTree, container) {
    container.innerHTML = '';
    
    function traverse(nodes, parentContainer) {
      for (const node of nodes) {
        if (node.children) {
          // It's a folder
          const { element, childrenContainer } = createBookmarkTreeElement(node, true);
          parentContainer.appendChild(element);
          traverse(node.children, childrenContainer);
        } else if (node.url) {
          // It's a bookmark
          const { element } = createBookmarkTreeElement(node, false);
          parentContainer.appendChild(element);
        }
      }
    }
    
    traverse(bookmarkTree, container);
  }

  // Render favorites
  async function renderFavorites() {
    const favorites = await getFavorites();
    favoritesContainer.innerHTML = '';
    
    favorites.forEach(bookmark => {
      const favoriteElement = createFavoriteElement(bookmark);
      favoritesContainer.appendChild(favoriteElement);
    });
  }

  // Add current page to favorites
  document.getElementById('add-current-page-btn').addEventListener('click', async () => {
    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (tab && tab.url && !tab.url.startsWith('chrome://')) {
        const favorites = await getFavorites();
        
        // Check if already in favorites
        if (!favorites.some(fav => fav.url === tab.url)) {
          favorites.push({ 
            title: tab.title || 'Untitled', 
            url: tab.url 
          });
          saveFavorites(favorites);
          renderFavorites();
        }
      }
    } catch (error) {
      console.error('Error adding current page to favorites:', error);
    }
  });

  // Initialize
  chrome.bookmarks.getTree((bookmarkTree) => {
    renderBookmarkTree(bookmarkTree, bookmarksContainer);
  });

  renderFavorites();

  // Listen for favicon responses
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'favicon_response' && message.dataUrl) {
      const imgs = document.querySelectorAll(`img[data-url="${message.url}"]`);
      imgs.forEach(img => {
        img.src = message.dataUrl;
      });
    }
  });

  // Handle visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      chrome.runtime.sendMessage({ type: 'sidepanel_closed' });
    } else if (document.visibilityState === 'visible') {
      chrome.runtime.sendMessage({ type: 'sidepanel_opened' });
    }
  });

  // Handle when the page is about to be unloaded
  window.addEventListener('beforeunload', () => {
    chrome.runtime.sendMessage({ type: 'sidepanel_closed' });
  });
});

// Also notify when the panel is closed if the page is hidden
window.addEventListener('pagehide', () => {
  chrome.runtime.sendMessage({ type: 'sidepanel_closed' });
});
