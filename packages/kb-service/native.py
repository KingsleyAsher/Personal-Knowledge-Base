"""Windows transport/security shim. No knowledge-library access; stdlib only."""
import base64
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import sys
import threading
import queue
import time
import uuid

if os.name != 'nt':
    raise RuntimeError('Windows is required')
K = C.WinDLL('kernel32', use_last_error=True)
A = C.WinDLL('advapi32', use_last_error=True)
D = C.WinDLL('crypt32', use_last_error=True)
P = C.c_void_p
def api(lib, name, result, *args):
    f = getattr(lib, name); f.restype = result; f.argtypes = args; return f
close = api(K, 'CloseHandle', W.BOOL, W.HANDLE)
local_free = api(K, 'LocalFree', P, P)
current_process = api(K, 'GetCurrentProcess', W.HANDLE)
open_token = api(A, 'OpenProcessToken', W.BOOL, W.HANDLE, W.DWORD, C.POINTER(W.HANDLE))
token_info = api(A, 'GetTokenInformation', W.BOOL, W.HANDLE, C.c_int, P, W.DWORD, C.POINTER(W.DWORD))
sid_string = api(A, 'ConvertSidToStringSidW', W.BOOL, P, C.POINTER(W.LPWSTR))
convert_sd = api(A, 'ConvertStringSecurityDescriptorToSecurityDescriptorW', W.BOOL, W.LPCWSTR, W.DWORD, C.POINTER(P), P)
get_security = api(A, 'GetSecurityInfo', W.DWORD, W.HANDLE, C.c_int, W.DWORD, P, P, P, P, C.POINTER(P))
sd_string = api(A, 'ConvertSecurityDescriptorToStringSecurityDescriptorW', W.BOOL, P, W.DWORD, W.DWORD, C.POINTER(W.LPWSTR), P)
def checked(ok):
    if not ok: raise C.WinError(C.get_last_error())
    return ok
def sid_of(token):
    n = W.DWORD(); token_info(token, 1, None, 0, C.byref(n))
    buf = C.create_string_buffer(n.value); checked(token_info(token, 1, buf, n, C.byref(n)))
    out = W.LPWSTR(); checked(sid_string(C.cast(buf, C.POINTER(P))[0], C.byref(out)))
    try: return out.value
    finally: local_free(out)
def user_sid():
    token = W.HANDLE(); checked(open_token(current_process(), 8, C.byref(token)))
    try: return sid_of(token)
    finally: close(token)
SID = user_sid()
SDDL = 'D:P(A;;GA;;;SY)(A;;GA;;;' + SID + ')'
class SA(C.Structure):
    _fields_ = [('length', W.DWORD), ('descriptor', P), ('inherit', W.BOOL)]
def security(sddl=SDDL):
    sd = P(); checked(convert_sd(sddl, 1, C.byref(sd), None))
    return sd, SA(C.sizeof(SA), sd, False)
def descriptor(handle):
    sd = P(); err = get_security(handle, 6, 4, None, None, None, None, C.byref(sd))
    if err: raise C.WinError(err)
    out = W.LPWSTR()
    try:
        checked(sd_string(sd, 1, 4, C.byref(out), None))
        return out.value
    finally: local_free(out); local_free(sd)
class BLOB(C.Structure):
    _fields_ = [('size', W.DWORD), ('data', P)]
protect = api(D, 'CryptProtectData', W.BOOL, C.POINTER(BLOB), W.LPCWSTR, P, P, P, W.DWORD, C.POINTER(BLOB))
unprotect = api(D, 'CryptUnprotectData', W.BOOL, C.POINTER(BLOB), P, P, P, P, W.DWORD, C.POINTER(BLOB))
def crypt(value, decrypt=False):
    buf = C.create_string_buffer(value); source = BLOB(len(value), C.cast(buf, P)); target = BLOB()
    checked(unprotect(C.byref(source), None, None, None, None, 1, C.byref(target)) if decrypt else protect(C.byref(source), 'kb-service-v1', None, None, None, 1, C.byref(target)))
    try: return C.string_at(target.data, target.size)
    finally: local_free(target.data)
