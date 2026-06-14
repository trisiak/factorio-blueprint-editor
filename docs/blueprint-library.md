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
- **Save model: explicit save + version snapshots.** Named entries are written
  only on an explicit Save; overwriting prompts for confirmation; Save As makes a
  new entry; each leaf keeps the last N snapshots so an iteration can be rolled
  back. The scratchpad may keep snapshots too (its autosave history).
- **"Open a new project" + recents.** Loading the site with a `?source=` URL
  creates an _implied separate entry_ rather than clobbering the scratchpad.
  There's an explicit "open a new project" action that, when the current work is
  _modified_, prompts for what to do with it (save / discard / keep as
  scratchpad). A **recents** list keeps the last N entries opened. (Exactly what
  becomes a recent vs. what merely modifies the scratchpad is a deliberately
  deferred UX call — the data model carries both so we can decide later.)

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

## Data model (Phase 0)

A single `LibraryState` document:

- `packs: Record<packId, PackTree>` — top tier, one per modpack.
- `PackTree`: `{ pack, scratchpad: BlueprintEntry, children: LibraryNode[], recents: string[] }`.
- `LibraryNode = FolderEntry | BlueprintEntry` (folders nest via `children`).
- `BlueprintEntry`: `{ id, kind:'blueprint', name, encoded, createdAt, updatedAt, snapshots: Snapshot[] }`.
- `Snapshot`: `{ encoded, savedAt }` (newest first, capped at N).

Lives in `packages/website/src/library/`:

- `model.ts` — pure types + deterministic tree ops (id/now injectable), unit-tested.
- `store.ts` — `LibraryStore` interface + `IndexedDBLibraryStore` (real backing) +
  `InMemoryLibraryStore` (tests / SSR fallback).

## Iterative slices (mirror of issue #50)

- [ ] **Phase 0 — Store + model.** Rich JSON document; pure model + tree ops +
      tests; `LibraryStore` interface with IndexedDB + in-memory impls.
- [ ] **Phase 1 — Scratchpad + open/save (minimal UI).** Per-pack scratchpad
      wired as the working context; explicit Save / Save As; DOM panel to browse +
      Open a leaf (→ `loadBp`, with pack-switch prompt); "open a new project" with
      the modified-work dialog; recents; per-leaf "Copy string".
- [ ] **Phase 2 — Organization.** Create / rename / delete / duplicate folders;
      move a blueprint or folder under another (the "push down" reorg).
- [ ] **Phase 3 — Versioning UI.** View / restore / prune the last N snapshots
      per leaf.
- [ ] **Phase 4 — Export / import hierarchy.** Export any node → native string
      (subtree extraction; leaf → bare bp string); modpack-label convention;
      hierarchical import; whole-library export.
- [ ] **Phase 5 — External backend.** OAuth-locked remote store (e.g. Firebase)
      behind the `LibraryStore` interface; sync/merge story.

## Not this (for now)

- Multi-device sync (until the external backend lands).
- A built-in blueprint _gallery_ / sharing.
