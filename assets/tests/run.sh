#!/bin/bash
# fig-editor 엔진 회귀 테스트: 픽스처를 임시 폴더에 조립 → 로컬 HTTP → Aside repl로 실행 (Aside는 file:// 을 열지 못함)
set -e
D="$(cd "$(dirname "$0")" && pwd)"; A="$D/.."; T="$(mktemp -d)"; PORT=${PORT:-8765}
python3 "$A/build-template.py" >/dev/null
cp "$A/template.html" "$T/template-copy.html"
cp "$A/../examples/demo.html" "$T/demo-built.html"
python3 "$A/build-template.py" "$D/test-edges-src.html" "$T/test-edges.html" >/dev/null
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$T" >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$T"' EXIT
sleep 1
aside repl "$(cat "$D/engine-tests.js")"
