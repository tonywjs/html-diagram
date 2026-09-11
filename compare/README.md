# 모델 비교: 기능 샘플러 포스터

같은 브리프로 여러 모델에게 html-diagram 스킬을 쓰게 하고, 산출물을 같은 하네스로 검사했습니다. 결과는 [index.html](index.html)에 있습니다(스크린샷 내장).

## 브리프

- 주제: 편집 가능한 도식 엔진 기능 샘플러. 모든 노드 종류, 화살표 속성 전부, 텍스트 서식, 편집 조작과 저장 흐름을 한 장에서 각 요소가 스스로 설명. 캔버스 2개 이상, 한국어, 이모지·줄표 금지.
- 오염 방지: 같은 주제의 기존 예시(`examples/poster*.html`)는 열어보지 않도록 지시.
- Codex용 원문은 [PROMPT-codex.txt](PROMPT-codex.txt). Claude 에이전트용은 같은 내용에 브라우저 검증 지시(Aside 브라우저, 포트, 콘솔은 내장 Browser 패널)와 보고 항목이 추가된 버전.

## 조건

| 모델 | 실행 경로 | 생각 강도 | 검증 |
|---|---|---|---|
| Claude Fable 5.1 | 이 저장소를 만든 세션(기준본) | max | 브라우저 검증 |
| Claude Opus 5, Sonnet 5 | Claude Code 서브에이전트 | max (세션 상속) | 브라우저 검증 |
| GPT-5.6 luna, terra, sol | Codex CLI 0.154.0 `codex exec` | xhigh (설정 기본값) | 정적 검사만(브라우저 없음) |
| GPT-5.6 astra | 사용자가 Codex CLI로 직접 실행 | xhigh | 정적 검사만(브라우저 없음) |

표의 브라우저 판정(품질 스니펫, 콘솔, 드래그)은 모델이 아니라 하네스가 전부 수행했습니다.

## 하네스

1. `compare-static.py`: 엔진 블록 무결성, id 유일성, 화살표 참조, 줄표·이모지, 속성 커버리지 → `static.json`
2. `run-verify.py <폴더…>`: Aside 브라우저 repl로 품질 스니펫, 드래그 추종, 스크린샷 → `verify.json`, `shots/`
3. 콘솔 오류: 내장 Browser 패널의 `read_console_messages`로 확인해 `console.json`에 기록
4. `compare-report.py`: 위 결과와 스크린샷을 합쳐 `index.html` 생성

Codex 실행 시 주의: 백그라운드에서 돌리면 stdin을 닫아야 하고(`< /dev/null`), 설계안만 내고 승인을 기다리며 끝나는 모델은 `codex exec resume --skip-git-repo-check <id> "승인"`으로 이어 갑니다.

## 폴더

각 모델 폴더에 `poster.html`(산출물)과 `report.md`(모델 자신의 완료 보고)가 있습니다.
