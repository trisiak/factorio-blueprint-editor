#!/bin/bash
set -euo pipefail

# Prepares a Claude Code on the web container so tests / linters / e2e can run.
# Runs at session start (network available) and the container state is cached.
# Skip outside remote sessions so local dev isn't forced through it.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# JS deps only. The project REQUIRES --legacy-peer-deps (a plain `npm install`
# fails); see CONTRIBUTING.md / CLAUDE.md. Idempotent — safe to re-run.
npm install --legacy-peer-deps

# NOTE: deliberately no `playwright install`. This environment ships a
# pre-installed Chromium under /opt/pw-browsers (matching the pinned
# @playwright/test build); the env var PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
# in .claude/settings.json points Playwright at it, so `npm run test:e2e` works
# without a download. The browser-download CDN isn't in the egress allowlist, so
# `playwright install` would 403 and (under `set -e`) fail the whole hook —
# that's exactly why the previous hook was dropped.
