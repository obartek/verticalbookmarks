# Vertical Bookmarks Extension

Chrome extension that provides a vertical bookmarks sidebar with drag & drop functionality.

## Features

### 🌟 Core Features
- **Vertical sidebar** with bookmarks organized in sections
- **MyPicks favorites** - custom bookmark collection with grid layout
- **Bookmarks Bar & Other Bookmarks** - standard Chrome bookmarks
- **Dark/Light mode** toggle
- **Drag & drop reordering** within sections

### 🆕 NEW: External Drag & Drop
- **Drag links from any website** directly into your bookmark sections
- **Drag selected URLs** from text to create bookmarks
- **Visual feedback** with green drop indicators
- **Smart bookmark naming** based on page titles and URLs
- **Works with all websites** - automatically enhances all links

## How to Use

### Basic Usage
1. Click the extension icon to open the sidebar
2. Browse your bookmarks in the organized sections
3. Use the "Add" button to add current page to MyPicks
4. Toggle edit mode to rearrange bookmarks

### 🔥 Drag & Drop from External Sites
1. **Open the sidebar** (click extension icon)
2. **Navigate to any website** (like the included `test-drag-drop.html`)
3. **Drag any link** from the webpage
4. **Drop it** into either "Bookmarks Bar" or "Other Bookmarks" section
5. **See the green line** indicating where the bookmark will be placed
6. **Release** to create the bookmark instantly

### Supported Drag Sources
- **Website links** (`<a>` tags) - automatically enhanced
- **Selected text URLs** - select and drag URL text
- **Browser bookmark bar** - drag from Chrome's native bookmark bar

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your toolbar

## Testing

Open `test-drag-drop.html` in Chrome to test the drag & drop functionality with various link types.

## Technical Details

### Files Structure
- `manifest.json` - Extension configuration
- `sidepanel.html/css/js` - Main sidebar interface
- `content.js` - Injected script for external drag & drop
- `background.js` - Service worker for extension management

### Drag & Drop Implementation
- Uses HTML5 Drag & Drop API
- Content script enhances all links with `draggable` attribute
- Sets `text/uri-list` and `DownloadURL` data for compatibility
- Side panel listens for external drops and creates bookmarks via Chrome API

### Permissions
- `sidePanel` - For sidebar functionality
- `bookmarks` - To read/write bookmarks
- `storage` - For settings and favorites
- `activeTab` - For current page operations
- `<all_urls>` - For content script injection

## Browser Compatibility

- **Chrome 114+** (requires Side Panel API)
- **Manifest V3** compliant

## Privacy

- No data collection or external communication
- All data stored locally in Chrome's storage
- Content script only adds drag functionality, doesn't read page content

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - see LICENSE file for details. 