create_dir = api(K, 'CreateDirectoryW', W.BOOL, W.LPCWSTR, C.POINTER(SA))
create_file = api(K, 'CreateFileW', W.HANDLE, W.LPCWSTR, W.DWORD, W.DWORD, P, W.DWORD, W.DWORD, W.HANDLE)
INVALID = P(-1).value
def private_dir(target):
    p = Path(target).resolve()
    if not p.parent.is_dir(): raise ValueError('private parent must already exist')
    expected = 'D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;' + SID + ')'
    sd, sa = security(expected)
    try:
        # Windows may render an equivalent account SID as an SDDL alias (LA for
        # the built-in local administrator). Normalize the requested descriptor
        # with the same API used for the actual descriptor; do not relax ACLs.
        normalized = W.LPWSTR()
        checked(sd_string(sd, 1, 4, C.byref(normalized), None))
        try: expected = normalized.value
        finally: local_free(normalized)
        if not create_dir(str(p), C.byref(sa)) and C.get_last_error() != 183: raise C.WinError(C.get_last_error())
    finally: local_free(sd)
    if p.is_symlink() or p.is_junction(): raise ValueError('private directory cannot be a link')
    handle = create_file(str(p), 0x20000, 7, None, 3, 0x02000000, None)
    if handle == INVALID: raise C.WinError(C.get_last_error())
    try:
        actual = descriptor(handle)
        if actual != expected: raise ValueError('existing private directory has unexpected ACL: ' + actual)
        return {'sid': SID, 'sddl': actual}
    finally: close(handle)
open_process = api(K, 'OpenProcess', W.HANDLE, W.DWORD, W.BOOL, W.DWORD)
times = api(K, 'GetProcessTimes', W.BOOL, W.HANDLE, C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME))
def birth(pid):
    h = open_process(0x1000, False, pid)
    if not h:
        if C.get_last_error() == 87: return None
        raise C.WinError(C.get_last_error())
    try:
        code = W.DWORD(); checked(api(K, 'GetExitCodeProcess', W.BOOL, W.HANDLE, C.POINTER(W.DWORD))(h, C.byref(code)))
        if code.value != 259: return None
        fields = [W.FILETIME() for _ in range(4)]
        checked(times(h, *[C.byref(x) for x in fields]))
        return str((fields[0].dwHighDateTime << 32) | fields[0].dwLowDateTime)
    finally: close(h)
pipe_create = api(K, 'CreateNamedPipeW', W.HANDLE, W.LPCWSTR, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, C.POINTER(SA))
connect = api(K, 'ConnectNamedPipe', W.BOOL, W.HANDLE, P)
read = api(K, 'ReadFile', W.BOOL, W.HANDLE, P, W.DWORD, C.POINTER(W.DWORD), P)
write = api(K, 'WriteFile', W.BOOL, W.HANDLE, P, W.DWORD, C.POINTER(W.DWORD), P)
impersonate = api(A, 'ImpersonateNamedPipeClient', W.BOOL, W.HANDLE)
thread_token = api(A, 'OpenThreadToken', W.BOOL, W.HANDLE, W.DWORD, W.BOOL, C.POINTER(W.HANDLE))
current_thread = api(K, 'GetCurrentThread', W.HANDLE)
revert = api(A, 'RevertToSelf', W.BOOL)
class OVERLAPPED(C.Structure):
    _fields_ = [('Internal', C.c_size_t), ('InternalHigh', C.c_size_t), ('Offset', W.DWORD), ('OffsetHigh', W.DWORD), ('hEvent', W.HANDLE)]
create_event = api(K, 'CreateEventW', W.HANDLE, P, W.BOOL, W.BOOL, W.LPCWSTR)
get_result = api(K, 'GetOverlappedResult', W.BOOL, W.HANDLE, P, C.POINTER(W.DWORD), W.BOOL)
def pipe_io(handle, function, buffer=None):
    event = create_event(None, True, False, None); checked(event)
    ov = OVERLAPPED(); ov.hEvent = event; n = W.DWORD()
    try:
        ok = function(handle, C.byref(ov)) if buffer is None else function(handle, buffer, len(buffer), C.byref(n), C.byref(ov))
        if not ok:
            code = C.get_last_error()
            if function == connect and code == 535: return 0
            if code != 997: raise C.WinError(code)
            checked(get_result(handle, C.byref(ov), C.byref(n), True))
        return n.value
    finally: close(event)
