#!/usr/bin/env python3
"""static.json + verify.json + console.json + meta.py → compare/README.md 전체와 루트 README.md의 결과 블록.
스크린샷은 shots-jpg/*.jpg 를 참조한다(GitHub이 README 안의 이미지는 렌더하므로 index.html 대신 이걸 본다)."""
import json, pathlib, re, sys
here = pathlib.Path(__file__).parent; root = here.parent
sys.path.insert(0, str(here))
from meta import names, order, EFFORT, NOTES, CAVEAT
S = json.loads((here / 'static.json').read_text(encoding='utf-8'))
V = json.loads((here / 'verify.json').read_text(encoding='utf-8'))
C = json.loads((here / 'console.json').read_text(encoding='utf-8'))
def ok(b): return 'O' if b else 'X'

rows, cov, gal, sections = [], [], [], []
for k in order:
    if k not in S: continue
    s = S[k]; v = V.get(k, {}); q = v.get('quality', {}); cv = q.get('canvases', [])
    ef = s['edge_features']; tf = s['text_features']
    fill = ' / '.join(str(c['fill']) for c in cv) or '-'; mf = ' / '.join(str(c['minFont']) for c in cv) or '-'
    conv = s['edges_bad_ref'] == 0 and s['dup_ids'] == 0 and s['nodes_without_id'] == 0 and s['nodes_missing_inline_pos'] == 0
    punct = s['dashes'] == 0 and s['emoji'] == 0
    drag = v.get('drag', {}); con = C.get(k)
    rows.append(f"| {names[k]} | {EFFORT.get(k, '-')} | {s['canvases']} | {s['nodes']} | {s['edges']} | {fill} | {mf} | "
                f"{ok(s['engine_css_ok'] and s['engine_js_ok'])} | {ok(conv)} | {ok(punct)} | {ok(q.get('pass'))} | "
                f"{ok(con == 0) if con is not None else '-'} | {ok(drag.get('moved') and drag.get('edgeFollowed')) if drag.get('node') else '-'} |")
    cov.append(f"| {names[k]} | {ok(ef.get('solid', 0) > 0)} | {ok('dashed' in ef['styles'])} | {ok('dotted' in ef['styles'])} | "
               f"{ok('both' in ef['arrows'])} | {ok('none' in ef['arrows'])} | {ok(ef['curve'] > 0)} | {ok(ef['opacity'] > 0)} | {ok(ef['flow'] > 0)} | "
               f"{ok(ef['side_anchor'] > 0)} | {ok(ef['ratio_anchor'] > 0)} | {ok(ef['coord_end'] > 0)} | {ok(ef['label'] > 0)} | "
               f"{ok(tf['table'] > 0)} | {ok(tf['list'] > 0)} | {ok(tf['blockquote'] > 0)} | {ok(tf['svg_icons'] > 0)} | {ok(tf['round_nodes'] > 0)} |")
    jpgs = ['shots-jpg/' + pathlib.Path(p).stem + '.jpg' for p in v.get('shots_local', []) if (here / 'shots-jpg' / (pathlib.Path(p).stem + '.jpg')).exists()]
    if jpgs: gal.append((k, jpgs[0]))
    if (here / 'shots-jpg' / f'{k}-full.jpg').exists(): jpgs = [f'shots-jpg/{k}-full.jpg']   # 한 장으로 이어 붙인 전체 스크린샷
    links = f"[poster.html]({k}/poster.html)" + (f" · [report.md]({k}/report.md)" if (here / k / 'report.md').exists() else '')
    sections.append(f"### {names[k]}\n\n{links}\n\n{NOTES.get(k, '')}\n\n" + '\n'.join(f'<img src="{j}" width="900">' for j in jpgs) + '\n')

H1 = "| 모델 | 생각 강도 | 캔버스 | 노드 | 엣지 | 격자 점유율(%) | 최소 글자(px) | 엔진 무결 | 규약 | 문장부호 | 품질 스니펫 | 콘솔 0건 | 드래그 추종 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"
H2 = "| 모델 | 실선 | 파선 | 점선 | both | none | 곡률 | 투명도 | 흐름 | 측면 앵커 | 비율 앵커 | 좌표 끝점 | 라벨 | 표 | 목록 | 인용 | SVG 아이콘 | 원형 노드 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"
notes_md = '\n'.join(f"- **{names[k]}**: {NOTES[k]}" for k in order if NOTES.get(k) and k in S)
def gallery(prefix):
    cells = [f'<td align="center"><a href="{prefix}{k}/poster.html"><img src="{prefix}{j}" width="440"></a><br><sub>{names[k]}</sub></td>' for k, j in gal]
    trs = ''.join('<tr>' + ''.join(cells[i:i + 2]) + '</tr>' for i in range(0, len(cells), 2))
    return f'<table>{trs}</table>'

