#!/usr/bin/env python3
"""폴더 목록을 받아 Aside repl 검증을 돌리고 verify.json에 병합, 스크린샷을 shots/로 복사"""
import pathlib,json,subprocess,sys,shutil,re
base=pathlib.Path.home()/'html-diagram-compare'; folders=sys.argv[1:]
snip=(pathlib.Path.home()/'.claude/skills/html-diagram/assets/quality-check.js').read_text(encoding='utf-8')
js=(base/'compare-verify.js').read_text(encoding='utf-8').replace('__FOLDERS__',json.dumps(folders)).replace('__SNIP__',json.dumps(snip))
(base/'_run-verify.js').write_text(js,encoding='utf-8')
res=subprocess.run(['aside','repl',js],capture_output=True,text=True,timeout=600)
m=re.search(r'VERIFY (\{.*\})',res.stdout+res.stderr,re.S)
if not m: print('NO RESULT', (res.stdout+res.stderr)[-800:]); sys.exit(1)
data=json.loads(m.group(1)); pwd=data.pop('pwd',None)
(base/'shots').mkdir(exist_ok=True)
for f,r in data.items():
    loc=[]
    for p in r.get('shots',[]):
        src=pathlib.Path(pwd)/p; dst=base/'shots'/src.name
        if src.exists(): shutil.copy(src,dst); loc.append('shots/'+src.name)
    r['shots_local']=loc
old=json.loads((base/'verify.json').read_text(encoding='utf-8')) if (base/'verify.json').exists() else {}
old.update(data); (base/'verify.json').write_text(json.dumps(old,ensure_ascii=False,indent=1),encoding='utf-8')
for f,r in data.items():
    q=r.get('quality',{}); print(f, 'pass=',q.get('pass'), [ (c['fill'],c['minFont']) for c in q.get('canvases',[])], 'render=',{k:r.get('render',{}).get(k) for k in ('nodes','edges','hidden','labels','canvases')}, 'drag=',r.get('drag'), 'shots=',len(r.get('shots_local',[])), 'err=',r.get('error'))
