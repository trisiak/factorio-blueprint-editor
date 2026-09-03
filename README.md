<img src="./.github/logo.svg" width="100%" align="right">

# factorio-blueprint-editor — mobile-first fork

A [Factorio](https://www.factorio.com) blueprint editor that runs in the
browser — **built to be used on a phone or tablet.**

**Try it:** https://trisiak.github.io/factorio-blueprint-editor/ — open it on a
touch device.

> **This is an independent fork** of
> [`Teoxoy/factorio-blueprint-editor`](https://github.com/Teoxoy/factorio-blueprint-editor)
> (hosted at [fbe.teoxoy.com](https://fbe.teoxoy.com)). It is not expected to
> merge back upstream, and it deploys on its own via GitHub Pages. Upstream is
> a desktop (mouse + keyboard) editor; this fork exists to make the same editor
> work on touch.

## Focus: mobile first, desktop best effort

The whole point of this fork is **touch**. Every slice of work is designed,
built and tested for a phone-sized touch screen first: tap-to-preview then
tap-to-confirm placement, pinch-zoom and two-finger pan, an on-screen action
rail in place of keybinds, canvas-drawn keypads and pickers instead of
keyboard-only inputs, and Playwright end-to-end coverage that runs on a
Pixel-7 device profile. What's done and what's next is tracked in
[`docs/mobile-controls.md`](./docs/mobile-controls.md).

**Desktop is best effort.** The mouse + keyboard path still exists and is kept
building, but:

- it is **known to be buggy** — regressions on desktop are tolerated when they
  are the price of a mobile improvement, and they are fixed opportunistically
  rather than urgently;
- it is **lagging behind** the mobile path — new UI (entity editors, panels,
  readouts) lands touch-first, and the desktop presentation may be older,
  missing, or simply the mobile one shown on a big screen;
- it is **not the reference** — when desktop and mobile disagree, mobile is
  the intended behaviour.

If you want a polished desktop blueprint editor, use upstream at
[fbe.teoxoy.com](https://fbe.teoxoy.com). Desktop bug reports here are welcome
but will be prioritised behind mobile work.

The two input paths are deliberately separate: the page runs in exactly one
**input mode** at a time, `mobile` (touch) or `desktop` (mouse/keyboard),
auto-detected and switchable from the settings pane. Appending `?desktopOnly`
to the URL restores the old "not supported on mobile" gate, for comparison.

![Preview](./.github/preview.png)

## What it does

- Render and edit blueprints and blueprint books, with undo/redo.
- Place, rotate, flip, copy, paste and delete entities and tiles — all reachable
  from the on-screen rail on touch, or from keybinds on desktop.
- Edit entity settings: recipes, modules, filters, logistic requests, train
  stops, and the full 2.0 circuit surface (combinators, enable conditions,
  read modes, wire colours). See [`docs/circuit-editing.md`](./docs/circuit-editing.md).
- Import from a pasted blueprint string; export back to a string.
- A built-in, persistent **blueprint library** so projects survive reloads
  without round-tripping strings through the clipboard
  ([`docs/blueprint-library.md`](./docs/blueprint-library.md)).
- A production **rate calculator** overlay
  ([`docs/rate-calculator.md`](./docs/rate-calculator.md)).
- Multiple **data packs**, chosen at runtime (`?pack=` or the settings pane):
  vanilla 2.0, Space Age, and Space Exploration
  ([`docs/space-exploration-support.md`](./docs/space-exploration-support.md)).
  Game data and sprites are published separately from
  [`trisiak/factorio-pack-data`](https://github.com/trisiak/factorio-pack-data);
  nothing generated is checked in here.
- Oil outpost generator, blueprint image export and "creative" entities,
  inherited from upstream.

Importing from a URL (`?source=https://pastebin.com/…`) relies on a CORS proxy
that does not run on GitHub Pages, so it does not work on the hosted build.
Paste-string import does.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup. Agents (and humans who
want the map) should read [`CLAUDE.md`](./CLAUDE.md) for the repo layout, the
commands, and the working agreements. Mobile and end-to-end work is the
priority; desktop-only fixes are welcome but low priority.

## Credits

This fork stands on [Teoxoy](https://github.com/Teoxoy)'s
factorio-blueprint-editor and the work of all of its contributors. Thanks to
everyone who submitted bugs and feature requests upstream, and to the Factorio
player GamesDan for reporting a lot of issues via doorbell.
