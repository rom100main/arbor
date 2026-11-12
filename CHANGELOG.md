# Changelog

All notable changes will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
