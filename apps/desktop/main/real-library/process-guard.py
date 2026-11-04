"""Only report active legacy writers. Never terminate a DSH process."""
import json,re,subprocess,sys
from pathlib import Path
configuration=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
source=Path(configuration['sourceHome']);binding=json.loads((source/'profiles/desktop/kb-state/binding.json').read_text(encoding='utf-8-sig'))
script="[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'DeepSeek Harness.exe' -or $_.Name -eq 'node.exe' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"
r=subprocess.run(['powershell.exe','-NoProfile','-Command',script],capture_output=True,encoding='utf-8',timeout=15,creationflags=subprocess.CREATE_NO_WINDOW)
if r.returncode:raise RuntimeError('无法核对 DSH 运行状态，未执行迁移')
rows=json.loads(r.stdout) if r.stdout.strip() else [];rows=rows if isinstance(rows,list) else [rows];active=[]
for row in rows:
    command=row.get('CommandLine') or ''
    match=re.search(r'--profile\s+([^\s"]+)',command)
    if match:
        try:other=json.loads((source/'profiles'/match[1]/'kb-state/binding.json').read_text(encoding='utf-8-sig'))
        except (FileNotFoundError,ValueError):continue
        if str(Path(other.get('kbPath','')).resolve()).lower()==str(Path(binding['kbPath']).resolve()).lower():active.append(row['ProcessId'])
    elif row['Name']=='DeepSeek Harness.exe' and not re.search(r'\.(?:[cm]?js)\b|--type=',command,re.I):active.append(row['ProcessId'])
if active:
    print(json.dumps({'stopped':False,'message':'请先完全退出原 DSH（包括系统托盘），再运行真实库迁移入口。现有窗口没有被关闭。','processIds':active},ensure_ascii=False));sys.exit(2)
print(json.dumps({'stopped':True,'processesTerminated':0}))
