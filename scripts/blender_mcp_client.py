import argparse,json,socket,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('command');p.add_argument('--script');p.add_argument('--output');a=p.parse_args()
sys.stdout.reconfigure(encoding='utf-8');params={}
if a.script:params['code']=Path(a.script).read_text(encoding='utf-8')
if a.output:params.update(filepath=str(Path(a.output).resolve()),max_size=1600)
with socket.create_connection(('127.0.0.1',9876),timeout=15) as s:
    s.settimeout(120);s.sendall(json.dumps({'type':a.command,'params':params}).encode());data=b''
    while True:
        chunk=s.recv(1048576)
        if not chunk:raise RuntimeError('Incomplete Blender response')
        data+=chunk
        try:r=json.loads(data.decode());break
        except (json.JSONDecodeError,UnicodeDecodeError):pass
if a.command=='execute_code' and r.get('status')=='success':print(r.get('result',{}).get('result',r))
else:print(json.dumps(r,ensure_ascii=False,indent=2))
