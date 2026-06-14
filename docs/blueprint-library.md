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
- **Per-modpack scratchpad.** Each pack subtree always has a Scratchpad — the
  default landing place for transient work, replacing today's single
  `fbe:blueprint` autosave (which is global and silently overwritten). Saving a
  named entry is always deliberate.
- **The active leaf _is_ the working context.** Opening an entry makes it the
  active leaf; the canvas edits it directly, and the active project's name is
  shown in a top-centre indicator. Each pack remembers its own active leaf
  (persisted), so a reload reopens what you were working on.
- **Autosave (live) vs. Save (checkpoint).** The active leaf's content is
  continuously **autosaved** (on `visibilitychange`) so a reload never loses
  work — this updates live content only and never churns history. An explicit
  **Save** creates a **version checkpoint** (the last N are kept, pruned, with
  identical/empty saves skipped). "Modified" = the canvas differs from the active
  leaf's newest checkpoint; that's what the new-project prompt and the indicator's
  unsaved dot key off. **Save As** makes a new named leaf and switches to it.
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
- **Import:** infer the pack from the top-level book label; if an imported book
  has no recognizable pack label, **ask the user which pack it targets** and
  graft the subtree under that pack node.

> Open question (settle at the export/import slice): exact pack-label mechanism —
> top-level `label` == pack id (recommended, fully native) vs a reserved marker
> in `description` vs accepting that arbitrary imports always prompt. Lean:
> label convention, fall back to asking on import.

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
- `Snapshot`: `{ encoded, savedAt }` (newest first, capped at N).

- `model.ts` — pure types + deterministic tree ops (id/now injectable),
  unit-tested. Content ops split the two write paths: `updateEntryContent`
  (autosave, no checkpoint) vs. `checkpointEntry` (explicit Save) /
  `restoreSnapshot` / `hasUncheckpointedChanges`; plus `ensureFolder` for the
  "Imported" area.
- `store.ts` — `LibraryStore` interface + `IndexedDBLibraryStore` (real backing) +
  `InMemoryLibraryStore` (tests / SSR fallback) + `createLibraryStore()` picker.
- `controller.ts` — `LibraryController`: owns session state (active pack + active
  leaf), deals only in encoded strings (no editor import → unit-tested). The
  autosave/Save/Save As/open/import/newScratch/seedScratchpad API `index.ts` calls.
- `libraryPanel.ts` — the DOM browser overlay (no framework, matches the site
  chrome). Verified by running the app, not unit-tested.
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
- [ ] **Phase 2 — Organization.** Create / rename / delete / duplicate folders;
      move a blueprint or folder under another (the "push down" reorg).
- [ ] **Phase 3 — Versioning UI.** View / restore / prune the last N snapshots
      per leaf (the model already keeps them; `restoreSnapshot` exists).
- [ ] **Phase 4 — Export / import hierarchy.** Export any node → native string
      (subtree extraction; leaf → bare bp string); modpack-label convention;
      hierarchical import (decompose imported books); whole-library export.
- [ ] **Phase 5 — External backend.** OAuth-locked remote store (e.g. Firebase)
      behind the `LibraryStore` interface; sync/merge story.

## Deferred (carried over from Phase 1)

- **Multi-pack browsing** — the panel shows only the active pack's subtree, so
  the **pack-switch-on-open** isn't needed yet; it lands when you can browse
  another pack's tree (Phase 2/4).
- **Live unsaved-dot** — the indicator's "modified" dot refreshes on autosave
  (tab hide), not on every edit; live tracking needs an editor change event.
- **Richer dialogs** — Save As uses `window.prompt`; confirms use a sticky toast
  (dismiss = cancel). A proper DOM modal can replace these.
- **Imported books** — a `?source=` book is stored as a single leaf for now, not
  decomposed into a folder (that's the Phase 4 hierarchical import).

## Not this (for now)

- Multi-device sync (until the external backend lands).
- A built-in blueprint _gallery_ / sharing.
