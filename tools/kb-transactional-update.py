"""Stage a dependency-free knowledge plugin, then publish with a recovery journal.

pnpm runs only against an isolated metadata copy. Live package files are never
passed to pnpm. Existing libraries, credentials and parsing state are untouched.
"""
from pathlib import Path
from contextlib import contextmanager
import argparse, base64, hashlib, json, os, re, shutil, subprocess, sys, tarfile, uuid

PACKAGE = '@local/dsh-knowledge-base'
METADATA = ('package.json', 'pnpm-lock.yaml')

def sha(data): return hashlib.sha256(data).hexdigest()
def read(path): return path.read_bytes() if path.exists() else None
def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists(): temp.unlink()
def save(path, value): atomic(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())
def tree(root):
    result = {}
    for p in sorted(root.rglob('*')):
        if p.is_symlink() or p.is_junction(): raise RuntimeError('Linked package trees are not supported')
        if p.is_file(): result[p.relative_to(root).as_posix()] = sha(p.read_bytes())
    return result

def exited(pid):
    if pid <= 0 or pid == os.getpid(): return False
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]; k.OpenProcess.restype = wintypes.HANDLE
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = k.OpenProcess(0x1000, False, pid)
        if not handle: return ctypes.get_last_error() == 87
        k.CloseHandle(handle); return False
    try: os.kill(pid, 0); return False
    except ProcessLookupError: return True

def acquire(lock):
    try: return lock.open('xb')
    except FileExistsError:
        record = lock.read_bytes()
        if not re.fullmatch(rb'[0-9]+\n', record) or not exited(int(record)): raise RuntimeError('Profile writer is busy; old installation unchanged')
        claim = lock.with_name(lock.name + '.takeover-' + sha(record)[:16])
        try:
            with claim.open('xb'):
                if lock.read_bytes() != record or not exited(int(record)): raise RuntimeError('Profile lock owner changed')
                lock.unlink()
        finally: claim.unlink()
        return lock.open('xb')

@contextmanager
def profile_lock(profile):
    # Same lock name and PID record as the Host's dsh-atomic-write package.
    lock = profile / 'package.json.lock'
    with acquire(lock) as f: f.write((str(os.getpid()) + '\n').encode()); f.flush(); os.fsync(f.fileno())
    try: yield
    finally: lock.unlink()

def locations(profile):
    profile = profile.resolve(strict=True)
    plugin = profile / 'node_modules/@local/dsh-knowledge-base'
    if plugin.is_symlink() or plugin.is_junction(): raise RuntimeError('Linked installations require a Host-managed migration')
    return profile, plugin, profile / '.kb-safe-updates/transaction.json'

