from pathlib import Path
import concurrent.futures, urllib.request, urllib.error, json, hashlib
base='KingsleyAsher/Personal-Knowledge-Base'
urls=[
f'https://gitee.com/{base}/raw/main/release-manifest.json',
f'https://gitee.com/{base}/raw/master/release-manifest.json',
f'https://gitee.com/api/v5/repos/{base}/raw/release-manifest.json?ref=main',
f'https://raw.gitcode.com/{base}/raw/main/release-manifest.json',
f'https://gitcode.com/{base}/-/raw/main/release-manifest.json',
f'https://api.gitcode.com/api/v5/repos/{base}/raw/release-manifest.json?ref=main',
f'https://gitee.com/{base}/raw/main/dist/local-dsh-knowledge-base-1.1.4.tgz',
f'https://raw.gitcode.com/{base}/raw/main/dist/local-dsh-knowledge-base-1.1.4.tgz',
]
def probe(url):
    try:
        request=urllib.request.Request(url,headers={'User-Agent':'Personal-Knowledge-Base/1.1.5','Accept':'*/*'})
        with urllib.request.urlopen(request,timeout=18) as r:
            data=r.read(4*1024*1024)
            return {'url':url,'final':r.url,'status':r.status,'type':r.headers.get('Content-Type'),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'jsonVersion':json.loads(data).get('version') if data.lstrip().startswith(b'{') else None,'prefix':data[:70].decode('utf-8',errors='replace') if not data.startswith(b'\x1f\x8b') else 'gzip'}
    except Exception as e:return {'url':url,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(probe,urls))
out=Path(__file__).resolve().parents[2]/'mirror-probe.json'
out.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='')
print(json.dumps(results,ensure_ascii=False,indent=2),flush=True)
