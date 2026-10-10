# Alvin's Obfuscator changelog

Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus

Versioning starts at v1.5.7. Very major changes bump major, normal changes bump
minor, and small changes bump patch; lower numbers reset after major/minor bumps.

## [1.6.0] — 2026-10-10

### Changed

- Compile PayloadVault's records, decoder and calls inside the final VM in
  StudioStrong, StudioMax, Super and StudioLegacyTamper, removing the previous
  standalone outer-vault placement. Unicode reuses that vault.
- Replace the vault's affine byte formula with a per-build permutation and two
  feedback states. This remains reversible obfuscation, not confidential encryption.
- Replace generated validator messages and their weak decoder with opaque
  build-local error codes. Preserve product-owned errors and error levels.
- Correct preset stage counts and publish a changelog with a footer link.
- Synchronize release versions across the engine, generated output, website and
  package metadata, with a build check to catch mismatches.

### Fixed

- Initialize permutation tables in bounded loops to avoid Luau's register limit.
- Preserve selected Unicode transport through VM compilation and later string passes.
- Repair the published text catalog's missing quote while preserving customized
  copy and the required Prometheus attribution.

### Security findings

- The audit lifted 378 intermediate constants from the previous standalone vault.
  That particular extractor no longer recognizes the updated Super vault.
- Runtime interception still recovered all three synthetic product/license strings
  from both versions. Distributed keys and decoding logic do not provide secrecy;
  authoritative licensing must remain server-side. See SECURITY-AUDIT.md.
- The engine changes were originally validated under the v1.5.7 label, then issued
  as v1.6.0 under the new policy. Earlier raw results keep their original version
  identifiers. This is a minor release, rather than a full architecture replacement.

## [1.5.7] — 2026-10-10

Initial recorded baseline, before the VM-integrated vault changes above:

- Modern browser interface, larger SF Pro Display headings, SF Pro Text controls,
  SVG icons, editable filenames and an editable strings.json catalog.
- Typed Luau parsing, variable naming modes, Unicode transport, Super, enhanced VM
  structure and an optional uncalled LOLvm decoy.
- UTF-8 output-size ceilings with bounded rebuilds; LOLvm disabled below 1 MiB.
- Generated scripts include the release version header and mixed hexadecimal /
  binary integer literals, preserving exact values where supported.
- Discord login and owner-managed access, authenticated engine delivery and local
  browser processing through WASM. Prometheus attribution retained on the platform.
- The final string vault and diagnostic decoder remained reversible, motivating
  the subsequent audit and v1.6.0 changes.
