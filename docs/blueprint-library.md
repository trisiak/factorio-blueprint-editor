# Blueprint Library (design + tracking companion)

Companion to **issue #50**. This is the durable design record; the issue is the
index/checklist. Keep them reconciled (see the "Keep issues in sync" rule in
`CLAUDE.md`): if this doc says ✅ and the issue box is unchecked, one of them is
wrong.

## What it is

An **in-app, persistent, organized home** for blueprint projects — "a blueprint
book that's inherent to the app." You can keep iterating on projects over time
without exporting strings to some external place, and without the risk of
silently overwriting work. Local-only for now (no account needed), with a
trajectory toward an OAuth-locked external backend (e.g. Firebase) later.

## Locked design decisions

- **Organization: folders / tree.** Projects live in a nestable tree.
- **Top tier is per modpack.** The tree's top level is one node per data pack
  (`vanilla-2.0`, `space-age`, `space-exploration`); under each, ad-hoc user
  folders + blueprints. This is also how a blueprint's **pack** is encoded
  (positionally — by which pack subtree it lives in).
- **Storage: a rich JSON document in IndexedDB, from the start.** We are _not_
  storing the library as one native blueprint string. Because an OAuth'd external
  backend (e.g. Firebase) is the intended trajectory, a structured document is
  both feasible and convenient — it holds the tree, per-leaf pack, timestamps,
  and version snapshots natively. IndexedDB (not localStorage) is the v1 backing
  store; its larger quota and structured-clone storage suit book-sized payloads,
  and a single JSON document maps cleanly onto a future Firebase doc. The store
  sits behind a `LibraryStore` interface so the backend can be swapped.
- **Native blueprint string = the interchange projection only.** Export _any_
  node (a single blueprint, a folder, a pack, the whole library) to a native
  Factorio string; import a pasted string by grafting it as a subtree under a
  chosen parent. The native string is for portability/sharing, never the system
  of record.
- **Per-modpack scratchpad — always live, never versioned.** Each pack subtree
  always has a Scratchpad: the default landing place for transient work, replacing
  today's single `fbe:blueprint` autosave (global, silently overwritten). It's
  continuously autosaved but holds **no versions** — you can't Save a checkpoint
  into it, only **Save as…** a named copy. It's never reported as "modified".
- **The active leaf _is_ the working context.** Opening an entry makes it the
  active leaf; the canvas edits it directly, and the active project's name is
  shown in a top-centre indicator. Each pack remembers its own active leaf
  (persisted), so a reload reopens what you were working on.
- **Autosave (live) vs. Save (checkpoint) — a backup model.** A leaf has two
  things: its **live `encoded`** (continuously autosaved on `visibilitychange`,
  so uncommitted edits are _persisted_ and survive reloads) and **`snapshots[]`**
  — explicit version checkpoints (last N kept, pruned, identical/empty saves
  skipped). "Modified" is **derived, not transient**: it's simply `encoded ≠
