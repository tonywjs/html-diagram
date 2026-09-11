#!/usr/bin/env python3
"""static.json + verify.json + 스크린샷 → index.html 비교 페이지"""
import json,pathlib,html
base=pathlib.Path.home()/'html-diagram-compare'
S=json.loads((base/'static.json').read_text(encoding='utf-8')); V=json.loads((base/'verify.json').read_text(encoding='utf-8')) if (base/'verify.json').exists() else {}
C=json.loads((base/'console.json').read_text(encoding='utf-8')) if (base/'console.json').exists() else {}
import sys; sys.path.insert(0,str(base))
from meta import names, order, EFFORT, NOTES, CAVEAT
rows=[]; cards=[]
def yn(b): return '<span class="ok">통과</span>' if b else '<span class="ng">실패</span>'
for k in order:
    if k not in S: rows.append(f'<tr><td>{names[k]}</td><td>{EFFORT.get(k,"-")}</td><td colspan="12" class="mute">산출물 없음</td></tr>'); continue
    s=S[k]; v=V.get(k,{}); q=v.get('quality',{}); cv=q.get('canvases',[])
    fill='/'.join(str(c['fill']) for c in cv) if cv else '-'; mf='/'.join(str(c['minFont']) for c in cv) if cv else '-'
    ef=s['edge_features']; tf=s['text_features']
    cov=[]; 
    for lab,val in [('실선',ef.get('solid',0)>0),('파선','dashed' in ef['styles']),('점선','dotted' in ef['styles']),('both','both' in ef['arrows']),('none','none' in ef['arrows']),('곡률',ef['curve']>0),('투명도',ef['opacity']>0),('흐름',ef['flow']>0),('측면앵커',ef['side_anchor']>0),('비율앵커',ef['ratio_anchor']>0),('좌표끝점',ef['coord_end']>0),('라벨',ef['label']>0)]:
        cov.append(f'<span class="{"c1" if val else "c0"}">{lab}</span>')
    tcov=[]
    for lab,val in [('표',tf['table']>0),('목록',tf['list']>0),('인용',tf['blockquote']>0),('굵게',tf['bold']>0),('기울임',tf['italic']>0),('밑줄',tf['underline']>0),('취소선',tf['strike']>0),('SVG',tf['svg_icons']>0),('원형',tf['round_nodes']>0)]:
        tcov.append(f'<span class="{"c1" if val else "c0"}">{lab}</span>')
    drag=v.get('drag',{}); con=C.get(k)
    rows.append(f'''<tr><td><b>{names[k]}</b><br><a href="{k}/poster.html">poster.html</a> · {s["bytes"]//1024}KB</td>
<td>{EFFORT.get(k,"-")}</td><td>{s["canvases"]}</td><td>{s["nodes"]}</td><td>{s["edges"]}</td>
<td>{yn(s["engine_css_ok"] and s["engine_js_ok"])}</td><td>{yn(s["edges_bad_ref"]==0 and s["dup_ids"]==0 and s["nodes_without_id"]==0 and s["nodes_missing_inline_pos"]==0)}<br><small>{s["edges_bad_ref"]}참조/{s["dup_ids"]}중복/{s["nodes_missing_inline_pos"]}좌표</small></td>
<td>{yn(s["dashes"]==0 and s["emoji"]==0)}<br><small>줄표 {s["dashes"]} · 이모지 {s["emoji"]}</small></td>
<td>{yn(q.get("pass",False))}<br><small>fill {fill} · min {mf}</small></td>
<td>{yn(con==0) if con is not None else "-"}{"" if con is None else f"<br><small>{con}건</small>"}</td>
<td>{yn(drag.get("moved") and drag.get("edgeFollowed")) if drag.get("node") else "-"}</td>
<td class="cov">{"".join(cov)}</td><td class="cov">{"".join(tcov)}</td></tr>''')
    shots=v.get('shots_local',[])
    imgs=[]
    for sp in shots:
        jp=base/'shots-jpg'/(pathlib.Path(sp).stem+'.jpg')
        if jp.exists():
            import base64; imgs.append('data:image/jpeg;base64,'+base64.b64encode(jp.read_bytes()).decode())
        else: imgs.append(sp)
    cards.append(f'<section><h2>{names[k]} <a href="{k}/poster.html">열기</a></h2><div class="strip">'+''.join(f'<img src="{u}" loading="lazy">' for u in imgs)+'</div></section>')
notes_html='<section><h2>정성 메모</h2><ul>'+''.join(f'<li><b>{names[k]}</b>: {html.escape(NOTES[k])}</li>' for k in order if NOTES.get(k))+'</ul><p class="mute">'+CAVEAT+'</p></section>'
page=f'''<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>html-diagram 모델 비교</title>
<style>body{{font-family:Pretendard,'Apple SD Gothic Neo',sans-serif;margin:24px;color:#0f172a;background:#f3f5f9}}
h1{{font-size:24px}} table{{border-collapse:collapse;background:#fff;font-size:13px}} th,td{{border:1px solid #dfe3ea;padding:6px 8px;vertical-align:top}} th{{background:#eef2f7}}
.ok{{color:#059669;font-weight:700}} .ng{{color:#dc2626;font-weight:700}} .mute{{color:#94a3b8}} small{{color:#64748b}}
.cov span{{display:inline-block;font-size:11px;padding:1px 5px;border-radius:4px;margin:1px}} .c1{{background:#dcfce7;color:#166534}} .c0{{background:#fee2e2;color:#991b1b;text-decoration:line-through}}
section{{margin-top:28px}} h2{{font-size:17px}} h2 a{{font-size:13px;margin-left:8px}} .strip{{display:flex;gap:8px;overflow-x:auto}} .strip img{{height:360px;border:1px solid #dfe3ea;border-radius:8px;background:#fff}}
</style></head><body><h1>html-diagram 기능 샘플러 포스터: 모델 비교</h1>
<p>같은 브리프(스킬 SKILL.md + 동일 지시문)로 각 모델이 만든 poster.html. 검사는 전부 같은 하네스로 수행. 생각 강도는 따로 지정하지 않아 기본값이 적용됐다: Claude 세 모델은 이 세션의 max를 상속했고, Codex 세 모델은 설정 파일 기본값 xhigh였다. astra는 사용자가 xhigh로 별도 실행 중. Claude 두 모델은 브라우저 검증까지 스스로 수행했고 Codex 모델은 브라우저가 없어 정적 검사만 했으며, 표의 브라우저 판정은 전부 이 하네스가 수행한 값이다.</p>
<table><tr><th>모델</th><th>생각 강도</th><th>캔버스</th><th>노드</th><th>엣지</th><th>엔진 무결</th><th>규약</th><th>문장부호</th><th>품질 스니펫</th><th>콘솔</th><th>드래그</th><th>화살표 속성 커버리지</th><th>노드·텍스트 커버리지</th></tr>{"".join(rows)}</table>
{notes_html}{"".join(cards)}</body></html>'''
(base/'index.html').write_text(page,encoding='utf-8'); print('index.html written')