def validate_archive(archive, expected, destination):
    raw = archive.read_bytes()
    if len(raw) != expected['bytes'] or sha(raw) != expected['sha256']: raise RuntimeError('Archive digest mismatch')
    seen = set(); total = 0
    with tarfile.open(archive, 'r:gz') as stream:
        for entry in stream:
            name = entry.name; parts = name.split('/')
            if not name.startswith('package/') or any(x in ('..', '.') for x in parts) or any(c in name for c in '\\:<>|?*'):
                raise RuntimeError('Unsafe archive path')
            if any(x != x.rstrip(' .') or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', x) for x in parts if x): raise RuntimeError('Unsafe Windows filename')
            key = name.rstrip('/').lower()
            if key in seen or not (entry.isfile() or entry.isdir()): raise RuntimeError('Duplicate path or linked archive entry')
            seen.add(key); total += entry.size
            if total > 128 * 1024 * 1024: raise RuntimeError('Expanded archive too large')
            target = destination.joinpath(*parts[1:])
            if entry.isdir(): target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as output: shutil.copyfileobj(stream.extractfile(entry), output)
    pkg = json.loads((destination / 'package.json').read_text(encoding='utf-8'))
    version = expected.get('latestVersion', expected.get('version'))
    if pkg.get('name') != PACKAGE or pkg.get('version') != version or not pkg.get('dsh', {}).get('bundle'): raise RuntimeError('Package identity mismatch')
    if pkg.get('dependencies') or pkg.get('optionalDependencies') or pkg.get('peerDependencies'): raise RuntimeError('Transactional installer supports only the dependency-free plugin')
    text = (destination / 'src/host/index.js').read_text(encoding='utf-8')
    inventory = re.search(r'const list = (\[.*?\])', text)
    if not inventory: raise RuntimeError('Build inventory missing')
    files = re.findall(r"'([^']+)'", inventory.group(1)); digest = hashlib.sha256()
    extracted = tree(destination)
    for name in files:
        if name not in extracted: raise RuntimeError('Build inventory path missing')
        digest.update((name + '\0' + sha((destination / name).read_bytes()) + '\n').encode())
    if digest.hexdigest()[:16] != expected['buildId']: raise RuntimeError('Build ID mismatch')
    return pkg

def lock_entries(lines, start, end, indent):
    rows = []
    pattern = re.compile(r"^(?:'((?:[^']|'')*)'|\"((?:[^\"\\]|\\.)*)\"|([^:#]+)):\s*(?:.*)$")
    for at in range(start, end):
        line = lines[at].rstrip('\r\n')
        if not line.strip() or len(line) - len(line.lstrip()) != indent: continue
        match = pattern.fullmatch(line.lstrip())
        if not match: raise RuntimeError('Unsupported lockfile mapping')
        key = match[1].replace("''", "'") if match[1] is not None else json.loads('"' + match[2] + '"') if match[2] is not None else match[3].strip()
        rows.append((key, at))
    return [(key, at, rows[i+1][1] if i+1 < len(rows) else end) for i, (key, at) in enumerate(rows)]

def managed_lock_blocks(text):
    lines = text.splitlines(keepends=True)
    if not re.search(r"^lockfileVersion: ['\"]?9\.0['\"]?\s*$", text, re.M): raise RuntimeError('Unsupported lockfile version')
    def parent(keys):
        start, end, indent = 0, len(lines), 0
        for key in keys:
            choices = [row for row in lock_entries(lines, start, end, indent) if row[0] == key]
            if len(choices) != 1: raise RuntimeError('Lockfile structure is ambiguous')
            _, begin, end = choices[0]; start = begin + 1; indent += 2
        return start, end, indent
    blocks = []
    for keys, prefix in [(('importers', '.', 'dependencies'), False), (('packages',), True), (('snapshots',), True)]:
        start, end, indent = parent(keys)
        found = [row for row in lock_entries(lines, start, end, indent) if row[0].startswith(PACKAGE + '@')] if prefix else [row for row in lock_entries(lines, start, end, indent) if row[0] == PACKAGE]
        if len(found) != 1: raise RuntimeError('Knowledge plugin lock entry is missing or ambiguous')
        blocks.append(found[0][1:])
    return lines, blocks

def merge_plugin_lock(original, resolved):
    old_lines, old_blocks = managed_lock_blocks(original)
    new_lines, new_blocks = managed_lock_blocks(resolved)
    newline = '\r\n' if '\r\n' in original else '\n'
    merged = old_lines[:]
    for (start, end), (a, b) in reversed(list(zip(old_blocks, new_blocks))):
        merged[start:end] = [line.rstrip('\r\n') + newline for line in new_lines[a:b]]
    result = ''.join(merged)
    def unrelated(text):
        lines, blocks = managed_lock_blocks(text)
        for start, end in reversed(blocks): del lines[start:end]
        return ''.join(lines)
    if unrelated(result) != unrelated(original): raise RuntimeError('Unrelated lock records changed')
    if PACKAGE in unrelated(original): raise RuntimeError('Another lock entry depends on the knowledge package')
    return result

def retire_prepared(journal, plan):
    # The caller holds the profile writer lock; prepared has not changed live files.
    if plan.get('phase') != 'prepared' or not re.fullmatch(r'transaction-[a-f0-9]{32}', plan.get('work', '')):
        raise RuntimeError('An unresolved update requires recovery first')
    if (journal.parent / plan['work'] / 'previous').exists():
        raise RuntimeError('An unresolved update requires recovery first')
    atomic(journal.with_name('superseded-' + uuid.uuid4().hex + '.json'), journal.read_bytes())
    plan['phase'] = 'aborted'
    plan['reason'] = 'superseded-before-publication'
    save(journal, plan)


def prepare(profile, archive, expected, pnpm=None):
    profile, plugin, journal = locations(profile)
    with profile_lock(profile):
        if journal.exists():
            previous = json.loads(journal.read_text(encoding='utf-8'))
            if previous.get('phase') == 'prepared': retire_prepared(journal, previous)
            elif previous.get('phase') not in ('committed', 'rolled-back', 'aborted'):
                raise RuntimeError('An unresolved update requires recovery first')
        config = json.loads((profile / 'package.json').read_text(encoding='utf-8'))
        if PACKAGE not in config.get('dependencies', {}): raise RuntimeError('Plugin is not registered in this profile')
        if not (plugin / 'package.json').is_file(): raise RuntimeError('Existing plugin is incomplete; use the recovery installer with a trusted old package')
        work = journal.parent / ('transaction-' + uuid.uuid4().hex); work.mkdir(parents=True)
        candidate = work / 'candidate'; candidate.mkdir()
        pkg = validate_archive(archive, expected, candidate)
        old = {name: base64.b64encode(data).decode() if (data := read(profile / name)) is not None else None for name in METADATA}
        shadow = work / 'profile'; shadow.mkdir()
        for name in (*METADATA, '.npmrc', 'pnpm-workspace.yaml'):
            if (profile / name).is_file(): shutil.copyfile(profile / name, shadow / name)
        staged_config = json.loads(json.dumps(config))
        staged_config['dependencies'][PACKAGE] = 'file:' + archive.resolve().as_posix()
        save(shadow / 'package.json', staged_config)
        pnpm = pnpm or Path(os.environ.get('APPDATA', str(Path.home() / 'AppData/Roaming'))) / 'npm/node_modules/pnpm/bin/pnpm.mjs'
        node = shutil.which('node.exe') or shutil.which('node')
        if not node or not Path(pnpm).is_file(): raise RuntimeError('Existing Node/pnpm toolchain required')
        resolver = work / 'resolver'; resolver.mkdir()
        save(resolver / 'package.json', {'private': True, 'dependencies': {PACKAGE: staged_config['dependencies'][PACKAGE]}})
        (resolver / 'pnpm-workspace.yaml').write_text('packages:\n  - .\n', encoding='utf-8')
        command = [node, str(pnpm), 'install', '--ignore-workspace', '--lockfile-only', '--offline', '--ignore-scripts', '--no-frozen-lockfile']
        with (work / 'prepare.log').open('wb') as log:
            result = subprocess.run(command, cwd=resolver, stdout=log, stderr=subprocess.STDOUT, timeout=120)
        if result.returncode: raise RuntimeError('Staging failed; live profile unchanged. ' + (work / 'prepare.log').read_text(encoding='utf-8', errors='replace')[-2000:])
        resolved_lock = (resolver / 'pnpm-lock.yaml').read_text(encoding='utf-8')
        original_lock = read(profile / 'pnpm-lock.yaml')
        if original_lock is None:
            if any(name != PACKAGE for group in ('dependencies', 'devDependencies', 'optionalDependencies') for name in config.get(group, {})): raise RuntimeError('Existing lockfile required to preserve unrelated dependencies')
            merged_lock = resolved_lock
        else: merged_lock = merge_plugin_lock(original_lock.decode('utf-8'), resolved_lock)
        (shadow / 'pnpm-lock.yaml').write_bytes(merged_lock.encode('utf-8'))
        new = {name: base64.b64encode((shadow / name).read_bytes()).decode() for name in METADATA}
        next_config = json.loads(base64.b64decode(new['package.json']))
        check = json.loads(json.dumps(next_config)); check['dependencies'][PACKAGE] = config['dependencies'][PACKAGE]
        if check != config: raise RuntimeError('Staged package manager changed unrelated profile configuration')
        plan = {'phase': 'prepared', 'work': work.name, 'version': pkg['version'], 'buildId': expected['buildId'], 'old': old, 'new': new, 'oldTree': tree(plugin), 'newTree': tree(candidate)}
        save(journal, plan)
        return {'ok': True, 'phase': 'prepared', 'transactionId': work.name, 'version': pkg['version']}

def restore(profile, plugin, journal, plan):
    for name in METADATA:
        current = read(profile / name)
        allowed = [base64.b64decode(data) if data is not None else None for data in (plan['old'][name], plan['new'][name])]
        if current not in allowed: raise RuntimeError('Profile changed during recovery; backup retained')
    work = journal.parent / plan['work']; backup = work / 'previous'; failed = work / 'failed-candidate'
    if backup.exists():
        if plugin.exists():
            if tree(plugin) != plan['newTree']: raise RuntimeError('Installed candidate changed; preserved backup requires manual recovery')
            os.rename(plugin, failed)
        os.rename(backup, plugin)
    elif tree(plugin) != plan['oldTree']: raise RuntimeError('Old package backup unavailable')
    for name, data in plan['old'].items():
        if data is None:
            if (profile / name).exists(): (profile / name).unlink()
        else: atomic(profile / name, base64.b64decode(data))
    if tree(plugin) != plan['oldTree']: raise RuntimeError('Restored package verification failed')
    plan['phase'] = 'rolled-back'; save(journal, plan)

def commit(profile, transaction_id, fault=lambda phase: None):
    profile, plugin, journal = locations(profile)
    with profile_lock(profile):
        plan = json.loads(journal.read_text(encoding='utf-8'))
        if plan['work'] != transaction_id or plan['phase'] != 'prepared': raise RuntimeError('Stale update transaction')
        if not re.fullmatch(r'transaction-[a-f0-9]{32}', plan['work']): raise RuntimeError('Invalid transaction path')
        work = journal.parent / plan['work']; candidate = work / 'candidate'
        if tree(plugin) != plan['oldTree'] or tree(candidate) != plan['newTree']: raise RuntimeError('Package changed after preparation')
        for name, data in plan['old'].items():
            if read(profile / name) != (base64.b64decode(data) if data is not None else None): raise RuntimeError('Profile changed after preparation')
        plan['phase'] = 'publishing'; save(journal, plan)
        try:
            os.rename(plugin, work / 'previous')
            fault('old-renamed')
            os.rename(candidate, plugin)
            fault('candidate-published')
            for name, data in plan['new'].items(): atomic(profile / name, base64.b64decode(data)); fault(name)
            if tree(plugin) != plan['newTree']: raise RuntimeError('Published package verification failed')
            plan['phase'] = 'committed'; save(journal, plan)
        except BaseException:
            restore(profile, plugin, journal, plan)
            raise
        return {'ok': True, 'application': 'restart-required', 'version': plan['version'], 'buildId': plan['buildId'], 'transactionId': plan['work']}

def cancel_prepared(profile):
    profile, plugin, journal = locations(profile)
    with profile_lock(profile):
        if not journal.exists(): return {'ok': True, 'phase': 'none'}
        plan = json.loads(journal.read_text(encoding='utf-8'))
        if plan.get('phase') == 'aborted': return {'ok': True, 'phase': 'aborted'}
        retire_prepared(journal, plan)
        return {'ok': True, 'phase': 'aborted', 'version': plan.get('version')}


def recover(profile):
    profile, plugin, journal = locations(profile)
    with profile_lock(profile):
        if not journal.exists(): return {'ok': True, 'phase': 'none'}
        plan = json.loads(journal.read_text(encoding='utf-8'))
        if not re.fullmatch(r'transaction-[a-f0-9]{32}', plan['work']): raise RuntimeError('Invalid transaction path')
        if plan['phase'] == 'publishing': restore(profile, plugin, journal, plan)
        elif plan['phase'] == 'prepared': plan['phase'] = 'aborted'; save(journal, plan)
        return {'ok': True, 'phase': plan['phase']}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['prepare', 'commit', 'recover', 'cancel-prepared'])
    parser.add_argument('--profile', type=Path, required=True); parser.add_argument('--archive', type=Path); parser.add_argument('--expected', type=Path); parser.add_argument('--transaction')
    args = parser.parse_args()
    try:
        if args.action == 'prepare': result = prepare(args.profile, args.archive, json.loads(args.expected.read_text(encoding='utf-8')))
        elif args.action == 'commit': result = commit(args.profile, args.transaction)
        elif args.action == 'cancel-prepared': result = cancel_prepared(args.profile)
        else: result = recover(args.profile)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'ok': False, 'code': 'UPDATE_TRANSACTION_FAILED', 'error': str(error)})); sys.exit(1)
