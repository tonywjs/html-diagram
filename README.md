# html-diagram

편집 가능한 HTML 도식을 만드는 Claude Code 스킬입니다. **문서 자체가 에디터**입니다. 산출물은 외부 의존이 없는 HTML 한 파일이고, 보기 모드에서는 완전히 정적이며 편집 모드(⌘E)에서는 도형을 끌어 옮기고 글자를 고치고 같은 파일에 저장할 수 있습니다.

<p><img src="compare/shots-preview.jpg" alt="기능 샘플러 포스터" width="720"></p>

## 무엇을 해 주나

- **편집 모드**: 노드 드래그·리사이즈·복제(⌘D, ⌥드래그)·복사/잘라내기/붙여넣기(다른 문서로도)·삭제·생성, 화살표 끝점·곡률·라벨 편집, 속성 패널(색·테두리·둥글기·투명도·그림자·z순서), undo/redo(50단계).
- **저장**: 같은 파일 덮어쓰기(File System Access API, 크로미움), 직전 버전 히스토리 30개를 문서 안에 보관, 편집 0.7초 뒤 자동저장과 복구 배너. 미지원 브라우저는 다운로드로 저장.
- **텍스트**: 더블클릭하면 리치 서식 툴바(단락 스타일·글씨체·크기 단계·굵게/기울임/밑줄/취소선·글자색/배경·정렬·목록·들여쓰기·표).
- **화살표**: 노드를 옮기면 자동 추종. 실선/파선/점선, 화살촉 end/both/none, 곡률, 투명도, 흐름 애니메이션, 측면·비율 앵커, 좌표 끝점, 라벨.

## 설치

```bash
git clone https://github.com/tonywjs/html-diagram.git ~/.claude/skills/html-diagram
```

Claude Code는 `SKILL.md`의 description을 보고 도식·인포그래픽 요청에 이 스킬을 자동으로 씁니다. `/html-diagram`으로 직접 부를 수도 있습니다.

## 구조

| 경로 | 역할 |
|---|---|
| `SKILL.md` | 에이전트용 규약, 생성 워크플로, 검증 절차, 체크리스트 |
| `assets/fig-editor.js`, `assets/fig-editor.css` | 편집 엔진(문서에 인라인됨) |
| `assets/template.html` | 산출물의 출발점. 복사한 뒤 `<title>`, 첫 `<style>`, `FIG:CONTENT` 영역만 작성 |
| `assets/template-skeleton.html`, `assets/build-template.py` | 엔진을 인라인해 템플릿과 예시를 조립 |
| `assets/quality-check.js` | 품질 검사(글자 하한 12px, 격자 점유율 75%) |
| `assets/tests/` | 엔진 회귀 테스트(`run.sh`, Aside 브라우저 CLI 필요) |
| `examples/` | `demo`(최소 구성), `poster`(기능 샘플러), `drug-pipeline`(밀도 높은 카드). `*-src.html`이 원본, `.html`이 실행본 |
| `compare/` | 같은 브리프로 여섯 모델이 만든 포스터 비교 |

## 문서 규약 요약

```html
<div class="fig-canvas" data-size="1200x860">
  <div class="fig-node" id="a" style="left:40px;top:60px;width:180px">…자유 HTML…</div>
  <div class="fig-edge" data-from="a" data-to="b" data-style="dashed" data-curve="0.2" data-label="전송"></div>
</div>
```

노드는 유일한 id와 인라인 `left/top/width`, 화살표는 노드 id 또는 `"x,y"` 좌표를 가리키는 빈 div입니다. 나머지 디자인은 자유입니다. 자세한 규칙과 품질 기준은 [SKILL.md](SKILL.md)에 있습니다.

## 검증

산출물마다 브라우저에서 세 가지를 확인합니다: 콘솔 오류·경고 0, `assets/quality-check.js`가 `pass:true`, 편집 모드에서 노드를 끌면 화살표가 따라옴. 엔진을 고쳤을 때는 `python3 assets/build-template.py`로 템플릿과 예시를 재생성하고 `bash assets/tests/run.sh`로 회귀 테스트를 돌립니다.

## 모델 비교

[compare/index.html](compare/index.html)은 같은 브리프로 Claude Fable 5.1, Opus 5, Sonnet 5, GPT-5.6 luna·terra·sol이 만든 기능 샘플러 포스터를 같은 하네스로 검사한 결과입니다. 스크린샷이 내장돼 있어 내려받아 열면 됩니다. 조건과 절차는 [compare/README.md](compare/README.md)에 있습니다.

## 라이선스

미정입니다. 공개 전에 정합니다.
