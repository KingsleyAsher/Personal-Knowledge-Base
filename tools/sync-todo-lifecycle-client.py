"""Synchronize only the marked todo UI block; preserve all other client code."""
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
source = (repo / 'src/client/todo-lifecycle-ui.js').read_text(encoding='utf-8')
source = source.replace('export function ', 'function ', 1)
entry = repo / 'src/client/index.js'
text = entry.read_text(encoding='utf-8')
begin = '    // BEGIN GENERATED TODO LIFECYCLE UI\n'
end = '    // END GENERATED TODO LIFECYCLE UI'
assert text.count(begin) == text.count(end) == 1, 'Ambiguous todo UI markers'
prefix, tail = text.split(begin)
_, suffix = tail.split(end)
embedded = '\n'.join('    ' + line if line else '' for line in source.split('\n'))
entry.write_text(prefix + begin + embedded + end + suffix, encoding='utf-8', newline='')
print('Synchronized todo lifecycle client')
