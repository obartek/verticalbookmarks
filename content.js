// Content script to enable drag & drop from external web pages
// This script adds DownloadURL support to links so they can be dragged into the bookmark sidebar

(function() {
  'use strict';
  
  // Track if we've already initialized
  if (window.verticalBookmarksInitialized) {
    return;
  }
  window.verticalBookmarksInitialized = true;
  
  // Add drag functionality to all links
  function addDragToLinks() {
    const links = document.querySelectorAll('a[href]');
    
    links.forEach(link => {
      // Skip if already processed
      if (link.dataset.verticalBookmarksProcessed) {
        return;
      }
      
      link.dataset.verticalBookmarksProcessed = 'true';
      
      // Make link draggable
      link.draggable = true;
      
      // Add dragstart event listener
      link.addEventListener('dragstart', function(e) {
        const url = this.href;
        const title = this.textContent.trim() || this.title || this.alt || url;
        
        // Set data for drag & drop
        e.dataTransfer.setData('text/uri-list', url);
        e.dataTransfer.setData('text/plain', title);
        
        // Add DownloadURL for Chrome compatibility
        const filename = extractFilename(url, title);
        e.dataTransfer.setData('DownloadURL', `text/html:${filename}:${url}`);
        
        // Set drag effect
        e.dataTransfer.effectAllowed = 'copy';
        
        // Add visual feedback
        this.style.opacity = '0.7';
        setTimeout(() => {
          this.style.opacity = '';
        }, 100);
      });
      
      // Add dragend event listener
      link.addEventListener('dragend', function(e) {
        this.style.opacity = '';
      });
    });
  }
  
  // Extract filename from URL and title
  function extractFilename(url, title) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace('www.', '');
      
      // Use title if available and meaningful
      if (title && title !== url && title.length > 0 && title.length < 100) {
        return sanitizeFilename(title) + '.html';
      }
      
      // Extract from path
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      if (pathParts.length > 0) {
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart.length > 0) {
          return sanitizeFilename(lastPart) + '.html';
        }
      }
      
      // Use hostname as fallback
      return sanitizeFilename(hostname) + '.html';
    } catch (e) {
      return 'bookmark.html';
    }
  }
  
  // Sanitize filename for download
  function sanitizeFilename(filename) {
    return filename
      .replace(/[^a-zA-Z0-9\-_\s]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .substring(0, 50); // Limit length
  }
  
  // Add drag functionality to page text selections
  function addDragToSelections() {
    document.addEventListener('dragstart', function(e) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const selectedText = selection.toString().trim();
        
        // Check if selected text looks like a URL
        if (isValidUrl(selectedText)) {
          e.dataTransfer.setData('text/uri-list', selectedText);
          e.dataTransfer.setData('text/plain', selectedText);
          e.dataTransfer.effectAllowed = 'copy';
        }
      }
    });
  }
  
  // Check if text is a valid URL
  function isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }
  
  // Initialize drag functionality
  function init() {
    addDragToLinks();
    addDragToSelections();
    
    // Watch for new links added dynamically
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the node itself is a link
              if (node.tagName === 'A' && node.href) {
                if (!node.dataset.verticalBookmarksProcessed) {
                  addDragToLinks();
                }
              }
              // Check for links within the added node
              else if (node.querySelectorAll) {
                const newLinks = node.querySelectorAll('a[href]');
                if (newLinks.length > 0) {
                  addDragToLinks();
                }
              }
            }
          });
        }
      });
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Also initialize on page load for dynamic content
  window.addEventListener('load', function() {
    setTimeout(addDragToLinks, 1000); // Delay for dynamic content
  });
  
})(); 