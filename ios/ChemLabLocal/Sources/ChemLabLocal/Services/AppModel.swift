import Foundation
import Observation
import UniformTypeIdentifiers

@MainActor
@Observable
final class AppModel {
    var selectedKind: ReportKind = .physicsResult
    var outputFormat: OutputFormat = .hwpx
    var reportStyle: ReportStyle = .standard
    var fontFace: FontFace = .malgunGothic
    var importedFiles: [ImportedDocument] = []
    var userNotes = ""
    var reportDate = Date()
    var studentName = ""
    var temperature = ""
    var pressure = ""
    var policyAccepted = false
    var feedbackCategory = "버그 제보"
    var feedbackText = ""
    var apiKey = ""
    var modelName = "claude-opus-4-7"
    var isGenerating = false
    var logs: [GenerationLog] = []
    var generatedReport: GeneratedReport?
    var errorMessage: String?

    private let keychain = KeychainStore(service: "ChemLabLocal")

    init() {
        apiKey = keychain.read(key: "anthropic-api-key") ?? ""
    }

    func saveAPIKey() {
        keychain.write(apiKey, key: "anthropic-api-key")
        appendLog("API 키를 기기에 저장했습니다.")
    }

    func importFiles(_ urls: [URL], role: ImportedFileRole = .general) {
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer {
                if scoped { url.stopAccessingSecurityScopedResource() }
            }
            do {
                let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let dest = docs.appendingPathComponent(uniqueFilename(for: url.lastPathComponent))
                if FileManager.default.fileExists(atPath: dest.path) {
                    try FileManager.default.removeItem(at: dest)
                }
                try FileManager.default.copyItem(at: url, to: dest)
                let values = try dest.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
                let type = ImportedDocumentType.detect(url: dest, contentType: values.contentType)
                importedFiles.append(
                    ImportedDocument(
                        url: dest,
                        filename: dest.lastPathComponent,
                        sizeBytes: Int64(values.fileSize ?? 0),
                        type: type,
                        role: role
                    )
                )
            } catch {
                errorMessage = "파일 가져오기 실패: \(error.localizedDescription)"
            }
        }
    }

    func removeFiles(at offsets: IndexSet) {
        for index in offsets {
            try? FileManager.default.removeItem(at: importedFiles[index].url)
        }
        for index in offsets.sorted(by: >) {
            importedFiles.remove(at: index)
        }
    }

    func removeFile(_ file: ImportedDocument) {
        try? FileManager.default.removeItem(at: file.url)
        importedFiles.removeAll { $0.id == file.id }
    }

    func files(for role: ImportedFileRole) -> [ImportedDocument] {
        importedFiles.filter { $0.role == role }
    }

    func generate() {
        guard !isGenerating else { return }

        if let validationError = validateBeforeGenerate() {
            errorMessage = validationError
            return
        }

        isGenerating = true
        generatedReport = nil
        errorMessage = nil
        logs.removeAll()
        appendLog("작업 시작: \(selectedKind.title)")

        Task {
            do {
                let extractor = LocalFileExtractor()
                appendLog("파일 분석 중...")
                let contexts = try importedFiles.map { try extractor.extract($0) }

                appendLog("프롬프트 구성 중...")
                let prompt = PromptBuilder().build(
                    kind: selectedKind,
                    files: contexts,
                    userNotes: userNotes,
                    outputFormat: outputFormat,
                    reportStyle: reportStyle,
                    fontFace: fontFace,
                    reportDate: reportDate,
                    studentName: studentName,
                    temperature: temperature,
                    pressure: pressure
                )

                appendLog("Claude API 직접 호출 중...")
                let client = AnthropicClient(apiKey: apiKey, model: modelName)
                let generatedText = try await client.generateReport(
                    prompt: prompt,
                    attachments: contexts
                )

                appendLog("\(outputFormat.title) 파일 로컬 생성 중...")
                let output: URL
                switch outputFormat {
                case .hwpx:
                    output = try HWPXExporter().writeReport(
                        title: selectedKind.outputTitle,
                        bodyMarkdown: generatedText,
                        fontFace: fontFace
                    )
                case .docx:
                    output = try DOCXExporter().writeReport(
                        title: selectedKind.outputTitle,
                        bodyMarkdown: generatedText,
                        fontFace: fontFace
                    )
                }
                generatedReport = GeneratedReport(url: output, title: output.lastPathComponent)
                appendLog("완료: \(output.lastPathComponent)")
            } catch {
                errorMessage = error.localizedDescription
                appendLog("오류: \(error.localizedDescription)")
            }
            isGenerating = false
        }
    }

    func appendLog(_ message: String) {
        logs.append(GenerationLog(message: message))
    }

    func resetFeedback() {
        feedbackCategory = "버그 제보"
        feedbackText = ""
        appendLog("건의사항 입력을 비웠습니다.")
    }

    private func validateBeforeGenerate() -> String? {
        if apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Anthropic API 키를 먼저 입력하세요."
        }
        if !policyAccepted {
            return "AI 사용 규정 확인 체크가 필요합니다."
        }

        switch selectedKind {
        case .chemistryPre:
            let hasManual = importedFiles.contains { $0.role == .manual || ($0.role == .general && $0.type == .pdf) }
            if !hasManual {
                return "화학 사전보고서는 실험 매뉴얼 PDF가 필요합니다."
            }
        case .chemistryResult:
            let hasPreReport = importedFiles.contains {
                $0.role == .preReport || ($0.role == .general && [.pdf, .docx, .hwpx].contains($0.type))
            }
            if !hasPreReport {
                return "화학 결과보고서는 기존 사전보고서 PDF/DOCX/HWPX가 필요합니다."
            }
        case .physicsResult:
            let hasPhysicsInput = importedFiles.contains {
                [.cap, .data, .photos].contains($0.role)
                    || ($0.role == .general && [.cap, .xlsx, .csv, .text, .image].contains($0.type))
            }
            if !hasPhysicsInput {
                return "물리 결과보고서는 .cap, 엑셀/CSV/텍스트 데이터, 사진/스크린샷 중 하나가 필요합니다."
            }
        }

        if importedFiles.isEmpty && userNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "파일 또는 사용자 메모가 필요합니다."
        }
        return nil
    }

    private func uniqueFilename(for filename: String) -> String {
        let base = URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent
        let ext = URL(fileURLWithPath: filename).pathExtension
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        return ext.isEmpty ? "\(base)-\(suffix)" : "\(base)-\(suffix).\(ext)"
    }
}
