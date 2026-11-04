from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
target = root / 'src/client/index.js'
text = target.read_text(encoding='utf-8')
begin = '    // BEGIN GENERATED WORKBENCH UI\n'
end = '    // END GENERATED WORKBENCH UI\n'
source = (root / 'src/client/workbench-ui.js').read_text(encoding='utf-8')
theme = (root / 'src/client/knowledge-ui.css').read_text(encoding='utf-8')
generated = begin + '    const KNOWLEDGE_UI_THEME = ' + json.dumps(theme, ensure_ascii=False) + '\n' + '\n'.join('    ' + line if line else '' for line in source.splitlines()) + '\n' + end
if begin in text:
    start = text.index(begin)
    stop = text.index(end, start) + len(end)
    text = text[:start] + generated + text[stop:]
else:
    anchor = '    const e = react.createElement\n'
    assert text.count(anchor) == 1
    text = text.replace(anchor, anchor + generated)
bridge_begin = '    // BEGIN GENERATED INBOX BRIDGE\n'
bridge_end = '    // END GENERATED INBOX BRIDGE\n'
bridge_source = (root / 'src/client/inbox-organize-bridge.js').read_text(encoding='utf-8')
bridge = bridge_begin + '\n'.join('    ' + line if line else '' for line in bridge_source.splitlines()) + '\n' + bridge_end
if bridge_begin in text:
    start = text.index(bridge_begin)
    stop = text.index(bridge_end, start) + len(bridge_end)
    text = text[:start] + bridge + text[stop:]
else:
    anchor = '    let flowClientContext = null\n'
    assert text.count(anchor) == 1
    text = text.replace(anchor, bridge + anchor)
target.write_text(text, encoding='utf-8', newline='')
print('Embedded workbench UI: UTF-8 source synchronized')
