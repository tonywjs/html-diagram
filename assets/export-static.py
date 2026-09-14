#!/usr/bin/env python3
"""편집 가능한 도식 HTML → 배포용 정적 HTML. 편집기(엔진·도크·히스토리)를 걷어내고 화살표와 라벨을 문서에 굽는다.
편집기 메뉴의 '배포용으로 저장'과 같은 결과를 명령줄에서 만든다. 헤드리스 Chrome(또는 Chromium)이 필요하다.
사용법: python3 export-static.py 산출.html 배포.html
배포본은 편집이 안 된다. 원본(편집 가능본)은 따로 보관한다."""
import sys, pathlib, subprocess, tempfile, html, re, shutil

CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
           '/Applications/Chromium.app/Contents/MacOS/Chromium',
           '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
           r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
           r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
           'google-chrome', 'chromium', 'chromium-browser', 'chrome', 'msedge']
HOOK = ('<script>(function(){var me=document.currentScript;window.addEventListener("load",function(){setTimeout(function(){'
        'if(me&&me.parentNode)me.parentNode.removeChild(me);'          # 훅 자신은 결과물에 남기지 않는다
        'var h=window.FigEditor.exportStatic();'
        'document.documentElement.innerHTML=\'<head><meta charset="utf-8"></head><body><pre id="fig-export"></pre></body>\';'
        'document.getElementById("fig-export").textContent=h;},400);});})();</script>')

def find_chrome():
    for c in CHROMES:
        if pathlib.Path(c).exists() or shutil.which(c): return c
    return None

def main():
    if len(sys.argv) < 3: print(__doc__); sys.exit(2)
    src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    chrome = find_chrome()
    if not chrome: sys.exit('Chrome/Chromium을 찾지 못했다. CHROMES 목록에 경로를 추가한다')
    t = src.read_text(encoding='utf-8')
    if 'fig-editor.js: 편집 가능한 HTML 도식 공용 엔진' not in t: sys.exit(f'{src}: 편집 엔진이 없는 파일이다(이미 배포본이거나 html-diagram 산출물이 아님)')
    tmp = src.with_name(src.stem + '.__export__.html')          # 같은 폴더에 두어 상대 경로 자산을 유지
    tmp.write_text(t.replace('</body>', HOOK + '</body>', 1) if '</body>' in t else t + HOOK, encoding='utf-8')
    prof = tempfile.mkdtemp(prefix='fig-export-')
    out = ''
    try:
        cmd = [chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--disable-crash-reporter',
               '--user-data-dir=' + prof, '--virtual-time-budget=6000', '--window-size=1440,900',
               '--dump-dom', 'file://' + str(tmp.resolve())]
        # Chrome은 DOM을 한 번에 출력한 뒤 자식 프로세스 때문에 종료가 늦어지므로, </html>을 읽는 즉시 끝낸다
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 text=True, encoding='utf-8', errors='replace')
        import threading; killer = threading.Timer(45, proc.kill); killer.start()
        try:
            for line in proc.stdout:
                out += line
                if '</html>' in line: break
        finally:
            killer.cancel(); proc.kill()
    finally:
        tmp.unlink(missing_ok=True); shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'<pre id="fig-export">(.*?)</pre>', out, re.S)
    if not m: sys.exit('내보내기 실패: 엔진이 실행되지 않았거나 Chrome 출력이 비어 있다')
    result = html.unescape(m.group(1))
    dst.write_text(result, encoding='utf-8')
    edges = len(re.findall(r'<g[\s>]', result)); print(f'{dst} ({dst.stat().st_size:,} bytes, 화살표 {edges}개 구움)')

if __name__ == '__main__':
    main()
