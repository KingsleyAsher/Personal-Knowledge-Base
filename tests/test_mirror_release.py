import hashlib
import importlib.util
import io
import json
import re
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'tools'
sys.path.insert(0, str(TOOLS))
from mirror_release import APIError, MirrorAPI  # noqa: E402


def load_tool(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync_refs = load_tool('sync_mirror_refs', TOOLS / 'sync-mirror-refs.py')
publisher = load_tool('publish_mirror_release', TOOLS / 'publish-mirror-release.py')


class FakeResponse:
    def read(self):
        return b''

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class FakeAPI:
    def __init__(self, platform, hashes, existing=None):
        self.platform = platform
        self.hashes = hashes
        self.release = existing
        self.rows = []
        self.pending_name = None
        self.upload_count = 0
        self.patch_count = 0

    def repo(self, route='', method='GET', data=None, query=None, missing=False, raw=False, headers=None):
        if route == '/releases/tags/v2.1.3':
            if method == 'GET':
                if self.release is None and missing:
                    return None
                if self.release is None:
                    raise AssertionError('release was not created')
                return self.release
            raise AssertionError('unexpected release route method')
        if route == '/releases' and method == 'POST':
            self.release = {**data, 'id': 17 if self.platform == 'gitee' else None,
                            'prerelease': False, 'release_status': 'latest', 'assets': []}
            return self.release
        if route in ('/releases/17', '/releases/v2.1.3') and method == 'PATCH':
            self.patch_count += 1
            self.release.update(data)
            return self.release
        if self.platform == 'gitee' and route == '/releases/17/attach_files':
            if method == 'GET':
                return self.rows
            if method == 'POST':
                match = re.search(rb'filename="([^"]+)"', data)
                name = match.group(1).decode()
                self.rows.append({'name': name, 'sha256': self.hashes[name]})
                self.upload_count += 1
                return {}
        if self.platform == 'gitcode' and route == '/releases/v2.1.3/upload_url':
            self.pending_name = query['file_name']
            return {'url': 'https://upload.myhuaweicloud.com/object',
                    'headers': {'x-obs-meta-project-id': 'fixture', 'Content-Type': 'application/octet-stream'}}
        raise AssertionError(f'unexpected API request: {method} {route}')

    def opener(self, request, timeout=0):
        if self.platform != 'gitcode' or timeout != 120:
            raise AssertionError('unexpected signed upload request')
        name = self.pending_name
        self.release['assets'].append({'name': name, 'digest': 'sha256:' + self.hashes[name]})
        self.upload_count += 1
        return FakeResponse()


class MirrorReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / 'release-manifest.json').read_text(encoding='utf-8'))
        cls.tag = 'v' + cls.manifest['version']
        cls.release_data = publisher.release_files(ROOT, cls.tag)

    def test_release_assets_are_pinned_to_a_valid_stable_tag(self):
        manifest, commit, notes, files = self.release_data
        self.assertTrue(commit)
        self.assertEqual(manifest['version'], self.tag[1:])
        self.assertTrue(notes.startswith('# ' + manifest['version']))
        self.assertEqual(len(files), 6)
        self.assertEqual(hashlib.sha256(files[manifest['tgz']]).hexdigest(), manifest['sha256'])

    def test_pull_source_must_be_the_exact_github_repository(self):
        sync_refs.validate_source('https://github.com/KingsleyAsher/Personal-Knowledge-Base.git')
        for url in (
            'https://github.com.evil.test/KingsleyAsher/Personal-Knowledge-Base.git',
            'https://attacker@github.com/KingsleyAsher/Personal-Knowledge-Base.git',
            'https://github.com/KingsleyAsher/Personal-Knowledge-Base.git?token=secret',
            'https://github.com/KingsleyAsher/Other-Repository.git',
        ):
            with self.subTest(url=url), self.assertRaises(RuntimeError):
                sync_refs.validate_source(url)

    def test_wait_for_pull_mirror_checks_refs_without_private_sync_endpoint(self):
        class API:
            calls = 0

            def repo(self, route):
                self.calls += 1
                return {'update_status': 'finished', 'number_of_failures': 0,
                        'last_update_at': 'same', 'last_error': ''}

        api = API()
        states = iter([False, True])
        sync_refs.wait_for_pull(api, {'url': 'https://github.com/KingsleyAsher/Personal-Knowledge-Base',
                                      'update_status': 'finished', 'number_of_failures': 0,
                                      'last_update_at': 'same'},
                                lambda: next(states), wait_seconds=60, sleep=lambda _seconds: None,
                                clock=iter([0, 1, 2, 3]).__next__)
        self.assertEqual(api.calls, 1)

    def test_failed_mirror_reports_platform_error_after_short_grace(self):
        class API:
            def repo(self, route):
                return {'update_status': 'failed', 'number_of_failures': 0,
                        'last_update_at': 'same', 'last_error': 'remote unavailable'}

        ticks = iter([0, 10, 20, 30, 40, 50])
        with self.assertRaisesRegex(RuntimeError, 'remote unavailable'):
            sync_refs.wait_for_pull(API(), {'url': 'https://github.com/KingsleyAsher/Personal-Knowledge-Base',
                                            'update_status': 'failed', 'number_of_failures': 0,
                                            'last_update_at': 'same'},
                                    lambda: False, wait_seconds=60, sleep=lambda _seconds: None,
                                    clock=ticks.__next__)

    def test_api_errors_redact_explicit_token_even_outside_environment(self):
        token = 'private-test-token-731'

        def rejected(request, timeout=0):
            body = json.dumps({'message': 'rejected ' + token}).encode()
            raise urllib.error.HTTPError(request.full_url, 403, 'Forbidden', {}, io.BytesIO(body))

        api = MirrorAPI('gitcode', token=token, opener=rejected)
        with self.assertRaises(APIError) as caught:
            api.repo('/repo_remote_mirror')
        self.assertNotIn(token, str(caught.exception))
        self.assertIn('[redacted]', str(caught.exception))

    def test_release_creation_preserves_manual_notes_and_is_idempotent(self):
        manifest, commit, _notes, files = self.release_data
        hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()}
        for platform in ('gitee', 'gitcode'):
            existing = {'id': 17 if platform == 'gitee' else None,
                        'tag_name': self.tag, 'name': '手工标题', 'body': '人工补充的发行说明',
                        'prerelease': False, 'release_status': 'latest', 'assets': []}
            api = FakeAPI(platform, hashes, existing)

            real_git_bytes = publisher.git_bytes

            def git_bytes(repo, *args):
                if args[0] == 'ls-remote':
                    return f'{commit}\trefs/tags/{self.tag}\n'.encode()
                return real_git_bytes(repo, *args)

            with self.subTest(platform=platform), patch.object(publisher, 'git_bytes', side_effect=git_bytes):
                publisher.publish(platform, repo=ROOT, tag=self.tag, api=api)
                first_body = api.release['body']
                publisher.publish(platform, repo=ROOT, tag=self.tag, api=api)

            self.assertIn('人工补充的发行说明', first_body)
            self.assertEqual(api.release['name'], '手工标题')
            self.assertEqual(first_body.count('<!-- kb-release-managed:start -->'), 1)
            self.assertEqual(api.release['body'], first_body)
            self.assertEqual(api.upload_count, 6)
            self.assertEqual(api.patch_count, 1)

    def test_missing_release_is_created_with_all_native_assets(self):
        _manifest, commit, _notes, files = self.release_data
        hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()}
        for platform in ('gitee', 'gitcode'):
            api = FakeAPI(platform, hashes)
            real_git_bytes = publisher.git_bytes

            def git_bytes(repo, *args):
                if args[0] == 'ls-remote':
                    return f'{commit}\trefs/tags/{self.tag}\n'.encode()
                return real_git_bytes(repo, *args)

            with self.subTest(platform=platform), patch.object(publisher, 'git_bytes', side_effect=git_bytes):
                publisher.publish(platform, repo=ROOT, tag=self.tag, api=api)
                publisher.publish(platform, repo=ROOT, tag=self.tag, api=api)

            self.assertEqual(api.release['tag_name'], self.tag)
            self.assertEqual(api.upload_count, 6)
            self.assertEqual(api.patch_count, 0)

    def test_gitcode_signed_upload_does_not_forward_repository_token(self):
        manifest, _commit, _notes, files = self.release_data
        name, raw = next(iter(files.items()))
        hashes = {name: hashlib.sha256(raw).hexdigest()}
        seen = []

        def opener(request, timeout=0):
            seen.append((request.full_url, {k.lower(): v for k, v in request.header_items()}, timeout))
            return FakeResponse()

        class UntrustedAPI:
            platform = 'gitcode'

            def repo(self, *args, **kwargs):
                return {'url': 'https://upload.attacker.example/object', 'headers': {}}

        with self.assertRaisesRegex(RuntimeError, 'Untrusted attachment upload host'):
            publisher.upload(UntrustedAPI(), {'id': None}, self.tag, name, raw)

        class SignedAPI(FakeAPI):
            def repo(self, route='', method='GET', data=None, query=None, missing=False, raw=False, headers=None):
                self.pending_name = name
                return {'url': 'https://upload.myhuaweicloud.com/object',
                        'headers': {'x-obs-meta-project-id': 'fixture'}}

        signed_api = SignedAPI('gitcode', hashes)
        signed_api.opener = opener
        publisher.upload(signed_api, {'id': None}, self.tag, name, raw)
        self.assertEqual(len(seen), 1)
        self.assertTrue(seen[0][0].startswith('https://upload.myhuaweicloud.com/'))
        self.assertNotIn('authorization', seen[0][1])
        self.assertNotIn('cookie', seen[0][1])


if __name__ == '__main__':
    unittest.main()
