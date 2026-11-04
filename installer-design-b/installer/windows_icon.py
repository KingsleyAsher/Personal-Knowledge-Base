from pathlib import Path
import ctypes as c,struct
from ctypes import wintypes as w
from PIL import Image
BASE=Path(__file__).resolve().parent
ICON=BASE/'KnowledgeWorkbench.ico'
def generate():
 source=BASE.parent.parent/'src/client/capture-icon-512.png'
 Image.open(source).convert('RGBA').save(ICON,format='ICO',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
 return ICON
def patch(exe):
 k=c.WinDLL('kernel32',use_last_error=True)
 k.LoadLibraryExW.argtypes=[w.LPCWSTR,w.HANDLE,w.DWORD];k.LoadLibraryExW.restype=w.HMODULE
 k.FreeLibrary.argtypes=[w.HMODULE]
 cbtype=c.WINFUNCTYPE(w.BOOL,w.HMODULE,c.c_void_p,c.c_void_p,c.c_ssize_t)
 k.EnumResourceNamesW.argtypes=[w.HMODULE,c.c_void_p,cbtype,c.c_ssize_t]
 groups=[]
 @cbtype
 def cb(mod,typ,name,param):
  groups.append(name if name<=65535 else c.wstring_at(name));return True
 module=k.LoadLibraryExW(str(exe),None,2)
 if not module:raise c.WinError(c.get_last_error())
 k.EnumResourceNamesW(module,c.c_void_p(14),cb,0);k.FreeLibrary(module)
 k.BeginUpdateResourceW.argtypes=[w.LPCWSTR,w.BOOL];k.BeginUpdateResourceW.restype=w.HANDLE
 k.UpdateResourceW.argtypes=[w.HANDLE,c.c_void_p,c.c_void_p,w.WORD,c.c_void_p,w.DWORD];k.UpdateResourceW.restype=w.BOOL
 k.EndUpdateResourceW.argtypes=[w.HANDLE,w.BOOL];k.EndUpdateResourceW.restype=w.BOOL
 raw=ICON.read_bytes();count=struct.unpack_from('<H',raw,4)[0];group=raw[:6];entries=[]
 for i in range(count):
  entry=raw[6+16*i:22+16*i];size,offset=struct.unpack_from('<II',entry,8);rid=500+i
  entries.append((rid,raw[offset:offset+size]));group+=entry[:12]+struct.pack('<H',rid)
 handle=k.BeginUpdateResourceW(str(exe),False)
 if not handle:raise c.WinError(c.get_last_error())
 try:
  for rid,blob in entries:
   buf=c.create_string_buffer(blob)
   if not k.UpdateResourceW(handle,c.c_void_p(3),c.c_void_p(rid),1033,buf,len(blob)):raise c.WinError(c.get_last_error())
  for name in groups or [1]:
   ptr=c.c_void_p(name) if isinstance(name,int) else c.cast(c.c_wchar_p(name),c.c_void_p)
   buf=c.create_string_buffer(group)
   if not k.UpdateResourceW(handle,c.c_void_p(14),ptr,1033,buf,len(group)):raise c.WinError(c.get_last_error())
 except:
  k.EndUpdateResourceW(handle,True);raise
 if not k.EndUpdateResourceW(handle,False):raise c.WinError(c.get_last_error())
 return len(entries)
if __name__=='__main__':generate()
