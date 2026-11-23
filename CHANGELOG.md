# Changelog

All notable changes will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-11-23

### Added

- Star button in the url bar to bookmark the current page
- Toolbar bookmark button opens the favorites popup, where favorites can be browsed and organized into folders
- Omnibox suggests favorites
- New tab page with a search bar using the same suggestions as the url bar, and a Customize button that opens its settings
- New Tab settings: background follows the theme, a custom color, or a custom image, and the search bar can be shown or hidden
- Favorites in the protected New Tab folder are shown on the new tab page
- Make Arbor the default browser for http and https links from the new General settings page, Arbor is now registered with the OS for those schemes

### Changed

- New tabs now open the new tab page instead of a blank page

### Fixed

- Favicons disappearing when navigating within a site that reuses the same favicon
- Back and forward buttons greyed out when unavailable
- Tabs could not be collapsed when the active tab was in their subtree
- Closing or hibernating a tab could leave a hibernated fallback tab unloaded, the fallback now loads when activated
- New tabs were displayed as `about:blank` instead of "New tab" in the tab tree

## [0.4.0] - 2026-11-18

### Added

- Find in page with Cmd/Ctrl+F: match count, previous/next, case-sensitive, whole-word and regex options
- Hibernate tabs and containers from the right-click menu to unload pages and save memory, hibernated tabs stay in the tree and reload when activated
- Tabs not loaded are greyed out in the tab tree
- Confirmation popup when closing a container's last tab

### Changed

- In fullscreen the tab tree and url bar are hidden and float over the page on edge hover, so the page gets the whole window

### Fixed

- History entries show the container they were last visited from

## [0.3.0] - 2026-11-16

### Added

- Ad and tracker blocking, powered by Ghostery
- Ad blocking section in Settings, to turn protection on or off
- Per-site disable list in Ad blocking Settings, with `*` wildcard matching

### Fixed

- Pages flagged as insecure due to the browser User-Agent

## [0.2.0] - 2026-11-14

### Added

- Extensions page in settings, with a shortcut to the Chrome Web Store and to the `dev-extensions` folder
- Dev extensions now work in the released app: drop an unpacked extension folder into `dev-extensions` and approve it on startup
- Omnibox host emphasis: scheme, port, path, query and fragment are greyed out, the host stays full-strength
- Six new icons for containers and tabs: photo, folder, link, desktop, clock and sun
- Branded macOS DMG installer background matching the app icon, with drag-to-Applications instructions

### Changed

- Windows always open maximized
- Settings text is larger and easier to read
- Rename popup revamped: larger input, colors and icons, and buttons

### Fixed

- Omnibox URL empty at launch and when switching tabs
- Extension MV3 workers failing to start, extension popups not waking the worker or not seeing tabs from container sessions, and frozen `chrome` globals breaking polyfills and lazy APIs
- Extension storage losing chunked values on reload, due to missing quota fallbacks

## [0.1.0] - 2026-11-12

### Added

- Tab trees: any tab you open from another tab becomes its child, so related pages stay grouped together
- Containers: one isolated session per Container, with its own cookies, storage and cache
- Close history: closed tabs with their subtrees can be reopened, most recent first
- Omnibox with address, search and history suggestions
- Chrome extensions support, installable from the Chrome Web Store, can pinned extension buttons and per-extension consent
- Downloads with list, progress and history
- Internal `arbor://` pages, including settings and a history page
- Browsing history: visited pages are recorded and shown with search, container filter, bulk and time-based delete. In settings can disable saving or auto-delete visits after 30 days / 90 days / 1 year
- Hidden OS title bar: no native title bar. A custom title bar is revealed on top-edge hover, like the toolbar, with the native window buttons appearing while it is out
- In-app updates from GitHub Releases
- Packaged builds for macOS arm64, Windows x64/arm64 and Linux
- CI and Release workflows, and license compliance checks
