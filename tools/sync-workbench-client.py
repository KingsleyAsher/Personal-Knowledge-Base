from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / 'src/client/index.js'
text = target.read_text(encoding='utf-8')
begin = '    // BEGIN GENERATED WORKBENCH UI\n'
end = '    // END GENERATED WORKBENCH UI\n'
source = (root / 'src/client/workbench-ui.js').read_text(encoding='utf-8')
generated = begin + '\n'.join('    ' + line if line else '' for line in source.splitlines()) + '\n' + end
if begin in text:
    start = text.index(begin)
    stop = text.index(end, start) + len(end)
    text = text[:start] + generated + text[stop:]
else:
    anchor = '    const e = react.createElement\n'
    assert text.count(anchor) == 1
    text = text.replace(anchor, anchor + generated)
target.write_text(text, encoding='utf-8', newline='')
print('Embedded workbench UI: UTF-8 source synchronized')
