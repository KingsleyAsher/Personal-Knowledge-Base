import unittest, tempfile, json, hashlib, importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('verify_package',Path(__file__).resolve().parents[1]/'installer-design-b/installer/verify_package.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class PackageProof(unittest.TestCase):
 def test_current_package_and_stale_inputs(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);app=root/'apps/desktop';source=app/'out/current';source.mkdir(parents=True)
   inputs={'app/package.json':'{"version":"1.1.4"}','app/dist/index.html':'built UI','packages/kb-core/test.js':'current core','native-backend/plugin.tgz':'paired plugin'};rows=[]
   for name,text in inputs.items():
    file=app/name[4:] if name.startswith('app/') else root/name
    file.parent.mkdir(parents=True,exist_ok=True);file.write_text(text,encoding='utf-8');rows.append({'path':name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
   pair=root/'development/desktop-parity/artifacts/plugin/latest-plugin.json';pair.parent.mkdir(parents=True);pair.write_text(json.dumps({'path':str(root/'native-backend/plugin.tgz'),'sha256':rows[-1]['sha256']}))
   build=hashlib.sha256(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()[:16];package={'version':'1.1.4','buildId':build};(source/'BUILD-MANIFEST.json').write_text(json.dumps({**package,'files':rows}))
   module.verify_current_package(root,app,source,package)
   (root/'packages/kb-core/test.js').write_text('modified after packaging')
   with self.assertRaisesRegex(RuntimeError,'no longer matches'):module.verify_current_package(root,app,source,package)
   with self.assertRaisesRegex(RuntimeError,'identity'):module.verify_current_package(root,app,source,{**package,'version':'1.1.3'})
if __name__=='__main__':unittest.main()
