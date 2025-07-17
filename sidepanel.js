document.addEventListener('DOMContentLoaded', () => {
  // Notify that panel is opened when DOM is loaded
  chrome.runtime.sendMessage({ type: 'sidepanel_opened' });
  
  const favoritesContainer = document.getElementById('favorites-container');
  const bookmarksContainer = document.getElementById('bookmarks-container');
  const editToggleBtn = document.getElementById('edit-toggle-btn');
  const addBtn = document.getElementById('add-btn');
  const floatingAddBtn = document.getElementById('floating-add-btn');
  const themeToggle = document.getElementById('theme-toggle');

  // Storage key for favorites
  const FAVORITES_KEY = 'vertical_bookmarks_favorites';
  const THEME_KEY = 'vertical_bookmarks_theme';
  
  // Edit mode state
  let isEditMode = false;
  let isDarkMode = false;
  
  // Drag & drop state
  let isDragging = false;
  let draggedElement = null;
  let dragStartIndex = -1;
  let longPressTimer = null;
  let dragOffset = { x: 0, y: 0 };
  let lastInsertionIndex = -1; // Track last insertion to prevent unnecessary updates
  let dragMoveThrottle = null;

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

  // Get theme from storage
  function getTheme() {
    return new Promise((resolve) => {
      chrome.storage.local.get([THEME_KEY], (result) => {
        resolve(result[THEME_KEY] || 'light');
      });
    });
  }

  // Save theme to storage
  function saveTheme(theme) {
    chrome.storage.local.set({ [THEME_KEY]: theme });
  }

  // Apply theme
  function applyTheme(theme) {
    isDarkMode = theme === 'dark';
    document.body.classList.toggle('dark-mode', isDarkMode);
    themeToggle.classList.toggle('dark', isDarkMode);
  }

  // Drag & Drop functions
  function startDrag(element, event) {
    isDragging = true;
    draggedElement = element;
    dragStartIndex = Array.from(favoritesContainer.children).indexOf(element);
    
    const rect = element.getBoundingClientRect();
    dragOffset.x = event.clientX - rect.left;
    dragOffset.y = event.clientY - rect.top;
    
    // Add dragging class
    element.classList.add('dragging');
    favoritesContainer.classList.add('drag-active');
    
    // Create ghost element
    const ghost = element.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.position = 'fixed';
    ghost.style.left = (event.clientX - dragOffset.x) + 'px';
    ghost.style.top = (event.clientY - dragOffset.y) + 'px';
    ghost.style.zIndex = '1000';
    ghost.style.pointerEvents = 'none';
    document.body.appendChild(ghost);
    
    // Hide original element
    element.style.opacity = '0.3';
    
    // Add global event listeners
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    
    // Prevent default drag behavior
    event.preventDefault();
  }

  function handleDragMove(event) {
    if (!isDragging || !draggedElement) return;
    
    const ghost = document.querySelector('.drag-ghost');
    if (ghost) {
      ghost.style.left = (event.clientX - dragOffset.x) + 'px';
      ghost.style.top = (event.clientY - dragOffset.y) + 'px';
    }
    
    // Throttle gap updates to prevent flickering
    if (dragMoveThrottle) {
      clearTimeout(dragMoveThrottle);
    }
    
    dragMoveThrottle = setTimeout(() => {
      const insertionPoint = getInsertionPoint(event.clientX, event.clientY);
      if (insertionPoint && insertionPoint.index !== lastInsertionIndex) {
        lastInsertionIndex = insertionPoint.index;
        createDropGap(insertionPoint);
      }
    }, 16); // ~60fps
  }

  function getInsertionPoint(x, y) {
    const container = favoritesContainer;
    const containerRect = container.getBoundingClientRect();
    const items = Array.from(container.children).filter(child => 
      child !== draggedElement && child.classList.contains('favorite-item')
    );
    
    if (items.length === 0) {
      return { index: 0, items: [] };
    }
    
    // Find the closest item to the mouse position
    let closestIndex = 0;
    let closestDistance = Infinity;
    
    items.forEach((item, index) => {
      const itemRect = item.getBoundingClientRect();
      const itemCenterX = itemRect.left + itemRect.width / 2;
      const itemCenterY = itemRect.top + itemRect.height / 2;
      
      const distance = Math.sqrt(
        Math.pow(x - itemCenterX, 2) + Math.pow(y - itemCenterY, 2)
      );
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    
    // Determine if we should insert before or after the closest item
    const closestItem = items[closestIndex];
    const closestRect = closestItem.getBoundingClientRect();
    const closestCenterX = closestRect.left + closestRect.width / 2;
    
    // If mouse is to the left of center, insert before; if to the right, insert after
    const insertIndex = x < closestCenterX ? closestIndex : closestIndex + 1;
    
    return {
      index: Math.min(insertIndex, items.length),
      items: items
    };
  }

  function createDropGap(insertionPoint) {
    const { index, items } = insertionPoint;
    
    // Update classes only where needed to prevent flickering
    items.forEach((item, i) => {
      const shouldPush = i >= index;
      const isPushing = item.classList.contains('push-right');
      
      if (shouldPush && !isPushing) {
        item.classList.add('push-right');
      } else if (!shouldPush && isPushing) {
        item.classList.remove('push-right');
      }
    });
  }

  function clearDropGaps() {
    const items = favoritesContainer.querySelectorAll('.favorite-item');
    items.forEach(item => {
      item.classList.remove('push-right');
    });
  }

  async function handleDragEnd(event) {
    if (!isDragging) return;
    
    isDragging = false;
    
    // Remove ghost element
    const ghost = document.querySelector('.drag-ghost');
    if (ghost) {
      ghost.remove();
    }
    
    // Find final insertion point and move element
    const insertionPoint = getInsertionPoint(event.clientX, event.clientY);
    if (insertionPoint) {
      const { index, items } = insertionPoint;
      
      // Remove dragged element from DOM temporarily
      draggedElement.remove();
      
      // Insert at the correct position
      if (index >= items.length) {
        favoritesContainer.appendChild(draggedElement);
      } else {
        favoritesContainer.insertBefore(draggedElement, items[index]);
      }
    }
    
    // Clear all visual effects
    clearDropGaps();
    
    // Restore original element
    if (draggedElement) {
      draggedElement.style.opacity = '1';
      draggedElement.classList.remove('dragging');
    }
    
    favoritesContainer.classList.remove('drag-active');
    
    // Update favorites order based on current DOM order
    const favorites = await getFavorites();
    const newOrder = Array.from(favoritesContainer.children)
      .filter(child => child.classList.contains('favorite-item'))
      .map(child => {
        const link = child.querySelector('.favorite-link');
        const url = link.href;
        const favorite = favorites.find(fav => fav.url === url);
        return { title: favorite ? favorite.title : 'Untitled', url };
      });
    
    saveFavorites(newOrder);
    
    // Remove global event listeners
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    
    // Clear throttle
    if (dragMoveThrottle) {
      clearTimeout(dragMoveThrottle);
      dragMoveThrottle = null;
    }
    
    // Reset drag state
    draggedElement = null;
    dragStartIndex = -1;
    lastInsertionIndex = -1;
  }

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.favorite-item:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // Create context menu
  function createContextMenu(bookmark, x, y) {
    // Remove existing context menu if any
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';

    const openItem = document.createElement('div');
    openItem.className = 'context-menu-item';
    openItem.textContent = 'Open';
    openItem.addEventListener('click', () => {
      window.open(bookmark.url, '_blank');
      contextMenu.remove();
    });

    const removeItem = document.createElement('div');
    removeItem.className = 'context-menu-item';
    removeItem.textContent = 'Delete';
    removeItem.addEventListener('click', async () => {
      const favorites = await getFavorites();
      const updatedFavorites = favorites.filter(fav => fav.url !== bookmark.url);
      saveFavorites(updatedFavorites);
      renderFavorites();
      contextMenu.remove();
    });

    contextMenu.appendChild(openItem);
    contextMenu.appendChild(removeItem);
    document.body.appendChild(contextMenu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  // Create favorite bookmark element
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

    // Three-dot menu button (only visible in edit mode)
    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-btn';
    menuBtn.textContent = '⋮';
    menuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      createContextMenu(bookmark, rect.left, rect.bottom);
    });

    // Left arrow button (only visible in edit mode)
    const leftArrowBtn = document.createElement('button');
    leftArrowBtn.className = 'arrow-btn arrow-left';
    leftArrowBtn.textContent = '<';
    leftArrowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      moveBookmarkPosition(bookmark, -1);
    });

    // Right arrow button (only visible in edit mode)
    const rightArrowBtn = document.createElement('button');
    rightArrowBtn.className = 'arrow-btn arrow-right';
    rightArrowBtn.textContent = '>';
    rightArrowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      moveBookmarkPosition(bookmark, 1);
    });

    link.appendChild(favicon);
    
    favoriteItem.appendChild(link);
    favoriteItem.appendChild(menuBtn);
    favoriteItem.appendChild(leftArrowBtn);
    favoriteItem.appendChild(rightArrowBtn);

    // Handle click behavior based on mode
    favoriteItem.addEventListener('click', (e) => {
      if (!isEditMode && !e.target.classList.contains('menu-btn') && !isDragging) {
        // In normal mode, clicking anywhere opens the link
        window.open(bookmark.url, '_blank');
      }
    });

    // Handle mouse events for drag & drop
    favoriteItem.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left mouse button
        longPressTimer = setTimeout(() => {
          startDrag(favoriteItem, e);
        }, 200); // 200ms long press
      }
    });

    favoriteItem.addEventListener('mouseup', () => {
      clearTimeout(longPressTimer);
    });

    favoriteItem.addEventListener('mouseleave', () => {
      clearTimeout(longPressTimer);
    });

    // Handle long press for mobile
    let mobileLongPressTimer;
    favoriteItem.addEventListener('touchstart', (e) => {
      if (!isEditMode) {
        mobileLongPressTimer = setTimeout(() => {
          e.preventDefault();
          const touch = e.touches[0];
          createContextMenu(bookmark, touch.clientX, touch.clientY);
        }, 500);
      }
    });

    favoriteItem.addEventListener('touchend', () => {
      clearTimeout(mobileLongPressTimer);
    });

    favoriteItem.addEventListener('touchmove', () => {
      clearTimeout(mobileLongPressTimer);
    });

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
      addToFavoritesBtn.textContent = '+';
      addToFavoritesBtn.title = 'Add to My Picks';
      
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
    
    // Update edit mode styling
    updateEditModeStyles();
  }

  // Update edit mode styles
  function updateEditModeStyles() {
    const favoritesSection = document.getElementById('favorites-section');
    const menuBtns = document.querySelectorAll('.menu-btn');
    const arrowBtns = document.querySelectorAll('.arrow-btn');
    
    if (isEditMode) {
      favoritesSection.classList.add('edit-mode');
      menuBtns.forEach(btn => btn.style.display = 'flex');
      arrowBtns.forEach(btn => btn.style.display = 'flex');
    } else {
      favoritesSection.classList.remove('edit-mode');
      menuBtns.forEach(btn => btn.style.display = 'none');
      arrowBtns.forEach(btn => btn.style.display = 'none');
    }
  }

  // Function to move bookmark position
  async function moveBookmarkPosition(bookmark, direction) {
    const favorites = await getFavorites();
    const currentIndex = favorites.findIndex(fav => fav.url === bookmark.url);
    
    if (currentIndex === -1) return;
    
    const newIndex = currentIndex + direction;
    
    // Check bounds
    if (newIndex < 0 || newIndex >= favorites.length) return;
    
    // Swap positions
    const temp = favorites[currentIndex];
    favorites[currentIndex] = favorites[newIndex];
    favorites[newIndex] = temp;
    
    // Save and re-render
    saveFavorites(favorites);
    renderFavorites();
  }

  // Function to add current page to favorites
  async function addCurrentPageToFavorites() {
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
      console.error('Error adding current page to My Picks:', error);
    }
  }

  // Toggle edit mode
  editToggleBtn.addEventListener('click', () => {
    isEditMode = !isEditMode;
    editToggleBtn.textContent = isEditMode ? 'Done' : 'Edit';
    editToggleBtn.classList.toggle('edit-active', isEditMode);
    updateEditModeStyles();
  });

  // Add button in header
  addBtn.addEventListener('click', addCurrentPageToFavorites);

  // Floating add button
  floatingAddBtn.addEventListener('click', addCurrentPageToFavorites);

  // Theme toggle
  themeToggle.addEventListener('click', () => {
    const newTheme = isDarkMode ? 'light' : 'dark';
    applyTheme(newTheme);
    saveTheme(newTheme);
  });

  // Initialize theme
  async function initializeTheme() {
    const savedTheme = await getTheme();
    applyTheme(savedTheme);
  }

  // Initialize
  chrome.bookmarks.getTree((bookmarkTree) => {
    renderBookmarkTree(bookmarkTree, bookmarksContainer);
  });

  renderFavorites();
  initializeTheme();

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
