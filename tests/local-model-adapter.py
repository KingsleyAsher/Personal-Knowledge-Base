"""Synthetic component compatibility probes; never load weights or a model."""
from pathlib import Path
from tempfile import mkdtemp
from types import SimpleNamespace
import importlib.util
import json
import subprocess
import sys
import yaml

repo = Path(__file__).resolve().parents[1]
root = Path(mkdtemp(prefix='adapter-qa-', dir=repo.parent))
spec = importlib.util.spec_from_file_location('local_adapter', repo / 'tools/kb-local-model.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
det, rec = root / 'det', root / 'rec'
for directory, name in [(det, 'PP-OCRv5_server_det'), (rec, 'PP-OCRv5_server_rec')]:
    directory.mkdir()
    (directory / 'inference.json').write_text('{}', encoding='utf-8')
    (directory / 'inference.pdiparams').write_bytes(b'synthetic marker')
    (directory / 'inference.yml').write_text(yaml.safe_dump({'Global': {'model_name': name}, 'PostProcess': {'character_dict': ['a', 'b']}}), encoding='utf-8')
args = SimpleNamespace(det_model=str(det), rec_model=str(rec), dictionary='')
assert adapter.ppocr_specs(args) == ['PP-OCRv5_server_det', 'PP-OCRv5_server_rec']
checks = ['matching components accepted without inference']
config = yaml.safe_load((rec / 'inference.yml').read_text(encoding='utf-8'))
config['Global']['model_name'] = 'PP-OCRv4_server_rec'
(rec / 'inference.yml').write_text(yaml.safe_dump(config), encoding='utf-8')
try:
    adapter.ppocr_specs(args)
    raise AssertionError('version mismatch accepted')
except RuntimeError:
    checks.append('mixed model versions rejected')
config['Global']['model_name'] = 'PP-OCRv5_server_rec'
(rec / 'inference.yml').write_text(yaml.safe_dump(config), encoding='utf-8')
dictionary = root / 'dict.txt'
dictionary.write_text('wrong\n', encoding='utf-8')
args.dictionary = str(dictionary)
try:
    adapter.ppocr_specs(args)
    raise AssertionError('dictionary mismatch accepted')
except RuntimeError:
    checks.append('mismatched external dictionary rejected')
model = root / 'Qwen3-ASR'
model.mkdir()
(model / 'config.json').write_text('{}', encoding='utf-8')
(model / 'model-00001.safetensors').write_bytes(b'synthetic marker')
(model / 'model.safetensors.index.json').write_text(json.dumps({'weight_map': {'a': 'model-00001.safetensors', 'b': 'model-00002.safetensors'}}), encoding='utf-8')
result = subprocess.run([sys.executable, '-X', 'utf8', str(repo / 'tools/kb-local-model.py'), '--check', '--kind', 'asr', '--model', str(model)], check=True, capture_output=True, text=True, encoding='utf-8')
payload = json.loads(result.stdout.strip().splitlines()[-1])
assert not payload['ok'] and any('model-00002.safetensors' in item for item in payload['missing'])
checks.append('missing weight shard rejected before inference')
assert adapter.safe_error(RuntimeError('Exception from vlm worker: Connection error.'))[0] == 'LOCAL_SERVICE_UNAVAILABLE'
assert 'private fixture' not in adapter.safe_error(RuntimeError('private fixture: upstream response'))[1]
checks.append('stopped service gets actionable error without raw response')
print(json.dumps({'passed': True, 'checks': checks, 'root': str(root)}, ensure_ascii=False))
