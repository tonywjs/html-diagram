#!/usr/bin/env python3
"""html-diagram 정적 검사. 브라우저 없이 확인할 수 있는 항목만 본다.
사용법: python3 static-check.py 산출.html
출력: JSON (pass:true면 통과, 종료 코드 0). 엔진 블록은 같은 폴더의 fig-editor.css/js와 비교한다.
브라우저 검증(콘솔 오류, quality-check.js의 격자 점유율, 드래그 추종)은 이 검사로 대신할 수 없다."""
import sys, re, json, pathlib

if len(sys.argv) < 2:
    print(__doc__); sys.exit(2)
f = pathlib.Path(sys.argv[1]); t = f.read_text(encoding='utf-8')
here = pathlib.Path(__file__).parent
css = (here / 'fig-editor.css').read_text(encoding='utf-8')
js = (here / 'fig-editor.js').read_text(encoding='utf-8')
out = {'file': str(f), 'errors': [], 'warnings': []}
E, W = out['errors'].append, out['warnings'].append

out['static_export']='id="fig-static-css"' in t and 'id="fig-static-js"' in t   # 배포본(편집기 제거)
if out['static_export']: W('배포본(편집기 제거)이라 엔진 블록 검사는 생략')
else:
    if css not in t: E('엔진 CSS 블록이 fig-editor.css와 다름 (엔진은 수정·요약 금지)')
    if js not in t: E('엔진 JS 블록이 fig-editor.js와 다름 (엔진은 수정·요약 금지)')
c = t.replace(css, '').replace(js, '')           # 문서 부분만 검사

m = re.search(r'<title>(.*?)</title>', c, re.S)
title = m.group(1).strip() if m else ''
if not title or title == '도식' or 'FIG:TITLE' in title: E('<title> 미교체: ' + repr(title))

n = len(re.findall('[—–]', c))
if n: E(f'줄표(em/en dash) {n}개')
emo = re.findall('[\U0001F300-\U0001FAFF☀-➿]', c)
if emo: W(f'이모지 {len(emo)}개 (배포 문서에는 쓰지 않는다)')

nodes = re.findall(r'<div[^>]*class="[^"]*\bfig-node\b[^"]*"[^>]*>', c)
ids = []
for nd in nodes:
    mi = re.search(r'\bid="([^"]+)"', nd)
    if not mi: E('id 없는 .fig-node: ' + nd[:80]); continue
    ids.append(mi.group(1))
    for k in ('left', 'top', 'width'):
        if not re.search(r'style="[^"]*\b' + k + r'\s*:', nd): E(f'#{mi.group(1)}: 인라인 {k} 없음')
dup = sorted({i for i in ids if ids.count(i) > 1})
if dup: E('id 중복: ' + ', '.join(dup))

edges = re.findall(r'<div[^>]*class="[^"]*\bfig-edge\b[^"]*"[^>]*>', c)
pt = r'^-?[\d.]+\s*,\s*-?[\d.]+$'; allids = set(ids)
for e in edges:
    for k in ('from', 'to'):
        mv = re.search(r'data-' + k + r'="([^"]*)"', e); v = mv.group(1) if mv else None
        if v is None: E('data-' + k + ' 없는 .fig-edge: ' + e[:80])
        elif not re.match(pt, v) and v not in allids: E(f'data-{k}="{v}": 실존하지 않는 노드 id')

canv = re.findall(r'<div[^>]*class="[^"]*\bfig-canvas\b[^"]*"[^>]*>', c)
if not canv: E('.fig-canvas 없음')
for cv in canv:
    if not re.search(r'data-size="\s*\d+\s*[x×]\s*\d+\s*"', cv): E('data-size="WxH" 없는 .fig-canvas: ' + cv[:80])

sizes = [float(x) for x in re.findall(r'font-size\s*:\s*([\d.]+)px', c)]
small = sorted({s for s in sizes if s < 12})
if small: W('12px 미만 font-size 선언: ' + ', '.join(str(s) for s in small) + 'px (캔버스 안 텍스트에 쓰였다면 위반)')

out.update({'nodes': len(nodes), 'edges': len(edges), 'canvases': len(canv), 'title': title,
            'min_font_declared': min(sizes) if sizes else None})
out['pass'] = not out['errors']
out['note'] = '브라우저 검증(콘솔 오류, quality-check.js 격자 점유율, 드래그 추종)은 이 검사로 대신할 수 없다'
print(json.dumps(out, ensure_ascii=False, indent=1))
sys.exit(0 if out['pass'] else 1)
