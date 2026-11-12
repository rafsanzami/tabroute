# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-12

### Added
- Proxy modes: All traffic, Selected tabs, Domains, Incognito.
- Per-tab capture from the popup or with the keyboard shortcut <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.
- Automatic host discovery for captured tabs, applied through a generated PAC script.
- `X-Burp-Tab` request header on captured-tab requests, with a configurable name.
- Toolbar icon that shows each tab's state: off, on but direct, or proxied.
- One-click on/off switch that remembers the last used mode.
- Never-proxy list, Test button, and Burp CA certificate link.
- Light and dark theme.
