"""One-time external recovery for pristine 2.4.6, not a silent feed update.

Runs outside the installed package. The released 2.4.13 transaction worker
preserves the previous tree and unrelated profile metadata. No browser storage,
library, credentials or parser state is inspected or cleared.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import runpy
import subprocess
import sys

PACKAGE = '@local/dsh-knowledge-base'
OLD_VERSION, OLD_BUILD = '2.4.6', '5c9679e46cbc1498'
NEW_VERSION, NEW_BUILD = '2.4.13', '280919e50a3d55eb'
NEW_ARCHIVE_SHA = 'a7966d297df119573d85a4cbca532359beab1018fd469f387a0a496cc8984b49'
WORKER_SHA = '5f29dae4e41953f8e5db63456a98524ad7e35fb90ba0ec71c19074673b65cede'
NATIVE_SHA = '7ae3f873036da13e0a67d3f4f5b2f2c67ef0a3bc513eaf4299099d9c57633351'
OLD_MANIFEST_SHA = '31d37632e4b9f548b4095ab8e883e1ef16d855209a318cba7a2ab6f0b32ba224'
NEW_MANIFEST_SHA = '180d6273e03dea99e32589a30c22307c439cfc6855c4863ff1de665af53201e8'
HERE = Path(__file__).resolve().parent


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def no_links(path):
    for entry in (path, *path.parents):
        if entry.is_symlink() or entry.is_junction():
            raise RuntimeError('Linked paths require a Host-managed migration')


def select_profile(root, explicit=None):
    if explicit is not None:
        profile = Path(explicit).absolute()
        no_links(profile)
        if not (profile / 'package.json').is_file():
            raise RuntimeError('Profile package.json not found')
        return profile
    profiles = []
    if root.is_dir():
        for profile in sorted(root.iterdir()):
            if not profile.is_dir() or profile.is_symlink() or profile.is_junction():
                continue
            file = profile / 'package.json'
            if file.is_file() and PACKAGE in json.loads(file.read_text(encoding='utf-8')).get('dependencies', {}):
                profiles.append(profile)
    if len(profiles) != 1:
        names = ', '.join(p.name for p in profiles) or '(none)'
        raise RuntimeError('Select one profile with --profile; matching profiles: ' + names)
    no_links(profiles[0])
    return profiles[0]


def running_clients():
    if os.name != 'nt':
        raise RuntimeError('This recovery entry supports Windows only')
    # Filter inside PowerShell; never return command lines or credentials.
    script = r"""$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$found=@(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('DeepSeek Harness.exe','Knowledge Workbench.exe','knowledge-workbench.exe','知识工作台.exe') -or
  $_.ExecutablePath -match '[\\/]node_modules[\\/]@local[\\/]dsh-knowledge-base[\\/]' -or
  $_.CommandLine -match '[\\/]kb-service[\\/]main\.js(?:"|\s)' -or
  $_.CommandLine -match '[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js(?:"|\s)'
} | Select-Object ProcessId,Name)
ConvertTo-Json -InputObject $found -Compress
"""
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                            capture_output=True, encoding='utf-8', check=True, timeout=30)
    return json.loads(result.stdout or '[]')


def bundle(folder):
    for name, expected in [('manifest.json', NEW_MANIFEST_SHA), ('legacy-2.4.6.json', OLD_MANIFEST_SHA)]:
        if digest(folder / name) != expected:
            raise RuntimeError('Recovery inventory digest mismatch: ' + name)
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    if (manifest.get('version'), manifest.get('buildId'), manifest.get('sha256')) != (NEW_VERSION, NEW_BUILD, NEW_ARCHIVE_SHA):
        raise RuntimeError('Unexpected recovery target')
    archive = folder / ('local-dsh-knowledge-base-' + NEW_VERSION + '.tgz')
    if digest(archive) != NEW_ARCHIVE_SHA or archive.stat().st_size != manifest['bytes']:
        raise RuntimeError('Target archive digest mismatch')
    for name, expected in [('kb-transactional-update.py', WORKER_SHA), ('native.py', NATIVE_SHA)]:
        if digest(folder / name) != expected:
            raise RuntimeError('Recovery helper digest mismatch: ' + name)
    return archive, manifest


def verify_installed(plugin, manifest):
    no_links(plugin)
    for row in manifest['files']:
        relative = Path(row['path'])
        if relative.is_absolute() or '..' in relative.parts or ':' in row['path'] or '\\' in row['path']:
            raise RuntimeError('Unsafe inventory path')
        file = plugin / relative
        no_links(file)
        if not file.is_file() or digest(file) != row['sha256']:
            raise RuntimeError('Installed package differs from the published inventory: ' + row['path'])


def upgrade(profile, folder=HERE, *, check_only=False, recover_only=False, blockers=running_clients, fault=None):
    profile = Path(profile).absolute()
    no_links(profile)
    archive, manifest = bundle(folder)
    plugin = profile / 'node_modules/@local/dsh-knowledge-base'
    no_links(plugin)
    config = json.loads((profile / 'package.json').read_text(encoding='utf-8'))
    if PACKAGE not in config.get('dependencies', {}):
        raise RuntimeError('This profile does not declare the knowledge plugin')
    worker = runpy.run_path(str(folder / 'kb-transactional-update.py'), run_name='bootstrap_worker')
    if not recover_only:
        pkg = json.loads((plugin / 'package.json').read_text(encoding='utf-8'))
        if pkg.get('name') != PACKAGE:
            raise RuntimeError('Installed package identity mismatch')
        if pkg.get('version') == NEW_VERSION:
            verify_installed(plugin, manifest)
            return {'ok': True, 'phase': 'already-installed', 'version': NEW_VERSION, 'buildId': NEW_BUILD}
        legacy = json.loads((folder / 'legacy-2.4.6.json').read_text(encoding='utf-8'))
        if pkg.get('version') != OLD_VERSION or (legacy.get('version'), legacy.get('buildId')) != (OLD_VERSION, OLD_BUILD):
            raise RuntimeError('Only the published 2.4.6 package is supported by this entry')
        verify_installed(plugin, legacy)
    if check_only:
        return {'ok': True, 'phase': 'checked', 'version': OLD_VERSION, 'target': NEW_VERSION}
    live = blockers()
    if live:
        raise RuntimeError('Save work and exit DSH, its tray process and connected clients; wait for the knowledge service to exit. No package was changed. Active processes: ' + json.dumps(live, ensure_ascii=False))
    # The same SID protection used by the shipped installer; this directory
    # contains package/lock backups, never copied personal library documents.
    security = runpy.run_path(str(folder / 'native.py'), run_name='bootstrap_security')
    security['private_dir'](str(profile / '.kb-safe-updates'))
    if recover_only:
        return worker['recover'](profile)
    worker['recover'](profile)
    staged = worker['prepare'](profile, archive, manifest)
    # Recheck before commit: opening a client during preparation must defer.
    if blockers():
        worker['recover'](profile)
        raise RuntimeError('A client or service started during preparation; old installation retained')
    result = worker['commit'](profile, staged['transactionId'], **({'fault': fault} if fault else {}))
    verify_installed(plugin, manifest)
    return {**result, 'buildId': NEW_BUILD, 'transactionId': staged['transactionId']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', type=Path, help='Explicit DSH profile directory')
    parser.add_argument('--profiles-root', type=Path, default=Path.home() / '.dsh/profiles')
    parser.add_argument('--check', action='store_true', help='Verify only; do not change the profile')
    parser.add_argument('--recover', action='store_true', help='Recover an interrupted transaction only')
    args = parser.parse_args()
    if args.check and args.recover:
        parser.error('--check and --recover cannot be combined')
    profile = select_profile(args.profiles_root, args.profile)
    result = upgrade(profile, check_only=args.check, recover_only=args.recover)
    print(json.dumps(result, ensure_ascii=False))
    if result.get('application') == 'restart-required':
        print('SUCCESS: start DSH and confirm 2.4.13 / ' + NEW_BUILD + '. Legacy Host receipts can be reconciled by the new updater. Mismatched safe transactions may need review; browser storage was not cleared.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('RECOVERY NOT COMPLETED: ' + str(error))
        sys.exit(1)
