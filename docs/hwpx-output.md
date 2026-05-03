# HWPX 한글파일 생성 기능 정리

이 문서는 보고서 작성 툴에 지금까지 붙인 `.hwpx` 출력 기능을 한 번에 볼 수 있게 정리한 배포용 메모입니다. 사용자는 폼에서 `.docx`와 `.hwpx` 중 하나를 고르고, 서버는 같은 보고서 JSON을 형식에 맞는 생성기로 넘겨 파일을 만듭니다.

## 현재 지원 범위

| 보고서 | `.hwpx` 지원 | 주요 내용 |
| --- | --- | --- |
| 화학 사전보고서 | 지원 | 표지, 날짜/온도/기압, 제목 계층, 이론/기구/시약/과정, 표, 그림 placeholder, 참고 링크 |
| 화학 결과보고서 | 지원 | 사전보고서 분석 결과, 실험 데이터 표, 차트 PNG, 업로드 사진, 결과/고찰/참고문헌 |
| 물리 결과보고서 | 지원 | 학교 HWPX 템플릿 기반 결과/결론, PASCO/엑셀 데이터 표, 차트, 사진 |

UI에서는 각 보고서 폼에 출력 형식 라디오 버튼이 있고, `.hwpx` 선택 시 함초롬바탕 같은 HWPX 전용 글꼴 옵션도 열립니다.

## 처리 흐름

1. 브라우저 폼에서 `format=hwpx`를 함께 전송합니다.
2. `server.js`가 파이프라인별 `generate(..., { outputFormat: "hwpx" })`를 호출합니다.
3. 프롬프트는 HWPX 모드에서 수식을 `{{EQ:...}}` 또는 `{{EQN:...}}` 자리표시자로 만들도록 지시합니다.
4. 보고서 JSON 생성 후 `server.js`가 `generateHwpx(content)`를 호출합니다.
5. `hwpx-gen.js` 어댑터가 Node Buffer, 사진, 차트 PNG를 JSON/base64 형태로 Python에 넘깁니다.
6. `hwpx-gen.py`가 HWPX 본문, 표, 그림, 글꼴, 레이아웃을 생성합니다.
7. 수식 자리표시자는 `lib/equation/hwpx_equation_tool.py`로 실제 `<hp:equation>` 개체가 됩니다.
8. 완성 파일은 `.hwpx` 확장자와 HWPX MIME 타입으로 작업 목록/내 파일에서 다운로드됩니다.

## 핵심 파일

| 파일 | 역할 |
| --- | --- |
| `server.js` | `format` 요청값 처리, `.hwpx` 파일명/MIME/저장 처리 |
| `public/index.html` | `.docx`/`.hwpx` 선택 UI, HWPX 전용 글꼴 옵션 |
| `requirements.txt` | Render 빌드에서 설치할 `python-hwpx`, `lxml` |
| `lib/pipelines/*/generate.js` | 출력 형식별 프롬프트 지시와 JSON 후처리 |
| `lib/pipelines/*/hwpx-gen.js` | Node에서 Python HWPX 생성기를 실행하는 어댑터 |
| `lib/pipelines/chem-pre/hwpx-gen.py` | 공통에 가까운 HWPX 문단/표/글꼴/수식 helper와 화학 사전 생성 |
| `lib/pipelines/chem-result/hwpx-gen.py` | 화학 결과보고서용 표, 차트, 사진, 참고문헌 생성 |
| `lib/pipelines/phys-result/hwpx-gen.py` | 물리 결과보고서 템플릿 기반 생성 |
| `lib/pipelines/phys-result/templates/result-report-template.hwpx` | 물리 결과보고서 학교 양식 템플릿 |
| `lib/equation/hwpx_equation_tool.py` | 수식 placeholder를 HWPX 수식 개체로 변환/검증 |

## 구현된 세부 기능

- `.docx` 기본 흐름을 유지하면서 `.hwpx`를 선택할 수 있는 포맷 분기 추가
- Render `postinstall`에서 Python 가상환경을 만들고 HWPX 의존성 설치
- `PYTHON_BIN` 환경변수, 프로젝트 `.venv`, 시스템 `python3` 순서의 런타임 탐지
- 화학 사전보고서의 기본/간단 양식, A4 여백, 제목 크기, 표 머리글 색, 링크 스타일, 그림 박스 구현
- 위첨자/아래첨자 marker를 HWPX 문자 속성 또는 안전한 유니코드 문자로 변환
- `{{EQ:...}}`, `{{EQN:...}}`, `{{EQ-LATEX:...}}` 계열 수식 placeholder 변환
- 생성 이미지가 HWPX manifest에 제대로 들어가도록 `BinData` 항목 보정
- 화학 결과보고서 차트와 업로드 사진을 base64로 넘겨 HWPX 패키지에 직접 삽입
- 물리 결과보고서 학교 템플릿의 본문 박스 안에 결과/결론을 채우는 생성기 추가
- 물리 결과보고서 본문과 표 안의 `T = 2π√(L/g)` 같은 인라인 수식을 HWPX 수식 placeholder로 자동 승격
- 다운로드 파일 확장자, MIME 타입, 저장소 metadata가 출력 형식을 따라가도록 정리

## 운영 메모

- Render 빌드 명령은 그대로 `npm install`을 쓰면 됩니다. `package.json`의 `postinstall`이 Python 의존성을 준비합니다.
- `.hwpx` 생성이 실패하면 먼저 Render build log에서 `.venv` 생성과 `pip install -r requirements.txt` 성공 여부를 확인하세요.
- 한글오피스에서 글꼴 대체가 일어나면 폼의 글꼴을 바꾸거나 `lib/document-fonts.js`와 각 HWPX 생성기의 기본 글꼴을 맞춥니다.
- 수식이 본문 텍스트로 남아 있으면 `hwpx_equation_tool.py validate <file.hwpx>`로 남은 placeholder를 확인합니다.

## 남은 개선 후보

- HWPX 산출물을 자동 렌더링해서 스냅샷 비교하는 회귀 테스트
- `.docx`와 `.hwpx` 결과의 문단 수/표 수/그림 수를 비교하는 구조 검증
- 화학 결과보고서와 물리 결과보고서의 학교별 템플릿 선택 기능
- 더 복잡한 LaTeX 수식의 한컴 수식 스크립트 변환 범위 확대
