---
name: html-diagram
description: Use when 도식·다이어그램·인포그래픽·구조도·개념도·흐름도를 HTML로 만들 때, 사용자가 "편집 가능한 그림"(글자 수정, 박스 이동·복제, 화살표 조정)을 원할 때, 또는 그림·도식을 그려달라는 요청 전반. PPT 품질에 불만이 있거나 SVG 정적 이미지 대신 후보정 가능한 산출물이 필요한 경우 포함.
---

# html-diagram: 편집 가능한 HTML 도식

**문서 자체가 에디터다.** 아래 규약대로 만들면 문서에 인라인된 엔진이 보기 모드(기본, 완전 정적)와 편집 모드(⌘E)를 제공한다: 도형 드래그·복제·복사/붙여넣기(다른 문서로도)·삭제·생성, 화살표 끝점·곡률·라벨 편집, 속성 패널, undo, 같은 파일 저장(⌘S)+히스토리+자동저장, 더블클릭 리치 서식 툴바, 편집기를 걷어낸 배포용 저장. 전체 기능은 `examples/poster-src.html` 한 장이 보여 준다.

## 생성 워크플로

1. **내용을 먼저 목록화**하고 밀도에 맞춰 캔버스 크기를 정한다. 캔버스에 내용을 흩뿌리지 않는다.
2. `assets/template.html`을 산출 경로에 **복사**한다. 엔진 코드(두 번째 `<style>`과 `<script>`)는 절대 수정·요약하지 않는다.
3. 작성하는 곳은 셋뿐이다: `<title>`(기본값 "도식"을 반드시 교체), head의 첫 `<style>`(문서 스타일), `FIG:CONTENT` 영역(캔버스 + 노드/엣지).
4. 브라우저에서 검증한다: ① 콘솔 오류·경고 0 ② 품질 스니펫 `pass:true` ③ 편집 모드에서 노드를 끌면 화살표가 따라옴.
5. 검증 통과 전에는 완성으로 선언하지 않는다.
6. 배포본이 필요하면 편집기 메뉴(⋯)의 **배포용으로 저장** 또는 `python3 <스킬 폴더>/assets/export-static.py 산출.html 배포.html`(헤드리스 Chrome 필요)로 엔진을 걷어낸 정적 HTML을 따로 만든다. 배포본은 화살표가 구워져 어디서나 보이지만 편집은 안 되므로 원본을 함께 보관한다.

**검증 방법.** Aside 브라우저는 file:// 을 열지 못하므로 산출 폴더를 로컬 HTTP로 띄운 뒤 `http://127.0.0.1:8765/파일.html`로 연다(포트가 사용 중이면 다른 포트). 스니펫은 Aside repl의 `page.evaluate`, 내장 Browser의 `javascript_tool`, 또는 콘솔에서 실행한다. 콘솔 오류·경고는 Aside repl이 캡처하지 못하므로 내장 Browser 패널의 `read_console_messages`로 확인한다(폴백 사유를 한 줄로 알릴 것). 드래그 검증은 `FigEditor.setEdit(true)` 후 노드 중앙을 마우스로 끌어 연결된 `.fig-edge` 요소의 `_geom.p0/p1`이 바뀌는지 보고 `FigEditor.setEdit(false)`로 돌아온다. 끝점을 못 찾은 엣지는 `_warned`가 true다. 브라우저 도구가 없는 환경(Codex CLI 등)에서는 `python3 <스킬 폴더>/assets/static-check.py 산출.html`로 정적 검사까지만 하고, 브라우저 검증은 수행하지 못했다고 보고한다.

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory <산출 폴더>
```

**예시.** `*-src.html`이 읽기용 원본이고 같은 이름의 `.html`은 엔진을 인라인한 실행본이다(`assets/build-template.py`가 함께 재생성).
- `examples/demo-src.html`: 최소 구성(노드 11·엣지 4·라벨·혼합형 끝점). 디자인 수준의 기준.
- `examples/poster-src.html`: 모든 노드 종류·화살표 속성·서식·조작을 한 장에 담은 기능 샘플러(캔버스 2개).
- `examples/drug-pipeline-src.html`: 밀도 높은 다단 카드 배치.

## 규약 (이것만 지키면 나머지 디자인은 자유)

```html
<div class="fig-canvas" data-size="1200x860" style="margin:0 auto">

  <div class="fig-node inst" id="n-hospital" style="left:0px; top:36px; width:158px; height:60px">
    …내부 HTML 완전 자유 (아이콘 SVG, 그라디언트, 다단 구조)…
  </div>

  <!-- 연결 화살표: 노드를 옮기면 자동 추종 -->
  <div class="fig-edge" data-from="n-hospital" data-to="n-hub"
       data-style="dashed" data-color="#2563eb" data-width="2"
       data-curve="0.16" data-arrow="end" data-label="가중치 전송"></div>

  <!-- 좌표 끝점(자유형·혼합형): "x,y" -->
  <div class="fig-edge" data-from="n-hub" data-to="196,320" data-anchor-from="bottom"
       data-color="#0e7490" data-arrow="end"></div>
