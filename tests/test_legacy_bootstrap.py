"""Pristine public 2.4.6 -> official 2.4.13, with real Windows pnpm."""
from pathlib import Path
import importlib.util
import json
import os
import runpy
import subprocess
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bootstrap', ROOT / 'tools/bootstrap-legacy-update.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)
spec = importlib.util.spec_from_file_location('builder', ROOT / 'tools/build-legacy-bootstrap.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


@unittest.skipUnless(os.name == 'nt', 'Windows recovery entry')
class LegacyBootstrapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='kb-public-246-bootstrap-')
        cls.root = Path(cls.temp.name)
        cls.asset = cls.root / 'bootstrap.zip'
        builder.build(cls.asset)
        cls.bundle = cls.root / 'bundle'
        with zipfile.ZipFile(cls.asset) as stream:
            stream.extractall(cls.bundle)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.case = self.root / self._testMethodName
        # Distinct names and a non-default profiles root: no user's desktop path.
        self.profile = self.case / 'profiles/研究 profile'
        self.plugin = self.profile / 'node_modules/@local/dsh-knowledge-base'
        self.plugin.mkdir(parents=True)
        with tarfile.open(ROOT / 'dist/local-dsh-knowledge-base-2.4.6.tgz') as stream:
            for row in stream:
                if row.isfile():
                    dest = self.plugin.joinpath(*Path(row.name).parts[1:])
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(stream.extractfile(row).read())
        self.config = {
            'private': True,
            'dependencies': {bootstrap.PACKAGE: 'file:old-246.tgz',
                             '@example/local-agent': 'file:local-plugins/agent',
                             '@example/host-sdk': '99.0.0-unpublished'},
            'dsh': {'profile': {'bundles': [bootstrap.PACKAGE]}, 'synthetic': True}}
        (self.profile / 'package.json').write_text(json.dumps(self.config), encoding='utf-8')
        local = self.profile / 'local-plugins/agent'
        local.mkdir(parents=True)
        (local / 'package.json').write_text('{"name":"@example/local-agent","version":"1.0.0"}', encoding='utf-8')
        self.lock = """lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:
  .:
    dependencies:
      '@local/dsh-knowledge-base':
        specifier: file:old-246.tgz
        version: file:old-246.tgz
      '@example/local-agent':
        specifier: file:local-plugins/agent
        version: file:local-plugins/agent
      '@example/host-sdk':
        specifier: 99.0.0-unpublished
        version: 99.0.0-unpublished

packages:
  '@local/dsh-knowledge-base@file:old-246.tgz':
    resolution: {tarball: file:old-246.tgz}
  '@example/local-agent@file:local-plugins/agent':
    resolution: {directory: local-plugins/agent, type: directory}
  '@example/host-sdk@99.0.0-unpublished':
    resolution: {integrity: sha512-SYNTHETIC}

snapshots:
  '@local/dsh-knowledge-base@file:old-246.tgz': {}
  '@example/local-agent@file:local-plugins/agent': {}
  '@example/host-sdk@99.0.0-unpublished': {}
"""
        (self.profile / 'pnpm-lock.yaml').write_bytes(self.lock.encode())
        # A stand-in for private state; the recovery entry must not inspect it.
        self.sentinel = self.profile / 'kb-state/parse/jobs/synthetic.json'
        self.sentinel.parent.mkdir(parents=True)
        self.sentinel.write_bytes(b'SYNTHETIC_PARSE_BYTES')
        self.worker = runpy.run_path(str(self.bundle / 'kb-transactional-update.py'))
        self.before = self.worker['tree'](self.plugin)
        self.metadata = (self.profile / 'package.json').read_bytes()

    def assert_old(self):
        self.assertEqual(self.worker['tree'](self.plugin), self.before)
        self.assertEqual((self.profile / 'package.json').read_bytes(), self.metadata)
        self.assertEqual((self.profile / 'pnpm-lock.yaml').read_bytes(), self.lock.encode())
        self.assertEqual(self.sentinel.read_bytes(), b'SYNTHETIC_PARSE_BYTES')

    def test_external_entry_upgrades_pristine_246_and_preserves_unavailable_other_dependencies(self):
        self.assertEqual(bootstrap.select_profile(self.profile.parent), self.profile)
        checked = bootstrap.upgrade(self.profile, self.bundle, check_only=True)
        self.assertEqual(checked['phase'], 'checked')
        self.assertFalse((self.profile / '.kb-safe-updates').exists())
        self.assert_old()
        result = bootstrap.upgrade(self.profile, self.bundle, blockers=lambda: [])
        self.assertEqual(result['application'], 'restart-required')
        self.assertEqual(result['version'], '2.4.13')
        bootstrap.verify_installed(self.plugin, bootstrap.bundle(self.bundle)[1])
        current = json.loads((self.profile / 'package.json').read_text(encoding='utf-8'))
        current['dependencies'][bootstrap.PACKAGE] = self.config['dependencies'][bootstrap.PACKAGE]
        self.assertEqual(current, self.config)
        def other(text):
            lines, blocks = self.worker['managed_lock_blocks'](text)
            for start, end in reversed(blocks):
                del lines[start:end]
            return ''.join(lines)
        self.assertEqual(other((self.profile / 'pnpm-lock.yaml').read_text(encoding='utf-8')), other(self.lock))
        resolver = json.loads((self.profile / '.kb-safe-updates' / result['transactionId'] / 'resolver/package.json').read_text(encoding='utf-8'))
        self.assertEqual(set(resolver['dependencies']), {bootstrap.PACKAGE})
        self.assertEqual(self.sentinel.read_bytes(), b'SYNTHETIC_PARSE_BYTES')
        again = bootstrap.upgrade(self.profile, self.bundle, blockers=lambda: self.fail('Already-installed path must not write'))
        self.assertEqual(again['phase'], 'already-installed')

    def test_failure_after_package_publication_restores_every_old_file_and_metadata(self):
        def fail(phase):
            if phase == 'package.json':
                raise PermissionError('SYNTHETIC_WINDOWS_EPERM')
        with self.assertRaisesRegex(PermissionError, 'EPERM'):
            bootstrap.upgrade(self.profile, self.bundle, blockers=lambda: [], fault=fail)
        self.assert_old()
        plan = json.loads((self.profile / '.kb-safe-updates/transaction.json').read_text(encoding='utf-8'))
        self.assertEqual(plan['phase'], 'rolled-back')
        self.assertEqual(bootstrap.upgrade(self.profile, self.bundle, recover_only=True, blockers=lambda: [])['phase'], 'rolled-back')

    def test_busy_or_changed_package_and_ambiguous_profile_stop_without_installing(self):
        with self.assertRaisesRegex(RuntimeError, 'Active processes'):
            bootstrap.upgrade(self.profile, self.bundle, blockers=lambda: [{'ProcessId': os.getpid(), 'Name': 'synthetic-client'}])
        self.assert_old()
        second = self.profile.parent / 'second'
        second.mkdir()
        (second / 'package.json').write_bytes(self.metadata)
        with self.assertRaisesRegex(RuntimeError, 'Select one profile'):
            bootstrap.select_profile(self.profile.parent)
        original = self.plugin / 'src/client/index.js'
        original.write_bytes(original.read_bytes() + b'\n// changed\n')
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            bootstrap.upgrade(self.profile, self.bundle, blockers=lambda: [])
        self.assertFalse((self.profile / '.kb-safe-updates').exists())

    def test_bundled_python_runs_the_public_read_only_entry_with_a_non_default_profile(self):
        result = subprocess.run([str(self.bundle / 'runtime/python/python.exe'), '-X', 'utf8',
                                 str(self.bundle / 'bootstrap-legacy-update.py'), '--check',
                                 '--profile', str(self.profile)], capture_output=True, encoding='utf-8', timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['phase'], 'checked')
        self.assertFalse((self.profile / '.kb-safe-updates').exists())
        self.assert_old()


if __name__ == '__main__':
    unittest.main()
