import unittest, tempfile, subprocess,struct,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CSC=Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')

@unittest.skipUnless(CSC.is_file(),'Windows C# compiler required')
class SignedPayload(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();cls.base=Path(cls.tmp.name)
  harness=cls.base/'Probe.cs';harness.write_text('using System;using System.IO;class Probe{static int Main(string[] a){try{using(var f=File.OpenRead(a[0]))Console.Write(PayloadLayout.FindEnd(f));return 0;}catch{return 2;}}}')
  cls.probe=cls.base/'Probe.exe'
  subprocess.run([str(CSC),'/nologo','/out:'+str(cls.probe),str(ROOT/'installer-design-b/installer/PayloadLayout.cs'),str(harness)],check=True,capture_output=True)
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def fixture(self,bits=64,signed=False,padding=0):
  b=bytearray(1024);struct.pack_into('<H',b,0,0x5a4d);struct.pack_into('<I',b,0x3c,128);struct.pack_into('<I',b,128,0x4550)
  opt=152;directories=112 if bits==64 else 96
  struct.pack_into('<H',b,148,240 if bits==64 else 224);struct.pack_into('<H',b,opt,0x20b if bits==64 else 0x10b);struct.pack_into('<I',b,opt+directories-4,16)
  b+=b'payload'+bytes(padding)+bytes(40)+b'KBSETUP1';end=len(b)
  if signed:
   b+=bytes((-len(b))%8);offset=len(b);cert=struct.pack('<IHH',16,0x200,2)+bytes(8);b+=cert;struct.pack_into('<II',b,opt+directories+32,offset,len(cert))
  return b,end
 def run_fixture(self,b):
  p=self.base/'fixture.exe';p.write_bytes(b);return subprocess.run([str(self.probe),str(p)],capture_output=True,text=True)
 def test_unsigned_and_certificate_table_with_all_alignments(self):
  for bits in [32,64]:
   for padding in range(8):
    for signed in [False,True]:
     b,end=self.fixture(bits,signed,padding);r=self.run_fixture(b);self.assertEqual(r.returncode,0);self.assertEqual(int(r.stdout),end)
 def test_corrupt_certificates_and_trailer_rejected(self):
  b,_=self.fixture(signed=True);struct.pack_into('<II',b,152+112+32,2,16);self.assertEqual(self.run_fixture(b).returncode,2)
  b,end=self.fixture(signed=True);b[end-1]=0;self.assertEqual(self.run_fixture(b).returncode,2)
  b,_=self.fixture();b+=b'bad';self.assertEqual(self.run_fixture(b).returncode,2)
 def test_missing_certificate_fails_before_packaging(self):
  env=dict(os.environ);env.pop('KB_SIGN_CERT_SHA1',None)
  r=subprocess.run(['python',str(ROOT/'installer-design-b/installer/build.py')],env=env,capture_output=True,text=True)
  self.assertNotEqual(r.returncode,0);self.assertIn('Trusted code signing is required',r.stderr)

if __name__=='__main__':unittest.main()