LIMIT = 1048576
out_lock = threading.Lock(); connection_lock = threading.Lock(); connections = {}
def emit(obj):
    with out_lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=True, separators=(',', ':')) + '\n'); sys.stdout.flush()
def serve(name):
    if not name.startswith('\\\\.\\pipe\\dsh-kb-'): raise ValueError('invalid service pipe')
    sd, sa = security()
    def worker(h, cid):
        buf = C.create_string_buffer(65536); pending = b''; verified = False
        try:
            while True:
                n = pipe_io(h, read, buf)
                if not n: break
                if not verified:
                    checked(impersonate(h)); token = W.HANDLE()
                    try:
                        checked(thread_token(current_thread(), 8, True, C.byref(token)))
                        if sid_of(token) != SID: raise PermissionError('client SID mismatch')
                    finally:
                        if token.value: close(token)
                        checked(revert())
                    verified = True
                pending += buf.raw[:n]
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    if len(line) > LIMIT: raise ValueError('frame too large')
                    emit({'id': cid, 'frame': json.loads(line.decode('utf-8'))})
                if len(pending) > LIMIT: raise ValueError('frame too large')
        except (OSError, ValueError, UnicodeError): pass
        finally:
            with connection_lock: row = connections.pop(cid, None)
            if row:
                try: row[1].put_nowait(None)
                except queue.Full: pass
            close(h); emit({'id': cid, 'closed': True})
    def writer(h, outgoing):
        while True:
            data = outgoing.get()
            if data is None: return
            try: pipe_io(h, write, C.create_string_buffer(data, len(data)))
            except OSError: return
    def accept(first):
        h = first
        while True:
            pipe_io(h, connect)
            cid = uuid.uuid4().hex
            outgoing = queue.Queue(maxsize=32)
            with connection_lock: connections[cid] = (h, outgoing)
            threading.Thread(target=writer, args=(h,outgoing), daemon=True).start()
            threading.Thread(target=worker, args=(h, cid), daemon=True).start()
            while True:
                h = pipe_create(name, 3 | 0x40000000, 8, 32, 65536, 65536, 0, C.byref(sa))
                if h != INVALID: break
                if C.get_last_error() != 231: raise C.WinError(C.get_last_error())
                time.sleep(0.05)
    first = pipe_create(name, 3 | 0x80000 | 0x40000000, 8, 32, 65536, 65536, 0, C.byref(sa))
    if first == INVALID: raise C.WinError(C.get_last_error())
    emit({'ready': True, 'sid': SID, 'sddl': descriptor(first), 'remoteRejected': True})
    threading.Thread(target=accept, args=(first,), daemon=True).start()
    for line in sys.stdin:
        msg = json.loads(line)
        with connection_lock: row = connections.get(msg.get('id'))
        if not row: continue
        h, outgoing = row
        if msg.get('close'):
            api(K, 'CancelIoEx', W.BOOL, W.HANDLE, P)(h, None)
            continue
        data = (json.dumps(msg['frame'], ensure_ascii=True, separators=(',', ':')) + '\n').encode()
        if len(data) > LIMIT: continue
        try: outgoing.put_nowait(data)
        except queue.Full: api(K, 'CancelIoEx', W.BOOL, W.HANDLE, P)(h, None)
    # Parent death closes stdin: terminate our threads and all pipe instances.
    os._exit(0)
if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'serve': serve(sys.argv[2])
    else:
        data = json.load(sys.stdin)
        if cmd == 'private-dir': result = private_dir(data['path'])
        elif cmd == 'birth': result = birth(data['pid'])
        elif cmd == 'protect': result = base64.b64encode(crypt(json.dumps(data).encode())).decode()
        elif cmd == 'unprotect': result = json.loads(crypt(base64.b64decode(data), True))
        else: raise ValueError('unknown command')
        print(json.dumps(result))
