(function() {
  if (window.verticalBookmarksInjected) {
    return;
  }
  window.verticalBookmarksInjected = true;

  const SIDEBAR_ID = 'vertical-bookmarks-sidebar';
  const STORAGE_KEY = 'vBookmarksLayout';

  // Function to create and inject the sidebar
  function injectSidebar() {
    if (document.getElementById(SIDEBAR_ID)) {
      return;
    }

    const sidebar = document.createElement('div');
    sidebar.id = SIDEBAR_ID;
    
    // Header with column toggles
    const header = createHeader();
    sidebar.appendChild(header);

    // Grid for bookmarks
    const grid = document.createElement('div');
    grid.className = 'v-bookmarks-grid';
    sidebar.appendChild(grid);
    
    document.body.appendChild(sidebar);

    // Apply saved layout
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const columns = result[STORAGE_KEY] || 4; // Default to 4 columns
      updateLayout(columns);
    });

    // Request bookmarks from background script
    chrome.runtime.sendMessage({ action: 'getBookmarks' }, (response) => {
      if (response && response.bookmarks) {
        renderBookmarks(response.bookmarks, grid);
      }
    });
  }

  // Function to create the header with buttons
  function createHeader() {
    const header = document.createElement('div');
    header.className = 'v-bookmarks-header';

    const btn3 = document.createElement('button');
    btn3.textContent = '3 Columns';
    btn3.dataset.columns = '3';
    
    const btn4 = document.createElement('button');
    btn4.textContent = '4 Columns';
    btn4.dataset.columns = '4';

    header.appendChild(btn3);
    header.appendChild(btn4);

    header.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        const columns = parseInt(e.target.dataset.columns, 10);
        updateLayout(columns);
        chrome.storage.local.set({ [STORAGE_KEY]: columns });
      }
    });

    return header;
  }

  function updateLayout(columns) {
    const sidebar = document.getElementById(SIDEBAR_ID);
    const grid = sidebar.querySelector('.v-bookmarks-grid');
    const body = document.body;

    const columnClass = columns === 3 ? 'three-cols' : 'four-cols';
    const otherClass = columns === 3 ? 'four-cols' : 'three-cols';

    // Update classes on elements
    sidebar.classList.add(columnClass);
    sidebar.classList.remove(otherClass);
    grid.classList.add(columnClass);
    grid.classList.remove(otherClass);
    body.classList.add('v-bookmarks-active', columnClass);
    body.classList.remove(otherClass);

    // Update active state on buttons
    const buttons = sidebar.querySelectorAll('.v-bookmarks-header button');
    buttons.forEach(btn => {
      if (parseInt(btn.dataset.columns, 10) === columns) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Function to render bookmarks in the sidebar
  function renderBookmarks(bookmarks, grid) {
    grid.innerHTML = ''; // Clear previous bookmarks
    bookmarks.forEach(bookmark => {
      const item = document.createElement('a');
      item.className = 'v-bookmark-item';
      item.href = bookmark.url;
      item.target = '_blank'; // Open in new tab

      // Favicon
      const icon = document.createElement('img');
      icon.className = 'v-bookmark-icon';
      icon.src = `https://www.google.com/s2/favicons?domain=${new URL(bookmark.url).hostname}&sz=32`;
      // Fallback for icons that fail to load
      icon.onerror = () => {
          icon.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22 viewBox=%220 0 24 24%22><path fill=%22gray%22 d=%22M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z%22/%3e</svg>';
      };


      // Tooltip
      const tooltip = document.createElement('span');
      tooltip.className = 'v-tooltip';
      tooltip.textContent = bookmark.title;

      item.appendChild(icon);
      item.appendChild(tooltip);
      grid.appendChild(item);
    });
  }

  // Function to remove the sidebar
  function removeSidebar() {
    const sidebar = document.getElementById(SIDEBAR_ID);
    if (sidebar) {
      sidebar.remove();
    }
    document.body.classList.remove('v-bookmarks-active', 'three-cols', 'four-cols');
  }

  // Listen for messages from the background script to toggle the sidebar
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleSidebar') {
      if (request.isEnabled) {
        injectSidebar();
      } else {
        removeSidebar();
      }
    }
  });

  // Initial check on load
  chrome.storage.local.get('isEnabled', ({ isEnabled }) => {
    if (isEnabled) {
      injectSidebar();
    }
  });

})(); 