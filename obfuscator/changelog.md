# Alvin's Obfuscator changelog

Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus

Versioning starts at v1.5.7. Very major changes bump major, normal changes bump
minor, and small changes bump patch; lower numbers reset after major/minor bumps.

## [1.7.0] — 2026-10-10

### Changed

- Strengthen automatic obfuscation so injected guards resist common static
  deobfuscators. Generated output stays functionally identical for your scripts.
- **Confidential** — withheld to avoid aiding deobfuscation.
- Present the changelog as a styled in-app tab alongside Obfuscator and Access.
  The owner sees full release notes; others see a redacted copy from the Worker.

### Security findings
- **Confidential** — withheld to avoid aiding deobfuscation.

## [1.6.0] — 2026-10-10

### Changed

- Integrate the payload vault into the final VM and refresh string protection
  across the Studio presets and Super.
- **Confidential** — withheld to avoid aiding deobfuscation.
- Correct preset stage counts and publish a changelog with a footer link.
- Synchronize release versions across the engine, generated output, website and
  package metadata, with a build check to catch mismatches.

### Fixed

- Repair the published text catalog's missing quote while preserving customized
  copy and the required Prometheus attribution.
- **Confidential** — withheld to avoid aiding deobfuscation.

### Security findings
- **Confidential** — withheld to avoid aiding deobfuscation.
- The engine changes were originally validated under the v1.5.7 label, then issued
  as v1.6.0 under the new policy. Earlier raw results keep their original version
  identifiers. This is a minor release, rather than a full architecture replacement.

## [1.5.7] — 2026-10-10

Initial recorded baseline, before the VM-integrated vault changes above:

- Modern browser interface, larger SF Pro Display headings, SF Pro Text controls,
  SVG icons, editable filenames and an editable strings.json catalog.
- Typed Luau parsing, variable naming modes, Unicode transport and Super.
- UTF-8 output-size ceilings with bounded rebuilds.
- Generated scripts include the release version header.
- Discord login and owner-managed access, authenticated engine delivery and local
  browser processing through WASM. Prometheus attribution retained on the platform.
- **Confidential** — withheld to avoid aiding deobfuscation.
