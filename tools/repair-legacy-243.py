"""Repair a failed 2.4.3 installation from the pinned, public 2.4.3 archive.
Called by the manual recovery entry only after the existing client preflight.
"""
from pathlib import Path
import hashlib, json, os, re, runpy, uuid

PINNED_243_SHA256 = '2e635c7a09a478a1dbd963674ac41874033adc98b3d6be5ebe94e3414ed7d735'

def repair(profile, folder):
    api = runpy.run_path(str(folder / 'kb-transactional-update.py'), run_name='repair_transaction')
    profile, plugin, journal = api['locations'](profile)
    manifest = json.loads((folder / 'legacy-243-manifest.json').read_text(encoding='utf-8'))
    archive = folder / 'local-dsh-knowledge-base-2.4.3.tgz'
    if manifest.get('version') != '2.4.3' or manifest.get('sha256') != PINNED_243_SHA256 or hashlib.sha256(archive.read_bytes()).hexdigest() != PINNED_243_SHA256:
        raise RuntimeError('Trusted 2.4.3 recovery archive did not verify')
    with api['profile_lock'](profile):
        config = json.loads((profile / 'package.json').read_text(encoding='utf-8'))
        spec = config.get('dependencies', {}).get('@local/dsh-knowledge-base', '')
        if not re.search(r'knowledge-base-2\.4\.3(?:-build-[^/\\]+)?\.tgz', spec):
            raise RuntimeError('Profile is not a 2.4.3 installation; refused to guess a previous version')
        work = journal.parent / ('repair243-' + uuid.uuid4().hex); work.mkdir(parents=True)
        candidate = work / 'candidate'; candidate.mkdir()
        api['validate_archive'](archive, manifest, candidate)
        expected = api['tree'](candidate)
        if plugin.exists(): os.rename(plugin, work / 'damaged-package')
        try:
            os.rename(candidate, plugin)
            if api['tree'](plugin) != expected: raise RuntimeError('Repaired package did not verify')
        except BaseException:
            if plugin.exists(): os.rename(plugin, work / 'failed-repair')
            if (work / 'damaged-package').exists(): os.rename(work / 'damaged-package', plugin)
            raise
        result = {'repaired': True, 'version': '2.4.3', 'buildId': manifest['buildId'], 'metadataUnchanged': True}
        api['save'](work / 'result.json', result)
        return result