newest snapshot` (uncommitted edits), recomputed on load and shown as the
  indicator's dot. **Restore** (Phase 3 UI; `restoreSnapshot` exists) overwrites
  the live content with a chosen version — explicit-only, so it does _not_
  auto-snapshot, and the UI should confirm when there are uncommitted edits to
  overwrite; saving afterward records the restored content as the new newest
  version. So history is **time-linear, per-leaf, no branches/tags** — a backup,
  not a VCS. The **scratchpad is exempt** (always live, no versions, never
  modified). **Save As** makes a new named leaf and switches to it.
- **"Open a new project" + recents.** Loading the site with a `?source=` URL
  creates an _implied separate entry_ under an auto-created **"Imported"** folder
  (it joins recents and never clobbers the scratchpad). An explicit "new project"
  action resets the scratchpad and, when there are unsaved changes, prompts first.
  A **recents** list keeps the last N entries opened. (What becomes a recent vs.
  what merely modifies the scratchpad, and how imported _books_ decompose into a
  folder of blueprints, are deliberately deferred — the model carries what's
  needed so we can decide later.)

## The modpack-encoding problem

A native blueprint-book string has **no field for which data pack renders it**,
but the editor needs one (`DATA_PACK` in `editor/src/common/globals.ts`; a
blueprint references prototype names that only exist in a given pack — `loadBp`
in `website/src/index.ts` already errors on a pack mismatch).

Because storage is a rich document, the pack is just a field on each pack subtree
(and inherited by its leaves) — no encoding gymnastics needed internally. The
problem only resurfaces at the **native interchange boundary**:

- **Export:** encode the pack positionally. When exporting a whole pack or the
  whole library, name the top-level book(s) after the pack id (`label` == pack
  id) so the pack survives as far as a native string can carry it.
- **Import:** the top-level book label _is_ the pack hint; `importString` returns
  it as `packHint` for routing.

> Resolved (Phase 4): the pack-label mechanism is the **top-level `label` == pack
> id** convention (`exportPack`/`exportLibrary` apply it; `importString` surfaces
> it as `packHint`). The UI doesn't yet route by it — Import… grafts into the
> browsed pack — so honouring `packHint` (and prompting when it's unrecognised) is
> the remaining follow-up.

## Architecture / seams (reuse, don't reinvent)

- **Currency:** `encode(Blueprint|Book) → string` and
  `getBlueprintOrBookFromSource(source) → Blueprint|Book` (`editor/src/core/bpString.ts`,
  re-exported from `@fbe/editor`). A leaf stores the encoded string as its
  payload; the editor consumes/produces it through these. (`decode` itself is not
  exported — go through `getBlueprintOrBookFromSource`.)
- **Generalize the existing autosave:** `website/src/blueprintStorage.ts`
  persists _one_ encoded string and is pure + unit-tested. The library is the
  same idea scaled to a tree of named entries — model the pure parts the same way
  (deterministic, unit-tested), with the IndexedDB backing behind an interface.
- **Open onto the canvas:** `loadBp(bpOrBook)` in `website/src/index.ts` is the
  single swap-in point. "Open leaf" = `loadBp(await getBlueprintOrBookFromSource(entry.encoded))`;
  read the leaf's pack and offer to switch `DATA_PACK` (via `setDataPack`) when it
  differs from the active pack — reusing the cross-pack guard already in
  `loadBp`.
- **Per-entry copy:** reuse the existing `copyBlueprintToClipboard` / `encode`.
- **Native nesting already exists:** `Book` / `IBlueprintBook`
  (`editor/src/core/Book.ts`) model nested books + labels + icons — folders map
  onto nested books, which is what makes native subtree export/import natural.
- **UI is DOM for list/grid chrome** (settings pane, action rail, toasts are DOM
  overlays; the canvas is Pixi). The library browser is a mobile-aware DOM panel,
  reserving a viewport inset like the action rail does.

## Risks

- **Durability** — IndexedDB is wiped by "clear site data," so the **full export
  is load-bearing**, not a nice-to-have, until the external backend lands.
- **Quota/scale** — IndexedDB is far roomier than localStorage, but books +
  snapshots still add up; prune snapshots to N and watch quota.
- **Cross-pack open** — opening a leaf saved under a pack the app isn't currently
  on; handled by the pack-switch-on-open above.

## Data model + code map

A single `LibraryState` document, in `packages/website/src/library/`:

- `packs: Record<packId, PackTree>` — top tier, one per modpack.
- `PackTree`: `{ pack, scratchpad: BlueprintEntry, children: LibraryNode[], recents: string[], activeId? }`.
- `LibraryNode = FolderEntry | BlueprintEntry` (folders nest via `children`).
- `BlueprintEntry`: `{ id, kind:'blueprint', name, encoded, createdAt, updatedAt, snapshots: Snapshot[] }`.
- `FolderEntry`: `{ id, kind:'folder', name, children, createdAt, updatedAt, description?, icons?, activeIndex? }`
  — a folder _is_ a Factorio book, so it carries the book's metadata (Phase 5a).
- `Snapshot`: `{ encoded, savedAt }` (newest first, capped at N).

- `model.ts` — pure types + deterministic tree ops (id/now injectable),
  unit-tested. Content ops split the two write paths: `updateEntryContent`
  (autosave, no checkpoint) vs. `checkpointEntry` (explicit Save) /
  `restoreSnapshot` / `deleteSnapshot` / `hasUncheckpointedChanges`; plus
  `ensureFolder` for the "Imported" area.
- `store.ts` — `LibraryStore` interface + `IndexedDBLibraryStore` (real backing) +
  `InMemoryLibraryStore` (tests / SSR fallback) + `createLibraryStore()` picker.
- `interchange.ts` — pure, editor-free native-string export/import (Phase 4). Uses
  the same `0`+base64(deflate(JSON)) codec via pako directly, so folders ↔ nested
  blueprint-books and it's unit-testable. `exportNode`/`exportPack`/`exportLibrary`
  (pack/library books labelled by pack id) and `importString` (decompose a book
  into a folder subtree).
- `controller.ts` — `LibraryController`: owns session state (active pack + active
  leaf), deals only in encoded strings (no editor import → unit-tested). The
  active-pack working-context API (autosave/Save/Save As/open/import/newScratch),
  plus pack-scoped organize ops (createFolder/rename/move/duplicate/remove),
  cross-pack `copyToPack`/`moveToPack` + `setActiveForPack` (the cross-pack-open
  handoff), and version ops (`restore`/`deleteSnapshot`/`getEntry`).
  `cloneNode`/`duplicateNode` in `model.ts` drop version history.
- `libraryPanel.ts` — the DOM browser overlay (no framework, matches the site
  chrome): a pack drop-down (browse any pack), per-row "⋯" menus
  (rename/duplicate/move/copy/delete/versions/export), a destination picker
  spanning packs, an in-panel modal confirm, a version-history viewer (restore /
  delete a saved version), and Import… / Export pack / Export all actions.
  Verified by running the app + `e2e/library.spec.ts`.
- Wiring in `index.ts`: the active leaf replaces the legacy single-slot autosave
  (migrated into the scratchpad once), the active-project indicator, and the
  `#library-button` / `#active-project` chrome.

