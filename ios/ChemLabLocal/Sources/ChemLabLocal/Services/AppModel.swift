import Foundation
import Observation
import UniformTypeIdentifiers

@MainActor
@Observable
final class AppModel {
    var selectedKind: ReportKind = .physicsResult
    var outputFormat: OutputFormat = .hwpx
    var importedFiles: [ImportedDocument] = []
    var userNotes = ""
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

    func importFiles(_ urls: [URL]) {
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
                        type: type
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

    func generate() {
        guard !isGenerating else { return }
        guard !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Anthropic API 키를 먼저 입력하세요."
            return
        }
        guard !importedFiles.isEmpty || !userNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "파일 또는 사용자 메모가 필요합니다."
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
                    userNotes: userNotes
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
                        bodyMarkdown: generatedText
                    )
                case .docx:
                    output = try DOCXExporter().writeReport(
                        title: selectedKind.outputTitle,
                        bodyMarkdown: generatedText
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

    private func uniqueFilename(for filename: String) -> String {
        let base = URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent
        let ext = URL(fileURLWithPath: filename).pathExtension
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        return ext.isEmpty ? "\(base)-\(suffix)" : "\(base)-\(suffix).\(ext)"
    }
}