cmp_md = f"""# 모델 비교: 기능 샘플러 포스터

같은 브리프로 일곱 모델에게 html-diagram 스킬을 쓰게 하고, 산출물을 같은 하네스로 검사했습니다. 표의 브라우저 판정(품질 스니펫, 콘솔, 드래그)은 모델이 아니라 하네스가 전부 수행했습니다. `index.html`은 같은 내용에 스크린샷을 내장한 한 파일 판인데 GitHub 미리보기 한도를 넘으므로 내려받아 열어야 합니다. 이 문서가 같은 결과를 담고 있습니다.

## 브리프

- 주제: 편집 가능한 도식 엔진 기능 샘플러. 모든 노드 종류, 화살표 속성 전부, 텍스트 서식, 편집 조작과 저장 흐름을 한 장에서 각 요소가 스스로 설명. 캔버스 2개 이상, 한국어, 이모지·줄표 금지.
- 오염 방지: 같은 주제의 기존 예시(`examples/poster*.html`)는 열어보지 않도록 지시.
- Codex용 원문은 [PROMPT-codex.txt](PROMPT-codex.txt). Claude 에이전트용은 같은 내용에 브라우저 검증 지시(Aside 브라우저, 포트, 콘솔은 내장 Browser 패널)와 보고 항목이 추가된 버전.

## 조건

| 모델 | 실행 경로 | 생각 강도 | 모델 자신의 검증 |
|---|---|---|---|
| Claude Fable 5.1 | 이 저장소를 만든 세션(기준본) | max | 브라우저 검증 |
| Claude Opus 5, Sonnet 5 | Claude Code 서브에이전트 | max (세션 상속) | 브라우저 검증 |
| GPT-5.6 luna, terra, sol | Codex CLI 0.154.0 `codex exec` | xhigh (설정 기본값) | 정적 검사만(브라우저 없음) |
| GPT-5.6 astra | 사용자가 Codex CLI로 직접 실행 | xhigh | 정적 검사만(브라우저 없음) |

생각 강도는 따로 지정하지 않아 기본값이 적용됐습니다. Claude 쪽은 max, Codex 쪽은 xhigh라 조건이 완전히 같지는 않습니다.

## 결과

{H1}{chr(10).join(rows)}

O 통과 · X 실패 · 격자 점유율과 최소 글자는 캔버스별 값.

## 커버리지 (정적 분석)

{H2}{chr(10).join(cov)}

실선은 `data-style` 생략 포함. 인용은 `blockquote` 태그 기준, SVG 아이콘은 인라인 `<svg>` 기준.

## 정성 메모

{notes_md}

{CAVEAT}

## 하네스

1. `compare-static.py`: 엔진 블록 무결성, id 유일성, 화살표 참조, 줄표·이모지, 속성 커버리지 → `static.json`
2. `run-verify.py <폴더…>`: Aside 브라우저 repl로 품질 스니펫, 드래그 추종, 스크린샷 → `verify.json`, `shots/`
3. 콘솔 오류: 내장 Browser 패널의 `read_console_messages`로 확인해 `console.json`에 기록
4. `compare-report.py`: 위 결과와 스크린샷을 합쳐 `index.html` 생성. `gen-readme.py`: 같은 데이터로 이 문서와 루트 README의 결과 블록 생성

Codex 실행 시 주의: 백그라운드에서 돌리면 stdin을 닫아야 하고(`< /dev/null`), 설계안만 내고 승인을 기다리며 끝나는 모델은 `codex exec resume --skip-git-repo-check <id> "승인"`으로 이어 갑니다.

## 모델별 스크린샷

{chr(10).join(sections)}"""
(here / 'README.md').write_text(cmp_md, encoding='utf-8')

root_block = f"""<!-- RESULTS:START -->
같은 브리프로 일곱 모델이 만든 기능 샘플러 포스터를 같은 하네스로 검사한 결과입니다. 브라우저 판정(품질 스니펫, 콘솔, 드래그)은 전부 하네스가 수행했습니다. 조건, 커버리지, 전체 스크린샷은 [compare/README.md](compare/README.md)에 있습니다.

{H1}{chr(10).join(rows)}

O 통과 · X 실패 · 격자 점유율과 최소 글자는 캔버스별 값.

{notes_md}

{CAVEAT}

{gallery('compare/')}
<!-- RESULTS:END -->"""
rp = root / 'README.md'; rt = rp.read_text(encoding='utf-8')
if '<!-- RESULTS:START -->' in rt:
    rt = re.sub(r'<!-- RESULTS:START -->.*?<!-- RESULTS:END -->', lambda m: root_block, rt, flags=re.S)
else:
    m = re.search(r'## 모델 비교\n(.*?)(?=\n## )', rt, re.S); assert m, '루트 README에 "## 모델 비교" 절이 없음'
    rt = rt[:m.start()] + '## 모델 비교\n\n' + root_block + '\n' + rt[m.end():]
rp.write_text(rt, encoding='utf-8')
print('compare/README.md and root README results block written')
