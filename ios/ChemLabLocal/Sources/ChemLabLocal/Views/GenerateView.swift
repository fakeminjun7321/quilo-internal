import SwiftUI

struct GenerateView: View {
    @Bindable var model: AppModel
    @Binding var showingImporter: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    reportPicker
                    filesSection
                    notesSection
                    outputSection
                    actionSection
                    logSection
                }
                .padding(24)
                .frame(maxWidth: 980, alignment: .leading)
            }
            .navigationTitle("보고서 생성")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingImporter = true
                    } label: {
                        Label("파일 추가", systemImage: "plus")
                    }
                }
            }
        }
    }

    private var reportPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("보고서 종류")
                .font(.headline)
            Picker("보고서 종류", selection: $model.selectedKind) {
                ForEach(ReportKind.allCases) { kind in
                    Text(kind.title).tag(kind)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private var filesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("입력 파일")
                    .font(.headline)
                Spacer()
                Button {
                    showingImporter = true
                } label: {
                    Label("추가", systemImage: "doc.badge.plus")
                }
            }

            if model.importedFiles.isEmpty {
                ContentUnavailableView("파일 없음", systemImage: "folder", description: Text("PDF, HWPX, DOCX, XLSX, CSV, CAP, 이미지 파일을 추가하세요."))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
            } else {
                List {
                    ForEach(model.importedFiles) { file in
                        HStack {
                            Image(systemName: icon(for: file.type))
                                .foregroundStyle(.blue)
                            VStack(alignment: .leading) {
                                Text(file.filename)
                                    .font(.body)
                                Text("\(file.type.rawValue) · \(file.sizeLabel)")
                                    .foregroundStyle(.secondary)
                                    .font(.caption)
                            }
                        }
                    }
                    .onDelete(perform: model.removeFiles)
                }
                .frame(minHeight: 160)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private var notesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("AI 참고 메모 / 내 의견")
                .font(.headline)
            TextEditor(text: $model.userNotes)
                .frame(minHeight: 140)
                .padding(8)
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(.quaternary)
                }
        }
    }

    private var outputSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("출력 형식")
                .font(.headline)
            Picker("출력 형식", selection: $model.outputFormat) {
                ForEach(OutputFormat.allCases) { format in
                    Text(format.title).tag(format)
                }
            }
            .pickerStyle(.segmented)
            Text(model.outputFormat == .hwpx ? "한글에서 열 수 있는 HWPX로 저장합니다." : "Word/Pages에서 열 수 있는 DOCX로 저장합니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var actionSection: some View {
        HStack(spacing: 12) {
            Button {
                model.generate()
            } label: {
                Label(model.isGenerating ? "생성 중" : "로컬 생성", systemImage: "wand.and.sparkles")
                    .frame(minWidth: 150)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isGenerating || model.isTestingAPI)

            if let report = model.generatedReport {
                ShareLink(item: report.url) {
                    Label("내보내기", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.bordered)

                Text(report.title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var logSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("진행 로그")
                .font(.headline)
            VStack(alignment: .leading, spacing: 6) {
                if model.logs.isEmpty {
                    Text("아직 작업 없음")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.logs) { log in
                        Text("• \(log.message)")
                            .font(.callout)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func icon(for type: ImportedDocumentType) -> String {
        switch type {
        case .pdf: "doc.richtext"
        case .hwpx, .docx: "doc.text"
        case .xlsx, .xls, .csv: "tablecells"
        case .cap: "waveform.path.ecg"
        case .image: "photo"
        case .text: "text.alignleft"
        case .other: "doc"
        }
    }
}
