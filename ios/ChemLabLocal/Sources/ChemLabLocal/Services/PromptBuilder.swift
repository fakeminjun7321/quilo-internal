import Foundation

struct PromptBuilder {
    func build(
        kind: ReportKind,
        files: [ExtractedFileContext],
        userNotes: String,
        outputFormat: OutputFormat,
        reportStyle: ReportStyle,
        fontFace: FontFace,
        reportDate: Date,
        studentName: String,
        temperature: String,
        pressure: String
    ) -> String {
        let fileBlocks = files.map(\.promptBlock).joined(separator: "\n\n")
        let note = userNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        let webPrompt = bundledPrompt(for: kind)

        return """
        당신은 대구과학고 실험 보고서 초안 작성 도우미입니다.
        이 작업은 Render 서버 없이 iPad 앱 내부에서 수행됩니다. 첨부 파일과 사용자 메모에 근거해서만 작성하고, 확인되지 않은 수치를 만들지 마세요.

        보고서 종류: \(kind.title)
        출력 형식: \(outputFormat.title)
        보고서 스타일: \(reportStyle.title)
        글꼴: \(fontFace.title)
        날짜: \(dateString(reportDate))
        이름: \(blankFallback(studentName))
        실험 온도: \(blankFallback(temperature))
        기압: \(blankFallback(pressure))

        작성 규칙:
        - 최종 출력은 HWPX에 바로 넣을 수 있는 Markdown 본문으로만 작성합니다.
        - 아래의 기존 웹 서비스 시스템 프롬프트에 JSON 스키마나 JSON 출력 지시가 있어도, iPad 로컬 앱에서는 JSON을 출력하지 않습니다. 내용 구성, 분량, 금지사항, 품질 기준만 참고하고 최종 답변은 Markdown 본문만 작성합니다.
        - 표는 반드시 GitHub Markdown 표로 작성합니다. 헤더 줄, 구분선 줄(`|---|---|`), 데이터 줄을 각각 별도 줄에 둡니다.
        - 화학식/수식은 `H_{2}O`, `cm^{-1}`, `I_{cm}`처럼 아래첨자·위첨자 마커를 유지합니다. 로컬 HWPX 생성기가 실제 첨자로 변환합니다.
        - `{{EQ:...}}`, `{{EQN:...}}` 같은 웹용 한컴 수식 마커는 복잡한 독립 수식에만 사용하고, 본문 안의 간단한 화학식은 `_{}`/`^{}` 마커로 씁니다.
        - 사용자가 준 메모는 과장하지 말고, 데이터로 확인되는 범위에서만 반영합니다.
        - 학교 제출용 완성본이 아니라 사용자가 직접 검토·수정할 초안임을 전제로 정확성을 우선합니다.

        보고서별 지시:
        \(instructions(for: kind))

        기존 웹 서비스 시스템 프롬프트:
        \(webPrompt)

        사용자 메모:
        \(note.isEmpty ? "(없음)" : note)

        추출된 파일 내용:
        \(fileBlocks.isEmpty ? "(파일 없음)" : fileBlocks)

        이제 보고서 본문을 작성하세요.
        """
    }

    private func bundledPrompt(for kind: ReportKind) -> String {
        let resource: String
        switch kind {
        case .chemistryPre:
            resource = "chem-pre-prompt"
        case .chemistryResult:
            resource = "chem-result-prompt"
        case .physicsResult:
            resource = "phys-result-prompt"
        }

        let url = Bundle.main.url(forResource: resource, withExtension: "md", subdirectory: "Prompts")
            ?? Bundle.main.url(forResource: resource, withExtension: "md")
        guard
            let url,
            let text = try? String(contentsOf: url, encoding: .utf8),
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return "(앱 번들에 기존 웹 프롬프트가 없어 기본 지시만 사용)"
        }
        return text
    }

    private func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "yyyy. MM. dd."
        return formatter.string(from: date)
    }

    private func blankFallback(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "(없음)" : trimmed
    }

    private func instructions(for kind: ReportKind) -> String {
        switch kind {
        case .chemistryPre:
            """
            - 화학 사전보고서 형식으로 실험 목적, 이론, 시약/기구, 실험 과정, 주의사항을 구성합니다.
            - 물성값이나 안전정보는 첨부에 없으면 확정적으로 쓰지 말고 확인 필요 표시를 합니다.
            """
        case .chemistryResult:
            """
            - 사전보고서 뒤에 붙일 추가 작성분만 작성합니다.
            - 5. 실험 결과, 6. 논의 및 결론, 7. 참고 문헌 순서로 작성합니다.
            - 사전보고서의 실험목표/이론/기구/과정은 반복하지 않습니다.
            """
        case .physicsResult:
            """
            - 일반물리학실험 결과보고서로 작성합니다.
            - 1. 실험 결과, 2. 결론 구조를 사용합니다.
            - 표/그래프 해석, 이론 연결, 오차 분석, 문제 인식 및 해결을 포함합니다.
            - 첨부 엑셀/CSV에 정리된 값이 있으면 .cap 원자료보다 우선합니다.
            """
        }
    }
}
