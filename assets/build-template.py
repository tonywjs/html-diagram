#!/usr/bin/env python3
"""template-skeleton.html + fig-editor.css/js → template.html 조립.
examples/*-src.html → examples/*.html 도 함께 조립한다(예시는 항상 최신 엔진).
엔진(css/js)을 고친 뒤 실행한다. html-deck도 같은 엔진을 인라인하므로 이어서
  python3 ../html-deck/assets/build-template.py
를 실행해 그쪽 템플릿도 갱신한다.
사용법:
  python3 build-template.py                    # 템플릿 + examples 전부
  python3 build-template.py 소스.html 산출.html   # 임의 소스 조립
"""
import pathlib, sys
d = pathlib.Path(__file__).parent
css = (d / 'fig-editor.css').read_text(encoding='utf-8')
js = (d / 'fig-editor.js').read_text(encoding='utf-8')

def build(src, out):
    html = src.read_text(encoding='utf-8')
    assert '/*__FIG_EDITOR_CSS__*/' in html and '/*__FIG_EDITOR_JS__*/' in html, f'{src.name}: 엔진 플레이스홀더가 없음'
    out.write_text(html.replace('/*__FIG_EDITOR_CSS__*/', css).replace('/*__FIG_EDITOR_JS__*/', js), encoding='utf-8')
    print(f"{out} ({out.stat().st_size:,} bytes)")

if len(sys.argv) > 2:
    build(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
else:
    build(d / 'template-skeleton.html', d / 'template.html')
    for src in sorted((d.parent / 'examples').glob('*-src.html')):
        build(src, src.with_name(src.name[:-len('-src.html')] + '.html'))