## Iterative slices (mirror of issue #50)

- [x] **Phase 0 — Store + model.** Rich JSON document; pure model + tree ops +
      tests; `LibraryStore` interface with IndexedDB + in-memory impls.
- [x] **Phase 1 — Scratchpad + open/save (minimal UI).** Per-pack scratchpad as
      the working context; autosave → active leaf; explicit Save (checkpoint) /
      Save As; DOM panel to browse + Open a leaf; active-project indicator;
      `?source=` URL → implied "Imported" leaf + recents; "new project" with the
      unsaved-changes prompt; per-leaf "Copy string"; legacy-autosave migration.
- [x] **Phase 2 — Organization + multi-pack.** Folders (create / rename / delete /
      duplicate); move/reparent within a pack; a pack drop-down to browse any
      pack's tree (Open from a non-active pack switches via `setDataPack`);
      cross-pack copy/move (optimistic, version history dropped). "⋯" row menus +
      destination picker.
- [x] **Phase 3 — Versioning UI.** A per-leaf version-history viewer (⋯ →
      "Versions…"): lists saved versions newest-first with relative timestamps,
      Restore (overwrites live content; reloads the canvas + confirms when it's
      the active leaf with unsaved edits) and Delete-a-version. Model already
      prunes to N.
- [x] **Phase 4 — Export / import hierarchy.** Export any node → native string
      (leaf → its bp string; folder → nested book; pack/library → book labelled by
      pack id — the modpack-label convention). Import a pasted string, decomposing
      a book into a folder subtree. ⋯ "Export as book" + Import… / Export pack /
      Export all. (Import is paste-only and grafts into the browsed pack; URL
      import + pack-routing-by-label are deferred.)
- [ ] **Phase 5 — Folders are books.** A folder carries the book's metadata, so a
      folder _is_ a Factorio book (no separate "book node" kind).
    - [x] **5a — book metadata.** `FolderEntry` carries `description` / `icons` /
          `activeIndex`; `interchange` preserves them on export **and** decompose
          (fixes the export-as-book fidelity gap); clone/duplicate copy them; folder
          ⋯ "Edit description…"; the description shows on hover (a ⓘ hint).
    - [ ] **5b — open a folder as a book** on the canvas (view/navigate via the
          editor's flattened index slider). Data stays in the leaves; no
          canvas-book → tree write-back (edit by opening a leaf).
    - [ ] **5c — render icons** in the panel (atlas/sprite extraction). Storing /
          round-tripping icons is free (5a); drawing them is the separate hard bit.
- [ ] **Phase 6 — External backend.** OAuth-locked remote store (e.g. Firebase)
      behind the `LibraryStore` interface; sync/merge story.

## Deferred

- **Cross-pack compatibility check** — copy/move are **optimistic**: no upfront
  validation. Prototypes the target pack lacks are stripped when the entry is
  opened there (the existing `stripUnknownEntities` path). A validated mode
  (fetch the target's prototype names, warn before dropping anything) is a future
  enhancement.
- **Live unsaved-dot** — the indicator's "modified" dot refreshes on autosave
  (tab hide), not on every edit; live tracking needs an editor change event.
- **Richer dialogs** — confirms (delete / discard / pack-switch) use an in-panel
  modal (so they're never hidden behind the open panel like a toast would be);
  Save As / Rename / New folder / Import all use `window.prompt` (a text-input /
  textarea modal can replace those later — pasting a long string into a prompt is
  workable but clunky).
- **Import routing** — the panel's Import… is paste-only (`0`-strings, no URL
  fetch) and grafts into the _browsed_ pack at root; routing by the top-level
  book label to a matching pack (the `packHint`) is wired in the model but not yet
  used by the UI. The boot-time `?source=` book is still stored as a single
  "Imported" leaf (not decomposed) — only the panel's Import… decomposes.
- **Folder UX polish** — folders are always expanded (no collapse) and move uses
  a destination picker rather than drag-and-drop.

## Not this (for now)

- Multi-device sync (until the external backend lands).
- A built-in blueprint _gallery_ / sharing.
