# Changelog

All notable changes will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Tab trees: tabs opened from another tab are its children, and closing a tab promotes its children into its place
- Containers: one isolated session per Container, with its own cookies, storage and cache
- Close history: closed tabs with their subtrees can be reopened, most recent first
- Omnibox with address and search suggestions
- Chrome extensions support, including pinned extension buttons and per-extension consent
- Downloads with list, progress and history
- Internal `arbor://` pages, including settings
- In-app updates from GitHub Releases
- Packaged builds for macOS arm64, Windows x64/arm64 and Linux
- CI and Release workflows, and license compliance checks