</div>
```

| 항목 | 규칙 |
|---|---|
| `.fig-canvas` | `data-size="WxH"` 필수. 고정 픽셀 좌표계(표시 축소는 엔진이 처리). 한 문서에 여러 캔버스 가능, 캔버스 사이 화살표는 불가 |
| `.fig-node` | `id` 필수(전 문서 유일), 인라인 style로 `left/top/width` 필수. `height`는 선택이지만 **화살표가 붙는 노드는 지정한다**(글꼴 환경이 달라도 끝점이 같은 자리에 오도록). 배포본 내보내기 때 미지정 높이는 그 시점 값으로 굳는다. 내부 HTML 자유 |
| 투명 노드 | 라벨·캡션·섹션 제목도 노드로: `background:transparent;border:none` |
| `.fig-edge` | 빈 div. `data-from`/`data-to` = **노드 id 또는 "x,y"**. 없는 id를 가리키면 표시되지 않고 콘솔 경고가 난다. 옵션: `data-style`(solid\|dashed\|dotted), `data-width`, `data-color`(hex, rgb, CSS 변수 모두 가능), `data-curve`(-1~1, 양수는 진행 방향 기준 오른쪽으로 휨. 가로 화살표면 아래), `data-arrow`(end\|both\|none), `data-label`(곡선 중앙에 놓임), `data-opacity`(0~1), `data-anchor-from/to`(auto\|top\|bottom\|left\|right\|**"fx,fy" 0~1 비율 고정점**), `data-flow="on"`(움직이는 점선 흐름 애니메이션) |
| 양방향 화살표 | 같은 두 노드 사이에 왕복 화살표를 둘 땐 반드시 **앵커를 다르게** 지정한다(auto 둘이면 같은 점에 겹침). 곡률은 진행 방향 기준이므로 왕복 두 화살표에 **같은 부호**를 주면 서로 반대쪽으로 휜다. 예: 전송 `data-anchor-to="0.3,1"` / 배포 `data-anchor-from="0.7,1"` + 같은 곡률 값 |
| 캔버스 밖 | 제목 등 일반 HTML 가능. 글자 편집만 되고 이동은 안 됨. 도형·움직일 요소는 반드시 캔버스 안에 |
| 금지 | 노드 위치를 CSS 클래스로만 지정(복제·붙여넣기 오프셋이 인라인 값 기준이라 복사본이 모서리로 튐), `.fig-edges` SVG 직접 작성(엔진 생성물), id 중복 |

## 타이포그래피·공간 (하한 미만 금지)

| 용도 | 크기 (폭 1200px 기준, 비례 환산) |
|---|---|
| 큰 제목 | 30~40px |
| 섹션·카드 제목 | 16~20px |
| 본문·설명 | **14px 권장, 하한 13px** |
| 캡션·각주·라벨 | **하한 12px** |

- 망설여지면 한 단계 키운다. 줄간격 1.35~1.6.
- **격자 점유율 75% 이상**: 캔버스를 40px 칸으로 나눴을 때 노드나 화살표가 지나는 칸의 비율. 빈 공간이 남으면 글자·요소를 **키우거나** 캔버스를 **줄인다**. 노드가 적은 작은 도식은 노드를 그만큼 크게 만든다. 요소를 흩어 놓지 않는다.
- 여백 스케일: 캔버스 패딩 32~48 / 그룹 간 24~40 / 관련 요소 간 10~20 / 카드 내부 12~18px.

**품질 스니펫.** `assets/quality-check.js`를 읽어 브라우저에서 실행하고 반환 JSON이 `pass:true`가 될 때까지 고친다. 글자 크기는 설계 폭 기준 로컬 px로 판정하고, 창이 좁아 캔버스가 축소된 정도는 `scale`로 보고만 한다(보는 쪽 사정이므로). 캔버스별로 판정하며 하나라도 실패하면 `pass:false`.

## 디자인 지침

- 목표 수준: 전문 디자이너가 만든 인포그래픽(`examples/demo-src.html` 참조). 나열형 카드 그리드보다 **핵심 원리를 그림으로 먼저** 보여주는 구성을 우선한다.
- 색은 3계열 이내(주색 + 보조 + 경고/과제색), CSS 변수로 선언. 폰트는 Pretendard(웹폰트 실패 대비 시스템 폴백 필수).
- 아이콘은 인라인 SVG(stroke 1.7, currentColor 또는 변수색). 이모지 금지(배포 문서 톤).
- 화살표 라벨은 `data-label`로(별도 노드 아님. 선을 옮기면 따라가야 하므로). 라벨이 있는 짧은 화살표는 라벨이 노드를 덮으니 길이를 확보한다.
- 겹치는 노드는 z순서 고려(뒤 배경판 노드 → 앞 내용 노드 순서로 DOM 배치).

## 문장 부호

- **줄표(`—`) 금지.** 문서 어디에도 em dash(`—`)·en dash(`–`)를 쓰지 않는다. 쉼표·콜론·괄호로 바꾸거나 문장을 나눈다.
  예: `A — B` → `A: B` / `A(B)` / `A. B`

## 체크리스트 (산출 전 확인)

- [ ] `<title>` 교체됨(템플릿 기본값 "도식"이 남아 있지 않음)
- [ ] 본문에 줄표(`—`) 0개
- [ ] 모든 `.fig-node`에 유일 id + 인라인 left/top/width
- [ ] 모든 `.fig-edge`의 from/to가 실존 노드 id 또는 "x,y" (아니면 콘솔 경고)
- [ ] `data-size`가 실제 콘텐츠 범위와 정합(하단·우측 빈 띠 없음)
- [ ] 콘솔 오류·경고 0, 품질 스니펫 `pass:true`
- [ ] 편집 모드 실동작: 노드 드래그 → 화살표 추종
- [ ] 보기 모드로 저장된 상태(`fig-editing`·`fig-selected`·`contenteditable` 흔적 없음)

## 엔진 유지보수 (스킬 관리자용)

`assets/fig-editor.js`·`fig-editor.css`를 고쳤으면 `python3 assets/build-template.py`로 템플릿과 예시를 재생성하고, 같은 엔진을 인라인하는 html-deck도 `python3 ../html-deck/assets/build-template.py`로 갱신한다. 회귀 테스트는 `bash assets/tests/run.sh`(픽스처 조립 → 로컬 HTTP → Aside repl 실행, 전부 pass여야 한다).
