# memory-evolve Dynamic-State Isolation Patch

[English](README.en.md) · [简体中文](README.md)

This is a standalone companion patch for Personal Knowledge Base 2.1.0. It targets a specific code baseline of `dsh-memory-evolve` 0.1.0. The script checks the SHA-256 strictly. If it does not match, preserve the current installation and adapt the patch to the installed version; do not force-apply it.

## What changes

Session titles, aliases, identity, and review/write reminders are separated from the stable memory snapshot and sent as small messages when they change. Memory, the user profile, project KEY bodies, and rules continue to load in full under their existing settings. Real memory updates can still trigger a complete snapshot, and changes from other plugins can cause the host to merge and inject context again. Initial load size and older session history are not reduced by this patch.

## Apply

1. Download the Release attachment `memory-evolve-context-fix.zip` and extract it.
2. Fully exit the host. Confirm that the plugin directory is the actual source directory for the installed `dsh-memory-evolve`. If multiple profiles share this directory, the patch affects all of them.
3. Preview first: `python apply.py --plugin-dir "<actual plugin directory>"`.
4. Apply: `python apply.py --plugin-dir "<actual plugin directory>" --apply`. The script makes a backup, modifies only `lib/index.js`, and adds `lib/snapshot-state.js`.
5. Fully restart the host. A new session is recommended for observation. The knowledge-base package does not apply this patch automatically.

Rollback: `python apply.py --plugin-dir "<actual plugin directory>" --rollback "<backup directory printed by the script>"`. If the patched file has been edited again, the script refuses to overwrite it; merge the changes manually. An upstream plugin update may replace the patch, in which case it must be adapted again. Do not force-apply it to a different baseline.

The attachment contains only the minimal code change, a generic state module, and the installation script. It does not include the full third-party plugin, personal memory, or maintainer device paths.
