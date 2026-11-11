# Arbor

A desktop browser that keeps tabs as trees.

Arbor is a Chromium-based desktop browser built with Electron. Tabs opened from another tab become its children, so related browsing stays grouped in a tab tree instead of a flat list. Each tab tree lives in its own Container, an isolated browsing space with its own cookies, storage and cache.

## Features

- Tab trees: a tab opened from another tab is its child; closing a tab promotes its children into its place
- Containers: one isolated Electron session per Container, like Firefox Multi-Account Containers
- Omnibox: one input for addresses and search queries, with suggestions
- Chrome extensions: install from the Chrome Web Store, pin extension buttons to the URL bar, and review per-extension consent for permissions and sites
- Downloads: download list with history and progress
- Cross platform: macOS (arm64), Windows (x64 and arm64) and Linux

## Installation

Arbor is not published to npm. Get a build from [GitHub Releases](https://github.com/rom100main/arbor/releases), or build it from source below.

## Support

For bug reports and feature requests, please open an issue at the [GitHub repository](https://github.com/rom100main/arbor/issues).

## Changelog

See [CHANGELOG](CHANGELOG.md) for a list of changes in each version.

## Documentation

Look at [docs/](docs/) folder.

## Contributing

For development information, see [CONTRIBUTING](CONTRIBUTING.md).

## License

MIT
