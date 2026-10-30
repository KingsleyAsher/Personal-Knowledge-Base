# Versioning and Update Rules

[English](VERSIONING.en.md) · [简体中文](VERSIONING.md)

Starting with `2.0-beta9`, new releases use only these formats:

| Channel | Format | Examples | Meaning |
|---|---|---|---|
| Stable | `x.x.x` | `2.0.0`, `2.0.1`, `2.1.0` | The first number is the major version, the second is the minor release, and the third is a bug-fix patch. |
| Preview | `x.x-betaN` | `2.0-beta1`, `2.0-beta10` | The first two numbers identify the target major/minor line; `N` is the preview number in that line, starting at 1. |

Each numeric component is a non-negative decimal integer without leading zeroes. `betaN` must use an integer greater than zero. New packages, tags, and preview manifests must follow these formats. `2.0.2-beta9`, `2.0.0-beta1`, and `2.0-beta01` are not valid **new** release versions.

## Comparing versions and showing updates

Compare major versions first, then minor versions. Within an `x.x` line, any preview is lower than every stable release in that line. Previews are ordered by `N`; stable releases are ordered by patch number. For example, `2.0-beta10 < 2.0.0 < 2.0.1 < 2.1-beta1`. After `2.0.0` is released, users on `2.0-betaN` can receive the stable update.

Previously installed preview versions such as `2.0.2-beta6` through `2.0.2-beta9` are accepted as migration inputs. For comparison, the historical third component is ignored and the version is treated as the corresponding `2.0-betaN`. If the preview number is the same, the canonical format ranks higher, so a user on `2.0.2-beta9` can receive the renamed `2.0-beta9` package. Old preview manifests may still be read during the transition, but release tools reject the old format for new packages. Migration compatibility does not change the meaning of stable patch numbers.

Automatically installable stable updates within the same major version download, verify, and install in the background without an **Update available** choice dialog. Major-version changes, preview updates, and channel switches still require a manual choice. Stable users do not receive an optional-preview dialog; the update entry shows a dot instead. Closing a manual update dialog records that choice for the specific channel and version. If the host lacks a client-side installation interface, update through the host plugin manager. Version status, failure reasons, and any required refresh or restart remain available in the version entry; a host-requested restart is still shown to the user.

An update is complete only after both the host build and client version are confirmed. The client then refreshes version status, removes the available-update notice for the installed version, and checks again. A check started before installation must not overwrite the completed state.

## Post-install update notes

An **Update available** notice and post-install release notes are separate flows. Release notes appear only after the plugin has loaded the new version, based on the previously recorded installed version:

| Previous install → current install | Release-notes dialog |
|---|---|
| Stable patch only (for example, `2.0.0 → 2.0.1`) | No |
| Stable major or minor change (for example, `2.0.1 → 2.1.0`) | Yes |
| Preview updated to a higher preview number | Every time |
| Preview updated to stable | Yes, describing the stable change |

When several versions have been skipped, show one dialog summarizing changes since the last version confirmed as read. Combine and deduplicate the notes; do not show historical release groups, one heading per version, or a version count. Notes that remain open are shown again on the next load. If another upgrade occurs before they are dismissed, extend the summary through the new version. Patch-only upgrades do not interrupt the user, but their notes remain available for the next major or minor upgrade. Stable upgrades summarize stable-release entries only; upgrades from a preview include the intervening preview and stable entries.

Each release must record its actual changes in the client-side update-notes catalog. Stable patch notes must also be recorded so a later summary does not omit them. A fresh install with no previous installation record does not show upgrade notes. Legacy installation or read-state records can support migration, but missing history cannot be used to infer which releases a user skipped.

## Release checklist

`package.json`, the host `VERSION`, client `RELEASE_VERSION`, package filename, stable manifest, and `v<version>` tag must agree. Before release, verify the build ID, byte size, and SHA-256. The stable manifest must point to the stable package and the preview manifest to the preview package. Do not use ordinary string comparison or legacy three-component preview SemVer to order releases. The next preview after a stable release should belong to a new minor line, for example `2.1-beta1`.

Every release also updates the [project design and development record](PROJECT-RECORD.en.md): version, date, actual capabilities and limitations, and development history. Release validation checks that the documentation version matches the package and that the package includes a documentation snapshot.
