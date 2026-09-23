# TODO

## Code follow-ups (from pre-commit review)

- [x] Deduplicate the `ANIMATIONS` list — moved to shared `constants.js` imported by both `extension.js` and `prefs.js`
- [x] Replace the magic `-1` position sentinel with a named constant (`POSITION_APPEND`) plus `isAppendPosition()` helper in `constants.js`
- [x] Extract `normalizeAnimation(id)` / `DEFAULT_ANIMATION` in `constants.js`; `enable()` and `_onAnimationChanged()` share it now
- [x] Clarify `_onPositionChanged` re-entrancy — documented the write-back clamp and the `j === i` no-op guard
- [x] Document `_migrateLegacyState` ordering — comment explains the intentional one-shot flag-before-import
- [x] Comment the GNOME 50 menu parenting in `enable()` (`Main.uiGroup.add_child(...)`)
- [x] GNOME 50 prefs import: `ExtensionPreferences` moved to `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`; the old lowercase path has no compat in the out-of-process prefs service (found live — dialog errored on load). In-shell `Extension` keeps the old path.

## Publishing prep (extensions.gnome.org)

- [x] Rename UUID to `guigna@enbonnet.github.com` (done; keep in mind renaming after publishing = new listing)
- [x] Add GPLv2+ `LICENSE` file
- [x] Add a `README.md` with a short description, screenshot, and install instructions
- [x] Verify `metadata.json` — `version` 2, `shell-version` trimmed to `["50"]` (only 50.x verified on this machine), `url` points at the GitHub repo
- [ ] Test on shell 50 after repack (relogin), including prefs dialog and menu on Wayland; X11 spot-check
- [ ] Optionally verify 45–49 in VMs/toolbox before widening `shell-version` again
- [ ] Capture screenshots of the panel indicator, click menu, and prefs dialog (`screenshots/`)
- [x] Review the EGO review guidelines (no minified code, prefs must work, etc.): https://gjs.guide/extensions/review-guidelines/review-guidelines.html

## Pack and upload

- [x] Pack with `gnome-extensions pack --force --out-dir=pack` — **on this GNOME (50.5) the packer omits `schemas/gschemas.compiled` and only packs metadata/extension.js/prefs.js/schemas**, so pack with `--extra-source=constants.js --extra-source=LICENSE --extra-source=README.md`, then `zip <zip> schemas/gschemas.compiled` (after `glib-compile-schemas schemas/`). Always verify with `unzip -l`; the 2026-08-28 v2 zip shipped without the compiled schema and would fail at `getSettings()`
- [ ] Sanity-check the zip: unzip -l, then install it clean (`gnome-extensions install --force`) and enable
- [x] GitHub repo `enBonnet/guigna` created and pushed (EGO `url` points here)
- [ ] Create/confirm an account at https://extensions.gnome.org (signs in via GNOME GitLab)
- [ ] Upload the zip, add description/screenshots, and submit for review
- [ ] Wait for review; respond to reviewer feedback and re-upload if requested

## Post-publish

- [ ] Tag a git release matching the metadata.json `version`
- [ ] Replace the placeholder in README with the live EGO install link
- [ ] Announce / share the EGO link
- [ ] Track GNOME Shell betas (e.g. 51.alpha) and test ahead of each release
- [ ] Consider gettext translations if the extension gains users

## Ops note

- The extensions dir entry must stay a real directory (not a symlink to this repo) — `gnome-extensions install --force` deletes the destination contents and follows symlinks, which wiped this repo once (2026-08-20). Deploy by copying files or repacking the zip.
