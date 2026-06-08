#!/bin/bash
set -euo pipefail

# Prepares a Claude Code on the web container so tests/linters/e2e can run.
# Runs at container build time (network available), and the result is cached.
# Skip outside remote sessions so local dev isn't forced through it.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# JS deps. The project requires --legacy-peer-deps (see CONTRIBUTING.md).
npm install --legacy-peer-deps

# Browser for the Playwright e2e suite. Touch emulation runs on chromium; the
# CDN must be reachable from the build environment (allowlist cdn.playwright.dev
# / playwright.download.prss.microsoft.com if egress is restricted).
npx --yes playwright install --with-deps chromium
