"""Fixed local adapter. No dynamic script imports, no downloads, no shell calls."""
import argparse
import json
import os
import importlib.util
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

def safe_error(error):
    message = str(error).lower()
    if any(word in message for word in ['connection error', 'connection refused', 'connecterror']):
        return 'LOCAL_SERVICE_UNAVAILABLE', '本地视觉服务连接失败，请启动现有 OCR 服务后重试'
    if 'out of memory' in message:
        return 'LOCAL_GPU_MEMORY', '本地模型显存不足，请释放其他模型占用后重试'
    if 'timeout' in message or 'timed out' in message:
        return 'LOCAL_SERVICE_TIMEOUT', '本地模型调用超时，请检查服务运行状态'
    return 'LOCAL_MODEL_FAILED', '本地识别子步骤失败，请核对组件、环境及服务状态'

def ppocr_specs(a):
    import yaml
    import re
    configs = []
    for directory in [a.det_model, a.rec_model]:
        if not directory or not (Path(directory) / 'inference.pdiparams').is_file() or not (Path(directory) / 'inference.json').is_file():
            raise RuntimeError('检测或识别模型缺少 inference.json / inference.pdiparams')
        configs.append(yaml.safe_load((Path(directory) / 'inference.yml').read_text(encoding='utf-8')))
    names = [config.get('Global', {}).get('model_name', '') for config in configs]
    versions = [re.search(r'PP-OCRv([45])', name) for name in names]
    if not all(versions) or versions[0][1] != versions[1][1]:
        raise RuntimeError('请使用同版本的 PP-OCRv4 或 PP-OCRv5 检测和识别模型')
    chars = configs[1].get('PostProcess', {}).get('character_dict')
    if not chars:
        raise RuntimeError('识别模型缺少配套的内置字典')
    if a.dictionary and Path(a.dictionary).read_text(encoding='utf-8').splitlines() != chars:
        raise RuntimeError('外部字典与识别模型内置字典不一致')
    return names

def configured_layout_model(a):
    return a.layout_model or os.environ.get('KB_LAYOUT_MODEL_PATH', '')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kind', choices=['ocr', 'asr'], required=True)
    ap.add_argument('--model')
    ap.add_argument('--manifest')
    ap.add_argument('--out')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--protocol', default='')
    ap.add_argument('--layout-model', default='')
    ap.add_argument('--service-url', default='')
    ap.add_argument('--service-model', default='')
    ap.add_argument('--det-model', default='')
    ap.add_argument('--rec-model', default='')
    ap.add_argument('--dictionary', default='')
    a = ap.parse_args()
    if a.check:
        modules = ['torch', 'qwen_asr'] if a.kind == 'asr' else ['paddleocr', 'paddlex']
        missing = [name for name in modules if importlib.util.find_spec(name) is None]
        layout_dir = configured_layout_model(a)
        layout = Path(layout_dir) if layout_dir else None
        if a.kind == 'ocr' and a.protocol != 'ppocr-local':
            if not layout:
                missing.append('请配置 PP-DocLayoutV3 版面模型目录')
            else:
                missing.extend('PP-DocLayoutV3 缺少 ' + name for name in ['inference.yml', 'inference.json', 'inference.pdiparams'] if not (layout / name).is_file())
        if a.kind == 'asr' or a.protocol == 'paddle-local':
            model = Path(a.model or '')
            if not (model / 'config.json').is_file():
                missing.append('模型 config.json')
            weights = list(model.glob('*.safetensors')) + list(model.glob('pytorch_model*.bin'))
            if not weights:
                missing.append('模型权重')
            for index in model.glob('*.index.json'):
                weight_map = json.loads(index.read_text(encoding='utf-8')).get('weight_map', {})
                missing.extend('缺少权重分片：' + n for n in set(weight_map.values()) if not (model / n).is_file())
        if a.protocol == 'ppocr-local':
            try:
                ppocr_specs(a)
            except Exception as error:
                missing.append(str(error))
        print(json.dumps({'ok': not missing, 'missing': missing}))
        return
    if not a.manifest or not a.out or a.kind == 'asr' and not a.model:
        ap.error('model, manifest and out are required for recognition')
    rows = json.loads(Path(a.manifest).read_text(encoding='utf-8'))
    output = Path(a.out)
    results = []
    if a.kind == 'asr':
        import torch
        from qwen_asr import Qwen3ASRModel
        model = Qwen3ASRModel.from_pretrained(a.model, dtype=torch.bfloat16,
            device_map='cuda:0', max_inference_batch_size=8, max_new_tokens=1024)
        def recognize(file):
            return model.transcribe(audio=file, context='', language=None)[0].text.strip()
    elif a.protocol == 'ppocr-local':
        from paddleocr import PaddleOCR
        det_name, rec_name = ppocr_specs(a)
        model = PaddleOCR(text_detection_model_dir=a.det_model, text_detection_model_name=det_name,
            text_recognition_model_dir=a.rec_model, text_recognition_model_name=rec_name,
            use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_textline_orientation=False, device='cpu', enable_mkldnn=False)
        def recognize(file):
            return '\n'.join(text for r in model.predict(file) for text in r.json.get('res', {}).get('rec_texts', [])).strip()
    else:
        from paddleocr import PaddleOCRVL
        layout_dir = configured_layout_model(a)
        if not layout_dir:
            raise RuntimeError('请配置 PP-DocLayoutV3 版面模型目录')
        layout = Path(layout_dir)
        if not layout.is_dir():
            raise RuntimeError('Local PP-DocLayoutV3 is required; automatic downloads are disabled')
        visual = {'vl_rec_backend': 'vllm-server', 'vl_rec_server_url': a.service_url, 'vl_rec_api_model_name': a.service_model} if a.protocol == 'paddle-service' else {'vl_rec_model_dir': a.model}
        model = PaddleOCRVL(**visual,
            layout_detection_model_dir=str(layout), device='cpu',
            enable_mkldnn=False,
            use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_chart_recognition=False, use_seal_recognition=False,
            use_ocr_for_image_block=False)
        def recognize(file):
            texts = []
            for result in model.predict(file):
                md = result.markdown
                texts.append(md.get('markdown_texts', '') if isinstance(md, dict) else str(md))
            return '\n'.join(texts).strip()
    for row in rows:
        try:
            text = recognize(row['file'])
            result = {'index': row['index'], 'ok': bool(text), 'text': text, 'code': '' if text else 'EMPTY_TEXT'}
        except Exception as error:
            code, detail = safe_error(error)
            result = {'index': row['index'], 'ok': False, 'code': code, 'detail': detail}
        results.append(result)
        tmp = output.with_suffix('.tmp')
        tmp.write_text(json.dumps(results, ensure_ascii=False), encoding='utf-8')
        tmp.replace(output)

if __name__ == '__main__':
    main()
