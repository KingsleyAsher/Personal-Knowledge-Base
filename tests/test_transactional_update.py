import base64, hashlib, importlib.util, io, json, os, subprocess, sys, tarfile, tempfile, unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'tools/kb-transactional-update.py'
spec = importlib.util.spec_from_file_location('transaction', SOURCE)
transaction = importlib.util.module_from_spec(spec); spec.loader.exec_module(transaction)

class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='kb-upgrade-synthetic-'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.profile = self.root / 'profile'; self.profile.mkdir()
        self.plugin = self.profile / 'node_modules/@local/dsh-knowledge-base'; self.plugin.mkdir(parents=True)
        package = {'name': transaction.PACKAGE, 'version': '2.4.3', 'dsh': {'bundle': {'patch': ['./cordis.patch.yml']}}}
        (self.plugin / 'package.json').write_text(json.dumps(package), encoding='utf-8')
        (self.plugin / 'original.txt').write_bytes(b'OLD_PACKAGE_MUST_SURVIVE')
        (self.profile / 'package.json').write_text(json.dumps({'private': True, 'dependencies': {transaction.PACKAGE: 'file:old.tgz'}, 'dsh': {'profile': {'bundles': [transaction.PACKAGE]}}}), encoding='utf-8')
        # Synthetic user state is outside the package and must never be touched.
        (self.profile / 'kb-state').mkdir(); (self.profile / 'kb-state/binding.json').write_bytes(b'SYNTHETIC_STATE')
        self.before = transaction.tree(self.plugin); self.metadata = (self.profile / 'package.json').read_bytes()
        package['version'] = '2.4.4'
        files = {'package.json': json.dumps(package).encode(), 'src/host/index.js': b"const list = ['package.json']\n", 'cordis.patch.yml': b'# synthetic\n', 'new.txt': b'NEW_PACKAGE'}
        self.archive = self.root / 'candidate.tgz'
        with tarfile.open(self.archive, 'w:gz') as stream:
            for name, data in files.items():
                entry = tarfile.TarInfo('package/' + name); entry.size = len(data); stream.addfile(entry, io.BytesIO(data))
        raw = self.archive.read_bytes()
        build = hashlib.sha256(('package.json\0' + hashlib.sha256(files['package.json']).hexdigest() + '\n').encode()).hexdigest()[:16]
        self.expected = {'latestVersion': '2.4.4', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'buildId': build}

    def stage(self): return transaction.prepare(self.profile, self.archive, self.expected)['transactionId']
    def assert_old(self):
        self.assertEqual(transaction.tree(self.plugin), self.before)
        self.assertEqual((self.profile / 'package.json').read_bytes(), self.metadata)
        self.assertEqual((self.profile / 'kb-state/binding.json').read_bytes(), b'SYNTHETIC_STATE')

    def test_real_pnpm_stages_without_touching_live_install_and_commits(self):
        ident = self.stage(); self.assert_old()
        result = transaction.commit(self.profile, ident)
        self.assertEqual(result['application'], 'restart-required')
        self.assertEqual(json.loads((self.plugin / 'package.json').read_text())['version'], '2.4.4')
        self.assertTrue((self.profile / 'pnpm-lock.yaml').is_file())
        self.assertEqual((self.profile / 'kb-state/binding.json').read_bytes(), b'SYNTHETIC_STATE')

    def test_failure_after_each_publish_step_restores_exact_old_package_and_metadata(self):
        for point in ['old-renamed', 'candidate-published', 'package.json', 'pnpm-lock.yaml']:
            with self.subTest(point=point):
                ident = self.stage()
                def fail(phase):
                    if phase == point: raise PermissionError('synthetic EPERM')
                with self.assertRaises(PermissionError): transaction.commit(self.profile, ident, fault=fail)
                self.assert_old(); self.assertFalse((self.profile / 'pnpm-lock.yaml').exists())

    def test_changed_profile_and_competing_host_lock_do_not_publish(self):
        ident = self.stage()
        lock = self.profile / 'package.json.lock'; lock.write_text(str(os.getpid()) + '\n')
        with self.assertRaises(RuntimeError): transaction.commit(self.profile, ident)
        lock.unlink(); self.assert_old()
        (self.profile / 'package.json').write_bytes(self.metadata + b'\n')
        with self.assertRaises(RuntimeError): transaction.commit(self.profile, ident)
        self.assertEqual(transaction.tree(self.plugin), self.before)

    def test_process_crash_after_switch_is_recovered_from_durable_journal(self):
        ident = self.stage()
        code = "import runpy,os,pathlib; m=runpy.run_path(__import__('sys').argv[1]); m['commit'](pathlib.Path(__import__('sys').argv[2]),__import__('sys').argv[3],fault=lambda phase:os._exit(73) if phase=='package.json' else None)"
        result = subprocess.run([sys.executable, '-X', 'utf8', '-c', code, str(SOURCE), str(self.profile), ident])
        self.assertEqual(result.returncode, 73)
        self.assertEqual(transaction.recover(self.profile)['phase'], 'rolled-back'); self.assert_old()

    def test_digest_rejection_preserves_old_install(self):
        self.expected['sha256'] = '0' * 64
        with self.assertRaises(RuntimeError): self.stage()
        self.assert_old()

if __name__ == '__main__': unittest.main()
