# Browser Automation

How to drive a browser from this WSL2 workspace for visual checks and scripted automation.

## Status

- Host is Windows 11 + WSL2 (Ubuntu 24.04). The ZCode desktop app's browser-use plugin is broken here: the `agent.browsers` registry is empty, so the in-session browser skill gets no backend. Upstream issue (open, P2 as of 2026-09-03): https://github.com/zai-org/feedback/issues/340 — check it before assuming this is still broken.
- An empty `agent.browsers` registry is an environment failure, not a reason to abandon a browser task. Use the routes below.

## Route A — WSL-local headless Chrome (default)

- Google Chrome is installed at `/usr/bin/google-chrome-stable` (`/usr/bin/chromium-browser` and snap chromium also exist). `playwright-core` is already in `node_modules` (e2e setup). Playwright launches the browser directly — no CDP port, no portproxy.
- Run from the repo root with the project's Node:

  ```js
  // node script.js
  const { chromium } = require('playwright-core');
  (async () => {
    const browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: '/tmp/page.png' });
    await browser.close();
  })().catch(e => { console.error(e.message); process.exit(1); });
  ```

- Verified 2026-09-03 for navigation, screenshots, and general automation against https://omf-therapie.fr/; works the same against `http://localhost:4321` while `npm run dev` runs.

## Route B — Windows Edge over CDP (exception)

Only when a visible window on the Windows desktop or Edge-specific rendering is required.

1. Launch Edge headless on Windows from WSL (interop):
   `/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe --headless=new --remote-debugging-port=9222 --user-data-dir=C:\\temp\\edge-cdp --no-first-run about:blank &`
2. Chromium binds the CDP port to Windows loopback only. A `netsh interface portproxy` (`0.0.0.0:9223 → 127.0.0.1:9222`) plus an inbound firewall rule named `WSL-CDP-9223` bridge the NAT boundary. Both were added elevated (UAC) on 2026-09-03 and persist across reboots.
3. From WSL, derive the gateway with `ip route show default` and connect: `chromium.connectOverCDP('http://<GATEWAY>:9223/')`. The gateway changes on WSL restarts (was `192.168.128.1` on 2026-09-03) — always re-derive it, never hardcode.
4. Cleanup (elevated PowerShell, only if unwanted): `netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=9223`, then `Remove-NetFirewallRule -DisplayName WSL-CDP-9223`.

## Alternatives

- Starting the ZCode CLI with `--browser-use=headless` registers a managed Chromium as a `cdp` backend for the browser-use plugin — an option if a plugin backend is ever needed properly.

## Constraints

- Browser checks are read-only QA against the dev server or live site; they do not replace the quality gates in `testing.md`.
- Respect the WSL memory guard (AGENTS.md): never run full test suites or builds in parallel with other agents.
