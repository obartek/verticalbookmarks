document.addEventListener('DOMContentLoaded', () => {
  // Notify that panel is opened when DOM is loaded
  chrome.runtime.sendMessage({ type: 'sidepanel_opened' });
  
  const favoritesContainer = document.getElementById('favorites-container');
  const bookmarksBarContainer = document.getElementById('bookmarks-bar-container');
  const otherBookmarksContainer = document.getElementById('other-bookmarks-container');
  const editToggleBtn = document.getElementById('edit-toggle-btn');
  const addBtn = document.getElementById('add-btn');
  const refreshBtn = document.getElementById('refresh-btn');

  const themeToggle = document.getElementById('theme-toggle');

  // Storage key for favorites
  const FAVORITES_KEY = 'vertical_bookmarks_favorites';
  const THEME_KEY = 'vertical_bookmarks_theme';
  const FOLDER_COLORS_KEY = 'vertical_bookmarks_folder_colors';
  
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
        const favorites = result[FAVORITES_KEY] || [];
        // Validate that we got an array
        if (Array.isArray(favorites)) {
          resolve(favorites);
        } else {
          console.error('Invalid favorites data in storage, resetting to empty array');
          resolve([]);
        }
      });
    });
  }

  // Save favorites to storage
  function saveFavorites(favorites) {
    // Validate input before saving
    if (!Array.isArray(favorites)) {
      console.error('Error: Attempted to save invalid favorites data');
      return;
    }
    
    // Filter out any invalid entries and ensure valid titles
    const validFavorites = favorites.filter(fav => 
      fav && typeof fav === 'object' && fav.url
    ).map(fav => {
      let title = fav.title && fav.title.trim() 
        ? fav.title.trim() 
        : 'Untitled';
      
      // If title is empty, try to use hostname as fallback
      if (!fav.title || !fav.title.trim()) {
        try {
          if (fav.url) {
            title = new URL(fav.url).hostname;
          }
        } catch (e) {
          title = 'Untitled';
        }
      }
      
      return {
        title: title,
        url: fav.url
      };
    });
    
    chrome.storage.local.set({ [FAVORITES_KEY]: validFavorites });
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

  // Get folder colors from storage
  function getFolderColors() {
    return new Promise((resolve) => {
      chrome.storage.local.get([FOLDER_COLORS_KEY], (result) => {
        resolve(result[FOLDER_COLORS_KEY] || {});
      });
    });
  }

  // Save folder colors to storage
  function saveFolderColors(colors) {
    chrome.storage.local.set({ [FOLDER_COLORS_KEY]: colors });
  }

  // Save expanded folder state
  function saveExpandedFolders() {
    const expandedFolders = new Set();
    const expandedElements = document.querySelectorAll('.folder-children[style*="block"]');
    
    expandedElements.forEach(element => {
      const folderHeader = element.previousElementSibling;
      if (folderHeader) {
        const titleElement = folderHeader.querySelector('.folder-title');
        if (titleElement) {
          // Use folder title as identifier (could be improved with unique IDs)
          expandedFolders.add(titleElement.textContent);
        }
      }
    });
    
    return expandedFolders;
  }

  // Restore expanded folder state
  function restoreExpandedFolders(expandedFolders) {
    if (!expandedFolders || expandedFolders.size === 0) return;
    
    setTimeout(() => {
      const allFolders = document.querySelectorAll('.folder-header');
      
      allFolders.forEach(folderHeader => {
        const titleElement = folderHeader.querySelector('.folder-title');
        if (titleElement && expandedFolders.has(titleElement.textContent)) {
          const childrenContainer = folderHeader.nextElementSibling;
          const expandIcon = folderHeader.querySelector('.expand-icon');
          
          if (childrenContainer && expandIcon) {
            childrenContainer.style.display = 'block';
            expandIcon.textContent = '▼';
          }
        }
      });
    }, 100); // Small delay to ensure DOM is updated
  }

  // Update specific folder color without full refresh
  async function updateFolderColor(folderId, color) {
    const colors = await getFolderColors();
    
    if (color === null) {
      // Remove color (reset to default)
      delete colors[folderId];
    } else {
      colors[folderId] = color;
    }
    
    saveFolderColors(colors);
    
    // Find and update the specific folder element using data-folder-id
    const folderHeader = document.querySelector(`[data-folder-id="${folderId}"]`);
    
    if (folderHeader) {
      const folderIcon = folderHeader.querySelector('.folder-icon');
      
      if (color) {
        folderHeader.classList.add('custom-color');
        folderHeader.style.borderColor = color;
        
        if (folderIcon) {
          folderIcon.classList.add('custom-folder-icon');
          folderIcon.style.setProperty('--folder-color', color);
          folderIcon.innerHTML = '';
        }
      } else {
        folderHeader.classList.remove('custom-color');
        folderHeader.style.borderColor = '';
        
        if (folderIcon) {
          folderIcon.classList.remove('custom-folder-icon');
          folderIcon.style.removeProperty('--folder-color');
          folderIcon.textContent = '📁';
        }
      }
    }
  }



  // Set color for a specific folder
  async function setFolderColor(folderId, color) {
    // Use optimized update instead of full refresh
    await updateFolderColor(folderId, color);
  }

  // Set color for a folder and all its subfolders recursively
  async function setFolderColorRecursive(folderId, color) {
    // Get all bookmark folders to find subfolders
    chrome.bookmarks.getTree(async (bookmarkTree) => {
      const folderIds = await getAllSubfolderIds(bookmarkTree, folderId);
      
      // Apply color to all found folders
      for (const id of folderIds) {
        await updateFolderColor(id, color);
      }
    });
  }

  // Helper function to get all subfolder IDs recursively
  async function getAllSubfolderIds(bookmarkTree, rootFolderId) {
    const folderIds = [rootFolderId]; // Include the root folder itself
    
    // Find the root folder in the tree
    const rootFolder = findFolderInTree(bookmarkTree, rootFolderId);
    if (rootFolder && rootFolder.children) {
      collectSubfolderIds(rootFolder.children, folderIds);
    }
    
    return folderIds;
  }

  // Helper function to find a folder by ID in the bookmark tree
  function findFolderInTree(bookmarkTree, targetId) {
    for (const root of bookmarkTree) {
      const result = searchFolderInNode(root, targetId);
      if (result) return result;
    }
    return null;
  }

  // Helper function to search for a folder in a node
  function searchFolderInNode(node, targetId) {
    if (node.id === targetId) return node;
    
    if (node.children) {
      for (const child of node.children) {
        const result = searchFolderInNode(child, targetId);
        if (result) return result;
      }
    }
    
    return null;
  }

  // Helper function to collect all subfolder IDs recursively
  function collectSubfolderIds(children, folderIds) {
    for (const child of children) {
      if (child.children) { // It's a folder
        folderIds.push(child.id);
        collectSubfolderIds(child.children, folderIds);
      }
    }
  }

  // Get contrast color for text (white or black) based on background color
  function getContrastColor(hexColor) {
    // Convert hex to RGB
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    
    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return black for light backgrounds, white for dark backgrounds
    return luminance > 0.5 ? '#000000' : '#ffffff';
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
        if (!link) return null;
        
        const url = link.href;
        if (!url || url === '#') return null;
        
        const favorite = favorites.find(fav => fav.url === url);
        return { 
          title: favorite ? favorite.title : 'Untitled', 
          url: url 
        };
      })
      .filter(item => item !== null); // Remove any null entries
    
    // Only save if we have valid data
    if (newOrder.length > 0) {
      saveFavorites(newOrder);
    }
    
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

  // Create context menu for My Picks
  function createContextMenu(bookmark, x, y) {
    // Remove existing context menu if any
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    
    // Temporarily position menu to calculate its size
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.visibility = 'hidden';
    document.body.appendChild(contextMenu);

    const openItem = document.createElement('div');
    openItem.className = 'context-menu-item';
    openItem.textContent = 'Open';
    openItem.addEventListener('click', () => {
      chrome.tabs.create({ url: bookmark.url, index: 999999 });
      contextMenu.remove();
    });

    const removeItem = document.createElement('div');
    removeItem.className = 'context-menu-item';
    removeItem.textContent = 'Delete';
    removeItem.addEventListener('click', async () => {
      try {
        const favorites = await getFavorites();
        const updatedFavorites = favorites.filter(fav => fav.url !== bookmark.url);
        
        // Validate that we actually have favorites and the filter worked
        if (Array.isArray(favorites) && favorites.length > 0) {
          saveFavorites(updatedFavorites);
          renderFavorites();
        } else {
          console.error('Error: No favorites found or invalid favorites data');
        }
      } catch (error) {
        console.error('Error removing favorite:', error);
      }
      contextMenu.remove();
    });

    contextMenu.appendChild(openItem);
    contextMenu.appendChild(removeItem);
    
    // Calculate menu dimensions and adjust position if needed
    const menuRect = contextMenu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    let finalX = x;
    let finalY = y;
    
    // Check if menu goes beyond right edge of screen
    if (x + menuRect.width > windowWidth) {
      finalX = windowWidth - menuRect.width - 10; // 10px margin from edge
    }
    
    // Check if menu goes beyond bottom edge of screen
    if (y + menuRect.height > windowHeight) {
      finalY = windowHeight - menuRect.height - 10; // 10px margin from edge
    }
    
    // Apply final position and make visible
    contextMenu.style.left = finalX + 'px';
    contextMenu.style.top = finalY + 'px';
    contextMenu.style.visibility = 'visible';

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };
    
    // Add listeners with a small delay to avoid immediate closure
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 10);
  }

  // Create Chrome-style context menu for bookmarks
  function createChromeBookmarkContextMenu(bookmark, x, y, isFolder = false) {
    // Remove existing context menu if any
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu chrome-bookmark-menu';
    
    // Temporarily position menu to calculate its size
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.visibility = 'hidden';
    document.body.appendChild(contextMenu);

    if (!isFolder) {
      // Open in New Tab
      const openNewTabItem = document.createElement('div');
      openNewTabItem.className = 'context-menu-item';
      openNewTabItem.textContent = 'Open in New Tab';
      openNewTabItem.addEventListener('click', () => {
        chrome.tabs.create({ url: bookmark.url, index: 999999 });
        contextMenu.remove();
      });
      contextMenu.appendChild(openNewTabItem);

      // Open in New Window
      const openNewWindowItem = document.createElement('div');
      openNewWindowItem.className = 'context-menu-item';
      openNewWindowItem.textContent = 'Open in New Window';
      openNewWindowItem.addEventListener('click', () => {
        chrome.windows.create({ url: bookmark.url });
        contextMenu.remove();
      });
      contextMenu.appendChild(openNewWindowItem);

      // Open in Incognito Window
      const openIncognitoItem = document.createElement('div');
      openIncognitoItem.className = 'context-menu-item';
      openIncognitoItem.textContent = 'Open in Incognito Window';
      openIncognitoItem.addEventListener('click', () => {
        chrome.windows.create({ url: bookmark.url, incognito: true });
        contextMenu.remove();
      });
      contextMenu.appendChild(openIncognitoItem);

      // Separator
      const separator1 = document.createElement('div');
      separator1.className = 'context-menu-separator';
      contextMenu.appendChild(separator1);
    }

    // Rename
    const renameItem = document.createElement('div');
    renameItem.className = 'context-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', () => {
      showEditDialog(bookmark, isFolder);
      contextMenu.remove();
    });
    contextMenu.appendChild(renameItem);

    if (isFolder) {
      // Color Folder…
      const changeColorItem = document.createElement('div');
      changeColorItem.className = 'context-menu-item';
      changeColorItem.textContent = 'Color Folder…';
      changeColorItem.addEventListener('click', () => {
        showColorPicker(bookmark, false); // false = single folder
        contextMenu.remove();
      });
      contextMenu.appendChild(changeColorItem);

      // Color All Folders…
      const changeAllColorsItem = document.createElement('div');
      changeAllColorsItem.className = 'context-menu-item';
      changeAllColorsItem.textContent = 'Color All Folders…';
      changeAllColorsItem.addEventListener('click', () => {
        showColorPicker(bookmark, true); // true = all subfolders
        contextMenu.remove();
      });
      contextMenu.appendChild(changeAllColorsItem);

      // Remove All Colors…
      const removeAllColorsItem = document.createElement('div');
      removeAllColorsItem.className = 'context-menu-item';
      removeAllColorsItem.textContent = 'Remove All Colors…';
      removeAllColorsItem.addEventListener('click', () => {
        if (confirm('Are you sure you want to remove colors from this folder and all its subfolders?')) {
          setFolderColorRecursive(bookmark.id, null); // null = remove color
        }
        contextMenu.remove();
      });
      contextMenu.appendChild(removeAllColorsItem);
    }

    // Separator
    const separator2 = document.createElement('div');
    separator2.className = 'context-menu-separator';
    contextMenu.appendChild(separator2);

    // Delete
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item delete-item';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete "${bookmark.title}"?`)) {
        chrome.bookmarks.remove(bookmark.id, () => {
          if (chrome.runtime.lastError) {
            console.error('Error deleting bookmark:', chrome.runtime.lastError);
          } else {
            // Refresh will happen automatically via bookmark change listener
          }
        });
      }
      contextMenu.remove();
    });
    contextMenu.appendChild(deleteItem);

    if (!isFolder) {
      // Separator
      const separator4 = document.createElement('div');
      separator4.className = 'context-menu-separator';
      contextMenu.appendChild(separator4);

      // Add Folder...
      const addFolderItem = document.createElement('div');
      addFolderItem.className = 'context-menu-item';
      addFolderItem.textContent = 'Add Folder...';
      addFolderItem.addEventListener('click', () => {
        showAddFolderDialog(bookmark.parentId);
        contextMenu.remove();
      });
      contextMenu.appendChild(addFolderItem);
    }

    // Calculate menu dimensions and adjust position if needed
    const menuRect = contextMenu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    let finalX = x;
    let finalY = y;
    
    // Check if menu goes beyond right edge of screen
    if (x + menuRect.width > windowWidth) {
      finalX = windowWidth - menuRect.width - 10; // 10px margin from edge
    }
    
    // Check if menu goes beyond bottom edge of screen
    if (y + menuRect.height > windowHeight) {
      finalY = windowHeight - menuRect.height - 10; // 10px margin from edge
    }
    
    // Apply final position and make visible
    contextMenu.style.left = finalX + 'px';
    contextMenu.style.top = finalY + 'px';
    contextMenu.style.visibility = 'visible';

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };
    
    // Add listeners with a small delay to avoid immediate closure
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 10);
  }

  // Show color picker for folders
  function showColorPicker(bookmark, applyToAll = false) {
    const dialog = document.createElement('div');
    dialog.className = 'bookmark-dialog';
    
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    
    const content = document.createElement('div');
    content.className = 'dialog-content color-picker-content';
    
    const title = document.createElement('h3');
    title.textContent = applyToAll ? 'Choose Color for All Folders' : 'Choose Folder Color';
    content.appendChild(title);
    
    // Color palette
    const colorPalette = document.createElement('div');
    colorPalette.className = 'color-palette';
    
    // Color palette matching the screenshot
    const colors = [
      { name: 'Default', color: null }, // null means reset to default
      { name: 'Gray', color: '#9E9E9E' },
      { name: 'Yellow', color: '#FFD54F' },
      { name: 'Orange', color: '#FF8A65' },
      { name: 'Light Green', color: '#81C784' },
      { name: 'Dark Gray', color: '#546E7A' },
      { name: 'Orange', color: '#FF9800' },
      { name: 'Red', color: '#F44336' },
      { name: 'Lime', color: '#CDDC39' },
      { name: 'Cyan', color: '#4FC3F7' },
      { name: 'Beige', color: '#D7CCC8' },
      { name: 'Pink', color: '#E91E63' },
      { name: 'Green', color: '#4CAF50' },
      { name: 'Blue', color: '#2196F3' },
      { name: 'Brown', color: '#8D6E63' },
      { name: 'Purple', color: '#9C27B0' },
      { name: 'Dark Green', color: '#388E3C' },
      { name: 'Blue', color: '#1976D2' },
      { name: 'Dark Red', color: '#D32F2F' },
      { name: 'Dark Pink', color: '#C2185B' },
      { name: 'Olive', color: '#827717' },
      { name: 'Brown', color: '#5D4037' },
      { name: 'Teal', color: '#00695C' },
      { name: 'Light Pink', color: '#F8BBD9' }
    ];
    
    colors.forEach(colorOption => {
      const colorItem = document.createElement('div');
      colorItem.className = 'color-item';
      colorItem.title = colorOption.name;
      
      if (colorOption.color === null) {
        // Default/reset option with crossed-out circle
        colorItem.classList.add('default-color');
        colorItem.innerHTML = '';
        colorItem.style.backgroundColor = '#f5f5f5';
        colorItem.style.position = 'relative';
        
        // Create the circle with diagonal line
        const circle = document.createElement('div');
        circle.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 20px;
          height: 20px;
          border: 2px solid #666;
          border-radius: 50%;
          background: transparent;
        `;
        
        const line = document.createElement('div');
        line.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(45deg);
          width: 24px;
          height: 2px;
          background: #666;
        `;
        
        colorItem.appendChild(circle);
        colorItem.appendChild(line);
      } else {
        colorItem.style.backgroundColor = colorOption.color;
      }
      
      colorItem.addEventListener('click', () => {
        if (applyToAll) {
          setFolderColorRecursive(bookmark.id, colorOption.color);
        } else {
          setFolderColor(bookmark.id, colorOption.color);
        }
        document.body.removeChild(dialog);
      });
      colorPalette.appendChild(colorItem);
    });
    
    content.appendChild(colorPalette);
    
    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'dialog-btn cancel-btn';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(dialog);
    });
    
    buttons.appendChild(cancelBtn);
    content.appendChild(buttons);
    
    dialog.appendChild(overlay);
    dialog.appendChild(content);
    document.body.appendChild(dialog);
  }

  // Show edit dialog for bookmarks
  function showEditDialog(bookmark, isFolder = false) {
    // Validate bookmark parameter
    if (!bookmark || (!bookmark.title && !bookmark.url)) {
      console.error('Invalid bookmark passed to showEditDialog');
      return;
    }
    
    const dialog = document.createElement('div');
    dialog.className = 'bookmark-dialog';
    
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    
    const content = document.createElement('div');
    content.className = 'dialog-content';
    
    const title = document.createElement('h3');
    title.textContent = isFolder ? 'Edit Folder' : 'Edit Bookmark';
    content.appendChild(title);
    
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name:';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = bookmark.title || '';
    nameInput.className = 'dialog-input';
    content.appendChild(nameLabel);
    content.appendChild(nameInput);
    
    let urlInput = null;
    if (!isFolder && bookmark.url) {
      const urlLabel = document.createElement('label');
      urlLabel.textContent = 'URL:';
      urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.value = bookmark.url || '';
      urlInput.className = 'dialog-input';
      content.appendChild(urlLabel);
      content.appendChild(urlInput);
    }
    
    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'dialog-btn cancel-btn';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(dialog);
    });
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'dialog-btn save-btn';
    saveBtn.addEventListener('click', () => {
      // Ensure we have a valid title
      let titleValue = nameInput.value.trim();
      if (!titleValue && !isFolder && urlInput && urlInput.value) {
        // If title is empty for bookmark, try to use hostname
        try {
          titleValue = new URL(urlInput.value).hostname;
        } catch (e) {
          titleValue = 'Untitled';
        }
      } else if (!titleValue) {
        titleValue = isFolder ? 'New Folder' : 'Untitled';
      }
      
      const updates = { title: titleValue };
      if (!isFolder && urlInput) {
        updates.url = urlInput.value;
      }
      
      chrome.bookmarks.update(bookmark.id, updates, () => {
        if (chrome.runtime.lastError) {
          console.error('Error updating bookmark:', chrome.runtime.lastError);
        } else {
          // Refresh will happen automatically via bookmark change listener
        }
      });
      
      document.body.removeChild(dialog);
    });
    
    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);
    content.appendChild(buttons);
    
    dialog.appendChild(overlay);
    dialog.appendChild(content);
    document.body.appendChild(dialog);
    
    nameInput.focus();
    nameInput.select();
    
    // Add Enter key support
    const handleEnterKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Execute save action directly
        // Ensure we have a valid title
        let titleValue = nameInput.value.trim();
        if (!titleValue && !isFolder && urlInput && urlInput.value) {
          // If title is empty for bookmark, try to use hostname
          try {
            titleValue = new URL(urlInput.value).hostname;
          } catch (e) {
            titleValue = 'Untitled';
          }
        } else if (!titleValue) {
          titleValue = isFolder ? 'New Folder' : 'Untitled';
        }
        
        const updates = { title: titleValue };
        if (!isFolder && urlInput) {
          updates.url = urlInput.value;
        }
        
        chrome.bookmarks.update(bookmark.id, updates, () => {
          if (chrome.runtime.lastError) {
            console.error('Error updating bookmark:', chrome.runtime.lastError);
          } else {
            // Refresh will happen automatically via bookmark change listener
          }
        });
        
        document.body.removeChild(dialog);
      }
    };
    
    nameInput.addEventListener('keydown', handleEnterKey);
    if (!isFolder && urlInput) {
      urlInput.addEventListener('keydown', handleEnterKey);
    }
  }



  // Show add folder dialog
  function showAddFolderDialog(parentId) {
    const dialog = document.createElement('div');
    dialog.className = 'bookmark-dialog';
    
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    
    const content = document.createElement('div');
    content.className = 'dialog-content';
    
    const title = document.createElement('h3');
    title.textContent = 'Add Folder';
    content.appendChild(title);
    
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name:';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'New folder';
    nameInput.className = 'dialog-input';
    content.appendChild(nameLabel);
    content.appendChild(nameInput);
    
    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'dialog-btn cancel-btn';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(dialog);
    });
    
    const createBtn = document.createElement('button');
    createBtn.textContent = 'Create';
    createBtn.className = 'dialog-btn save-btn';
    createBtn.addEventListener('click', () => {
      if (nameInput.value.trim()) {
        chrome.bookmarks.create({
          parentId: parentId,
          title: nameInput.value.trim()
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error creating folder:', chrome.runtime.lastError);
          }
        });
      }
      
      document.body.removeChild(dialog);
    });
    
    buttons.appendChild(cancelBtn);
    buttons.appendChild(createBtn);
    content.appendChild(buttons);
    
    dialog.appendChild(overlay);
    dialog.appendChild(content);
    document.body.appendChild(dialog);
    
    nameInput.focus();
    
    // Add Enter key support
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Execute create action directly
        if (nameInput.value.trim()) {
          chrome.bookmarks.create({
            parentId: parentId,
            title: nameInput.value.trim()
          }, () => {
            if (chrome.runtime.lastError) {
              console.error('Error creating folder:', chrome.runtime.lastError);
            }
          });
        }
        
        document.body.removeChild(dialog);
      }
    });
  }

  // Create favorite bookmark element
  function createFavoriteElement(bookmark) {
    const favoriteItem = document.createElement('div');
    favoriteItem.className = 'favorite-item';

    const link = document.createElement('a');
    link.href = '#';
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
        chrome.tabs.create({ url: bookmark.url, index: 999999 });
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

    // Handle right-click context menu
    favoriteItem.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      createContextMenu(bookmark, e.clientX, e.clientY);
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
  async function createBookmarkTreeElement(bookmark, isFolder = false) {
    const item = document.createElement('div');
    item.className = isFolder ? 'bookmark-folder' : 'bookmark-item-tree';

    if (isFolder) {
      const folderHeader = document.createElement('div');
      folderHeader.className = 'folder-header';
      folderHeader.dataset.folderId = bookmark.id; // Add folder ID for easy identification
      
      // Apply custom color if set
      const folderColors = await getFolderColors();
      if (folderColors[bookmark.id]) {
        folderHeader.classList.add('custom-color');
        folderHeader.style.borderColor = folderColors[bookmark.id];
        folderHeader.dataset.folderColor = folderColors[bookmark.id];
      }
      
      const expandIcon = document.createElement('span');
      expandIcon.className = 'expand-icon';
      expandIcon.textContent = '▶';
      
      const folderIcon = document.createElement('span');
      folderIcon.className = 'folder-icon';
      
      // Apply color to folder icon if custom color is set
      if (folderColors[bookmark.id]) {
        folderIcon.classList.add('custom-folder-icon');
        folderIcon.style.setProperty('--folder-color', folderColors[bookmark.id]);
        folderIcon.innerHTML = ''; // Clear content, will use CSS
      } else {
        folderIcon.textContent = '📁';
      }
      
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

      // Add right-click context menu for folders
      folderHeader.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        createChromeBookmarkContextMenu(bookmark, e.clientX, e.clientY, true);
      });
      
      item.appendChild(folderHeader);
      item.appendChild(childrenContainer);
      
      return { element: item, childrenContainer };
    } else {
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'bookmark-link';
      
      const favicon = document.createElement('img');
      favicon.src = 'icons/logo/logo-16-inactive.png';
      favicon.dataset.url = bookmark.url;
      favicon.className = 'bookmark-favicon';
      
      // Request favicon from background script
      chrome.runtime.sendMessage({ type: 'get_favicon', url: bookmark.url });
      
      const title = document.createElement('span');
      title.className = 'bookmark-title';
      // Show hostname if title is empty or just whitespace
      let displayTitle = bookmark.title && bookmark.title.trim() 
        ? bookmark.title.trim() 
        : 'Untitled';
      
      // If title is empty, try to use hostname as fallback
      if (!bookmark.title || !bookmark.title.trim()) {
        try {
          if (bookmark.url) {
            displayTitle = new URL(bookmark.url).hostname;
          }
        } catch (e) {
          displayTitle = 'Untitled';
        }
      }
      
      title.textContent = displayTitle;
      
      // Add to favorites button
      const addToFavoritesBtn = document.createElement('button');
      addToFavoritesBtn.className = 'add-to-favorites-btn';
      addToFavoritesBtn.textContent = '★';
      addToFavoritesBtn.title = 'Add to My Picks';
      
      addToFavoritesBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const favorites = await getFavorites();
        if (!favorites.some(fav => fav.url === bookmark.url)) {
          // Ensure we have a valid title, use URL as fallback if title is empty
          let bookmarkTitle = bookmark.title && bookmark.title.trim() 
            ? bookmark.title.trim() 
            : 'Untitled';
          
          // If title is empty, try to use hostname as fallback
          if (!bookmark.title || !bookmark.title.trim()) {
            try {
              if (bookmark.url) {
                bookmarkTitle = new URL(bookmark.url).hostname;
              }
            } catch (e) {
              bookmarkTitle = 'Untitled';
            }
          }
          
          favorites.push({ title: bookmarkTitle, url: bookmark.url });
          saveFavorites(favorites);
          renderFavorites();
        }
      });
      
      link.appendChild(favicon);
      link.appendChild(title);
      link.appendChild(addToFavoritesBtn);

      // Add click handler for bookmarks
      link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: bookmark.url, index: 999999 });
      });

      // Add right-click context menu for bookmarks
      link.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        createChromeBookmarkContextMenu(bookmark, e.clientX, e.clientY, false);
      });
      
      item.appendChild(link);
      return { element: item };
    }
  }

  // Render bookmarks tree for specific sections
  async function renderBookmarkTree(nodes, container) {
    container.innerHTML = '';
    
    async function traverse(nodes, parentContainer) {
      for (const node of nodes) {
        if (node.children) {
          // It's a folder
          const { element, childrenContainer } = await createBookmarkTreeElement(node, true);
          parentContainer.appendChild(element);
          await traverse(node.children, childrenContainer);
        } else if (node.url) {
          // It's a bookmark
          const { element } = await createBookmarkTreeElement(node, false);
          parentContainer.appendChild(element);
        }
      }
    }
    
    await traverse(nodes, container);
  }

  // Render all bookmark sections
  async function renderAllBookmarks(bookmarkTree) {
    // Clear both containers
    bookmarksBarContainer.innerHTML = '';
    otherBookmarksContainer.innerHTML = '';
    
    // Find the root bookmark folders
    if (bookmarkTree && bookmarkTree.length > 0 && bookmarkTree[0].children) {
      // Common folder names in different languages
      const bookmarkBarNames = [
        'Bookmarks bar', 'Bookmarks Bar', 'Pasek zakładek', 
        'Barre de favoris', 'Lesezeichenleiste', 'Barra de marcadores',
        'Barra dei segnalibri', 'ブックマークバー', '书签栏'
      ];
      
      const otherBookmarksNames = [
        'Other bookmarks', 'Other Bookmarks', 'Inne zakładki',
        'Autres favoris', 'Weitere Lesezeichen', 'Otros marcadores',
        'Altri segnalibri', 'その他のブックマーク', '其他书签'
      ];
      
      // Find bookmark folders by matching names
      const bookmarkBarNode = bookmarkTree[0].children.find(node => 
        bookmarkBarNames.some(name => 
          node.title.toLowerCase().includes(name.toLowerCase()) || 
          name.toLowerCase().includes(node.title.toLowerCase())
        ) || node.id === '1' // Fallback to ID for Bookmarks Bar
      );
      
      const otherBookmarksNode = bookmarkTree[0].children.find(node => 
        otherBookmarksNames.some(name => 
          node.title.toLowerCase().includes(name.toLowerCase()) || 
          name.toLowerCase().includes(node.title.toLowerCase())
        ) || node.id === '2' // Fallback to ID for Other Bookmarks
      );
      
      // Debug: log found folders
      console.log('Available bookmark folders:', bookmarkTree[0].children.map(node => ({ id: node.id, title: node.title })));
      console.log('Found Bookmarks Bar:', bookmarkBarNode ? bookmarkBarNode.title : 'Not found');
      console.log('Found Other Bookmarks:', otherBookmarksNode ? otherBookmarksNode.title : 'Not found');
      
      // Render Bookmarks Bar
      if (bookmarkBarNode && bookmarkBarNode.children) {
        await renderBookmarkTree(bookmarkBarNode.children, bookmarksBarContainer);
      }
      
      // Render Other Bookmarks  
      if (otherBookmarksNode && otherBookmarksNode.children) {
        await renderBookmarkTree(otherBookmarksNode.children, otherBookmarksContainer);
      }
    }
  }

  // Render favorites
  async function renderFavorites() {
    try {
      const favorites = await getFavorites();
      
      // Validate favorites data
      if (!Array.isArray(favorites)) {
        console.error('Error: Invalid favorites data, expected array');
        return;
      }
      
      // Store current favicon sources before clearing
      const currentFavicons = new Map();
      const existingFavicons = favoritesContainer.querySelectorAll('img[data-url]');
      existingFavicons.forEach(img => {
        if (img.src && !img.src.includes('logo-16-inactive.png')) {
          currentFavicons.set(img.dataset.url, img.src);
        }
      });
      
      favoritesContainer.innerHTML = '';
      
      favorites.forEach(bookmark => {
        if (bookmark && bookmark.url) {
          const favoriteElement = createFavoriteElement(bookmark);
          favoritesContainer.appendChild(favoriteElement);
          
          // Restore favicon if we had it cached
          const faviconImg = favoriteElement.querySelector('img[data-url]');
          if (faviconImg && currentFavicons.has(bookmark.url)) {
            faviconImg.src = currentFavicons.get(bookmark.url);
          }
        }
      });
      
      // Update edit mode styling
      updateEditModeStyles();
    } catch (error) {
      console.error('Error rendering favorites:', error);
    }
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
    try {
      const favorites = await getFavorites();
      
      if (!Array.isArray(favorites) || favorites.length === 0) {
        console.error('No favorites found to move');
        return;
      }
      
      const currentIndex = favorites.findIndex(fav => fav.url === bookmark.url);
      
      if (currentIndex === -1) {
        console.error('Bookmark not found in favorites');
        return;
      }
      
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
    } catch (error) {
      console.error('Error moving bookmark position:', error);
    }
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

  // Refresh button
  refreshBtn.addEventListener('click', async () => {
    // Prevent multiple clicks during refresh
    if (refreshBtn.classList.contains('refreshing')) {
      return;
    }
    
    await refreshAllData();
  });

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

  // Function to refresh bookmarks
  function refreshBookmarks() {
    chrome.bookmarks.getTree(async (bookmarkTree) => {
      await renderAllBookmarks(bookmarkTree);
    });
  }

  // Function to refresh all data (My Picks, bookmarks, and favicons)
  async function refreshAllData() {
    // Add refreshing animation
    refreshBtn.classList.add('refreshing');
    
    try {
      // First, reset all favicon to default icons
      const allFaviconImages = document.querySelectorAll('img[data-url]');
      allFaviconImages.forEach(img => {
        img.src = 'icons/logo/logo-16-inactive.png';
      });
      
      // Clear favicon cache by re-requesting all favicons
      const favorites = await getFavorites();
      const allBookmarks = [];
      
      // Collect all bookmark URLs from favorites
      favorites.forEach(fav => {
        if (fav.url) {
          allBookmarks.push(fav.url);
        }
      });
      
      // Collect all bookmark URLs from bookmark tree
      chrome.bookmarks.getTree(async (bookmarkTree) => {
        function collectBookmarkUrls(nodes) {
          nodes.forEach(node => {
            if (node.url) {
              allBookmarks.push(node.url);
            }
            if (node.children) {
              collectBookmarkUrls(node.children);
            }
          });
        }
        
        collectBookmarkUrls(bookmarkTree);
        
        // Refresh all UI components first
        await renderAllBookmarks(bookmarkTree);
        await renderFavorites();
        
        // Then request fresh favicons for all URLs
        const uniqueUrls = [...new Set(allBookmarks)];
        uniqueUrls.forEach(url => {
          chrome.runtime.sendMessage({ type: 'get_favicon', url: url, force_refresh: true });
        });
        
        // Remove refreshing animation after a short delay
        setTimeout(() => {
          refreshBtn.classList.remove('refreshing');
        }, 1500); // Slightly longer delay to allow favicons to load
      });
    } catch (error) {
      console.error('Error refreshing data:', error);
      refreshBtn.classList.remove('refreshing');
    }
  }

  // Initialize
  chrome.bookmarks.getTree(async (bookmarkTree) => {
    await renderAllBookmarks(bookmarkTree);
  });

  renderFavorites();
  initializeTheme();

  // Listen for favicon responses and bookmark changes
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'favicon_response' && message.dataUrl && message.url) {
      try {
        // Use CSS selector that properly escapes special characters in URLs
        const imgs = document.querySelectorAll(`img[data-url="${CSS.escape(message.url)}"]`);
        imgs.forEach(img => {
          // Verify the image element still exists and has the right URL
          if (img && img.dataset.url === message.url) {
            img.src = message.dataUrl;
          }
        });
      } catch (error) {
        console.error('Error updating favicon:', error);
      }
    } else if (message.type === 'bookmarks_changed') {
      // Refresh bookmarks when changes are detected
      console.log('Bookmarks changed, refreshing...');
      refreshBookmarks();
    }
  });

  // Handle visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      chrome.runtime.sendMessage({ type: 'sidepanel_closed' });
      // Close any open context menu when panel becomes hidden
      const existingMenu = document.querySelector('.context-menu');
      if (existingMenu) {
        existingMenu.remove();
      }
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

// Close any open context menu when the panel loses focus
window.addEventListener('blur', () => {
  const existingMenu = document.querySelector('.context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }
});

// Additional listener for focus out events
document.addEventListener('focusout', (e) => {
  // Check if the new focus target is outside the side panel
  setTimeout(() => {
    if (!document.hasFocus()) {
      const existingMenu = document.querySelector('.context-menu');
      if (existingMenu) {
        existingMenu.remove();
      }
    }
  }, 100);
});
