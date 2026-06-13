<!--
Keep this short. The point is to close the loop between the code, the issues,
and the docs/ tracking files in the SAME PR — see CLAUDE.md "Keep issues in
sync with the work". Delete any line that doesn't apply.
-->

## What & why

<!-- One or two sentences. What does this change do, and why? -->

## Linked issues

<!-- "Closes #NN" for an issue this fully resolves; "Part of #NN" / "Advances
     #NN" for a slice of a tracking issue. If the filing ticket differs from the
     tracking issue (work often lands under a different number), link both. -->

- Closes / Part of #

## Sync checklist

- [ ] Issue referenced in the commit subject(s) (`#NN`, matching the `(#30)` / `(issue #28)` convention)
- [ ] Tracking-issue checkboxes ticked / ratchet numbers advanced (e.g. the `spriteCensus` `partial`/`failed` counts), using the `~~old~~ **new**` strike style — in this PR, not "later"
- [ ] Companion `docs/` file updated and not contradicting the issue (`mobile-controls.md` ↔ mobile issues; `space-exploration-modlist.md` ↔ #28); `test.fixme` converted/removed if the slice landed
- [ ] If this closes the work, the issue is closed (or a one-liner says why it stays open)

## Verification

<!-- Which of these ran green, and anything verified by hand in-app
     (the Pixi rendering layer isn't unit-tested):
     type-check / unit (vitest) / e2e (Playwright) / lint / format -->
