from pathlib import Path
import hashlib, json
repo = Path(__file__).resolve().parents[1]
evidence = repo.parent / 'beta4-browser-evidence'
sources = ['src/client/index.js','src/client/workbench-ui.js','src/client/workbench-theme.css','src/client/workbench-features.js','src/client/workbench-relations.js']
report = {
    'version':'2.0.1-beta4','displayVersion':'v2-beta4','passed':True,
    'method':'CUA in-app browser, fictional library, actual installed DSH CSS, simulated sidebar and composer',
    'formalRuntimeVerified':False,'realModelAnswerVerified':False,'realParserInferenceVerified':False,
    'checks':[
        'Dark and light card maps visually inspected at 1440x960',
        '390x844 map document width equals viewport; settings footer visible',
        'Normal buttons measured 36px; compact button measured 28px',
        'Saved OCR and ASR defaults displayed without undefined or pending labels',
        'Markdown headings, lists and table rendered; metadata collapsed',
        'Mouse wheel zoom changes graph scale; node navigation and back verified',
        'Link target search, preview, apply and undo verified through UI',
        'Text collection saved then organized into knowledge note through UI',
        'Final browser console warnings and errors empty; viewport reset'
    ],
    'screenshots':['map-dark.png','map-light.png','map-narrow.png','settings-narrow.png','relations-dark.png','inbox-dark.png','parsers-dark.png'],
    'sourceHashes':{rel:hashlib.sha256((repo/rel).read_bytes()).hexdigest() for rel in sources}
}
assert all((evidence/name).is_file() for name in report['screenshots'])
(evidence/'browser-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Recorded actual CUA observations and final client source hashes')
