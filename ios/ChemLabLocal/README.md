# 보고서 작성툴

Render 서버 없이 iPad 안에서 보고서 초안을 생성하는 네이티브 SwiftUI 앱입니다.

## 실행

1. `ios/ChemLabLocal/ChemLabLocal.xcodeproj`를 Xcode로 엽니다.
2. iPad 시뮬레이터 또는 실제 iPad를 선택합니다.
3. 실제 iPad에 설치할 때는 Xcode의 Signing & Capabilities에서 본인 Apple Developer Team을 선택합니다.
4. 앱의 `설정` 탭에서 Anthropic API 키를 입력하고 저장합니다.

## 현재 지원

- 보고서 종류: 화학 사전보고서, 화학 결과보고서, 물리 결과보고서
- 입력 파일: PDF, HWPX, DOCX, XLSX, CSV, CAP, 이미지, TXT/MD
- 출력 파일: HWPX, DOCX
- API 키 저장: iPad Keychain
- 서버 사용: 없음

## 구현 메모

- PDF와 이미지는 Claude API에 직접 첨부합니다.
- 5MB를 넘는 이미지는 앱에서 자동으로 JPEG 압축/축소한 뒤 전송합니다.
- XLSX/HWPX/DOCX/CAP은 앱 내부에서 ZIP/XML 기반 텍스트 추출을 수행합니다.
- CAP 파일이 ZIP 구조가 아닐 경우 바이너리 안의 읽을 수 있는 문자열을 fallback으로 추출합니다.
- HWPX 출력은 번들된 물리 결과보고서 양식 HWPX를 기반으로 본문을 추가합니다.

## 남은 고도화 후보

- 서버 버전의 정교한 수식 객체 변환을 Swift로 이식
- CAP 데이터셋을 그래프/표 구조로 더 깊게 복원
- 생성 결과를 앱 안에서 미리보기
- 과목별 전용 HWPX 템플릿 분리
