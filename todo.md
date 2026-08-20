# TODO

## Code follow-ups (from pre-commit review)

- [ ] Deduplicate the `ANIMATIONS` list — `extension.js` and `prefs.js` keep verbatim copies that can desync; move to a shared `constants.js` imported by both
- [ ] Replace the magic `-1` position sentinel with a named constant (`POSITION_APPEND`); the "< 0 means append" rule is re-encoded in 5 places across extension.js, prefs.js, and the schema
- [ ] Extract `_normalizeAnimation(id)` / `DEFAULT_ANIMATION` — the `ANIMATIONS.some(...) ? id : 'fade'` fallback is duplicated in `enable()` and `_onAnimationChanged()`
- [ ] Clarify `_onPositionChanged` re-entrancy — the handler writes back the key it observes to clamp out-of-range values; guard logic is implicit
- [ ] Document `_migrateLegacyState` ordering — `state-migrated` is set before the import attempt, so a corrupt legacy JSON is skipped forever (intentional, but non-obvious)
- [ ] Comment the GNOME 50 menu parenting in `enable()` (`Main.uiGroup.add_child(...)`) — required because Shell 50 `PopupMenuManager` no longer parents menu actors

## Publishing prep (extensions.gnome.org)

- [x] Rename UUID to `guigna@enbonnet.github.com` (done; keep in mind renaming after publishing = new listing)
- [ ] Pick a license and add a `LICENSE` file (EGO requires an approved open-source license; GPLv2+ or MIT are common for extensions)
- [ ] Add a `README.md` with a short description, screenshot, and install instructions
- [ ] Verify `metadata.json` — bump `version`, keep `shell-version` list to versions actually tested (currently 45–50; only 50.x verified on this machine)
- [ ] Test on each listed shell version (live USB or VMs for 45–49), including prefs dialog and menu on Wayland and X11
- [ ] Capture screenshots of the panel indicator, click menu, and prefs dialog (EGO shows one screenshot per shell version)
- [ ] Review the EGO review guidelines (no minified code, prefs must work, etc.): https://gjs.guide extensions/development/creating.html and review docs

## Pack and upload

- [ ] Pack with `gnome-extensions pack --force --out-dir=pack` (produces the zip with extension.js, prefs.js, metadata.json, schemas/*.gschema.xml — never include `gschemas.compiled`)
- [ ] Sanity-check the zip: unzip -l, then install it clean in a VM (`gnome-extensions install --force`) and enable
- [ ] Create/confirm an account at https://extensions.gnome.org (signs in via GNOME GitLab)
- [ ] Upload the zip, add description/screenshots, and submit for review
- [ ] Wait for review; respond to reviewer feedback and re-upload if requested

## Post-publish

- [ ] Tag a git release matching the metadata.json `version`
- [ ] Announce / share the EGO link
- [ ] Track GNOME Shell betas (e.g. 51.alpha) and test ahead of each release
- [ ] Consider gettext translations if the extension gains users

## Ops note

- The extensions dir entry must stay a real directory (not a symlink to this repo) — `gnome-extensions install --force` deletes the destination contents and follows symlinks, which wiped this repo once (2026-08-20). Deploy by copying files or repacking the zip.
