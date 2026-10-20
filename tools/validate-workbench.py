from pathlib import Path
import subprocess, json, re, sys

repo = Path(__file__).resolve().parents[1]
version = json.loads((repo / 'package.json').read_text(encoding='utf-8'))['version']
delivery = repo.parent / ('知识库产品-' + version)
delivery.mkdir(exist_ok=True)
commands = [
    ['python', '-X', 'utf8', 'tools/sync-workbench-client.py'],
    ['python', '-X', 'utf8', 'tools/sync-workbench-build.py'],
    ['node', '--check', 'src/client/index.js'],
    ['node', '--check', 'src/host/index.js'],
    ['node', '--test', 'tests/parsing-setup.test.mjs', 'tests/parsing-boundaries.test.mjs', 'tests/index-maintenance.test.mjs', 'tests/import-parse-auth.test.mjs', 'tests/client-update-flow.test.mjs', 'tests/update-download.test.mjs', 'tests/release-notice-dismiss.test.mjs', 'tests/workbench.test.mjs', 'tests/preview-updates.test.mjs'],
    ['node', 'tests/release-fixes-probe.mjs'],
    ['node', 'tests/flow-workspace-probe.mjs'],
    ['node', 'tests/flow-conversation-probe.mjs'],
    ['node', 'tests/updates-probe.mjs'],
    ['node', 'tests/rebuild-probe.mjs', 'src/host/index.js'],
]
if '--ui' in sys.argv:
    commands.append(['node', 'tests/workbench-ui.mjs'])
results = []
for command in commands:
    result = subprocess.run(command, cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace')
    results.append({'command': command, 'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    print(('PASS ' if result.returncode == 0 else 'FAIL ') + ' '.join(command), flush=True)
    if result.returncode:
        print(result.stdout[-4000:] + result.stderr[-4000:], flush=True)
        break
passed = len(results) == len(commands) and all(item['exitCode'] == 0 for item in results)
suite = next((item['stdout'] for item in results if '--test' in item['command']), '')
match = re.search(r'tests\s+(\d+)', suite)
report = {'version': version, 'passed': passed, 'testCount': int(match.group(1)) if match else None,
          'uiRun': '--ui' in sys.argv, 'formalRuntimeVerified': False, 'realModelAnswerVerified': False, 'commands': results}
(delivery / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['version','passed','testCount','uiRun']}, ensure_ascii=False), flush=True)
sys.exit(0 if passed else 1)
