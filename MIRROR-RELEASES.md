# Gitee and GitCode mirrors

GitHub is the source of truth for stable code and tags. A successful stable tag workflow starts the mirror workflow after release validation; manually publishing a stable GitHub Release also starts it.

## Code synchronization

- Gitee accepts the workflow's authenticated fast-forward push. The workflow never force-pushes and reports divergent history instead of overwriting it.
- GitCode is configured as a Pull mirror of `https://github.com/KingsleyAsher/Personal-Knowledge-Base`. The workflow does not push directly into this image repository. GitCode's Pull mirror updates its branches and tags; the workflow waits up to 35 minutes and checks that `main` and the stable tag match GitHub.
- GitCode documents Pull mirrors as synchronizing branches, tags, and commits. Its manual sync endpoint is not part of the documented public API, so automation does not depend on it.
- The read-only `diagnose-mirror.py` check reports whether the Pull source matches GitHub, the platform's latest mirror status, and whether both refs match. It does not expose the configured source URL or change refs/settings.

## Stable Releases

The mirror workflow runs for each newly published non-prerelease GitHub Release. It reads files from the exact published tag, validates the archive against `release-manifest.json` and `SHA256SUMS`, then creates or updates the matching Release on Gitee and GitCode.

It uploads the six stable distribution files as native Release attachments and verifies their SHA-256 values. Re-running is safe: existing attachments with matching bytes are kept, unrelated release notes remain, and the managed notes section is replaced in place. A same-name attachment with different bytes causes a clear failure; automation does not delete or overwrite it.

GitHub Actions needs repository secrets named `GITEE_TOKEN` and `GITCODE_TOKEN`. The manual workflow options support read-only diagnosis and release-only reconciliation of a specified stable tag.

GitCode mirror documentation: <https://docs.gitcode.com/docs/help/home/org_project/project_manage/project_settings/repository_mirroring/>.
