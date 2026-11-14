> Release / 当前发布：plugin **3.0.1**, client **2.0.1**. [Release notes](../releases/plugin-3.0.1.en.md).

> Unified project: [main README](../../README.md) · [shared architecture](../../ARCHITECTURE.en.md).

# Development and packaging

[中文](DEVELOPMENT.md) · English

Use Windows x64, Node.js 24, npm, Python 3.11+ and the Windows .NET Framework C# compiler. Pillow generates installer icons. Install application dependencies from the lockfile. Electron 45.2.1 and embedded Python 3.14.10 are pinned and checksum-verified.

```powershell
cd apps/desktop
npm.cmd ci
npm.cmd ci --prefix vendor/chat
node --test tests/storage-path.test.mjs tests/library-scope.test.mjs
cd ../..
python -m pip install Pillow
python -X utf8 tools/prepare-desktop-release.py
npm.cmd run build --prefix apps/desktop
cd apps/desktop
npm.cmd run package
cd ../..
$env:KB_SIGN_CERT_SHA1 = '<trusted code-signing certificate thumbprint>'
python -X utf8 installer-design-b/installer/build.py
```

For development, run `npm.cmd run desktop` in `apps/desktop`. Use isolated data/service/link directories for tests (`KB_DESKTOP_DATA`, `KB_SHARED_HOME`, `KB_DESKTOP_LINK_HOME`). Never point tests at personal libraries.

Preparation downloads public runtimes and builds the paired plugin without inspecting installed profiles. App output is under `apps/desktop/out`; installer output is under `installer-design-b/release`. The first installer build regenerates UI from the preserved design source. Client and plugin versions are independent.

Build timestamps/tool versions may prevent byte-identical reproduction. A local build check does not prove download availability in every region. Do not bypass checksum verification to work around network failures.

Current source: plugin 3.0.2 / client 2.0.2; not publicly released. For local unsigned development only, replace the signing step with `python -X utf8 installer-design-b/installer/build.py --allow-unsigned`. This does not resolve Smart App Control. See [Windows signing](../WINDOWS-SIGNING.md) for prerequisites and validation limits.
