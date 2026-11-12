# Privacy Policy

_Last updated: 2026-11-12_

TabRoute does **not** collect, store, sell or send any personal data.

## What TabRoute does with your data

- **Settings** (proxy host, port, domain patterns, never-proxy list, header options) are saved with `chrome.storage.local`, on your own computer.
- **Captured tabs** (tab IDs and the hostnames they contacted) are kept in `chrome.storage.session` and are cleared when the browser closes.
- **Browsing traffic** is sent only to the proxy address **you** configure, such as Burp Suite on `127.0.0.1:8080`. TabRoute never sends traffic or data anywhere else.
- The **Test** button sends one request to your configured proxy address, to check that it responds.

## What TabRoute does not do

- No analytics, telemetry, tracking or crash reporting.
- No remote code. Everything the extension runs is included in the package.
- No ads and no third-party services.

## Permissions

See the [Permissions](README.md#permissions) section of the README for why each permission is needed.

## Contact

Questions? Open an issue at <https://github.com/rafsanzami/tabroute/issues>.
