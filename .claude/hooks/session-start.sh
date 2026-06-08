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
# pre-installed Chromium that @playwright/test targets, and the browser-download
# CDN isn't in the egress allowlist — adding it back would 403 and (under
# `set -e`) fail the whole hook. That's exactly why the previous hook was dropped.
