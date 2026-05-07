import SwiftUI
import UniformTypeIdentifiers
import UIKit

private enum LocalAppTab: String, CaseIterable, Identifiable {
    case reports
    case files
    case feedback
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .reports: "보고서 작성"
        case .files: "내 파일"
        case .feedback: "건의사항"
        case .settings: "개인 설정"
        }
    }

    var icon: String {
        switch self {
        case .reports: "doc.text.fill"
        case .files: "folder.fill"
        case .feedback: "bubble.left.and.bubble.right.fill"
        case .settings: "gearshape.fill"
        }
    }
}

private struct FileRequest: Identifiable {
    let role: ImportedFileRole
    let title: String
    let subtitle: String
    let required: Bool
    let allowsMultiple: Bool

    var id: ImportedFileRole { role }
}

struct LocalReportToolView: View {
    @Bindable var model: AppModel
    @State private var selectedTab: LocalAppTab = .reports
    @State private var activeImportRole: ImportedFileRole?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    tabPicker

                    switch selectedTab {
                    case .reports:
                        reportsPanel
                    case .files:
                        filesPanel
                    case .feedback:
                        feedbackPanel
                    case .settings:
                        settingsPanel
                    }
                }
                .padding(24)
                .frame(maxWidth: 1180, alignment: .leading)
            }
            .background(Color(.systemGroupedBackground))
            .navigationBarTitleDisplayMode(.inline)
            .fileImporter(
                isPresented: Binding(
                    get: { activeImportRole != nil },
                    set: { if !$0 { activeImportRole = nil } }
                ),
                allowedContentTypes: allowedContentTypes(for: activeImportRole ?? .general),
                allowsMultipleSelection: allowsMultiple(for: activeImportRole ?? .general)
            ) { result in
                let role = activeImportRole ?? .general
                activeImportRole = nil
                switch result {
                case .success(let urls):
                    model.importFiles(urls, role: role)
                case .failure(let error):
                    model.errorMessage = "파일 선택 실패: \(error.localizedDescription)"
                }
            }
            .alert("오류", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
                Button("확인", role: .cancel) {}
            } message: {
                Text(model.errorMessage ?? "")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("보고서 작성 툴")
                .font(.system(size: 38, weight: .heavy))

            Text("로컬 iPad 앱입니다. 파일 파싱, 프롬프트 구성, Claude API 호출, DOCX/HWPX 생성이 기기 안에서 실행되고 Render 서버를 거치지 않습니다.")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.primary)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.blue.opacity(0.18))
                }
        }
    }

    private var tabPicker: some View {
        Picker("화면 전환", selection: $selectedTab) {
            ForEach(LocalAppTab.allCases) { tab in
                Label(tab.title, systemImage: tab.icon).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 620)
    }

    private var reportsPanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            reportTypeSection
            inputSection
            notesSection
            policySection
            metadataSection
            outputSection
            generateSection
            logsSection
        }
    }

    private var reportTypeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("보고서 종류")
                .font(.headline)

            HStack(spacing: 12) {
                ForEach(ReportKind.allCases) { kind in
                    Button {
                        model.selectedKind = kind
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: model.selectedKind == kind ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(model.selectedKind == kind ? .blue : .secondary)
                            Text(kind.title)
                                .font(.headline)
                                .foregroundStyle(.primary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
                        .padding(.horizontal, 14)
                        .background(model.selectedKind == kind ? Color.blue.opacity(0.10) : Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                        .overlay {
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(model.selectedKind == kind ? Color.blue.opacity(0.65) : Color(.separator).opacity(0.45), lineWidth: 1.5)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .sectionBox()
    }

    private var inputSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.selectedKind == .physicsResult {
                Text(".cap, 엑셀/CSV/텍스트, 데이터표·그래프 스크린샷 중 하나는 필수입니다. 여러 자료가 있으면 모두 사용합니다.")
                    .font(.callout.weight(.semibold))
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.yellow.opacity(0.16), in: RoundedRectangle(cornerRadius: 8))
            }

            ForEach(fileRequests(for: model.selectedKind)) { request in
                FileRequestRow(
                    request: request,
                    files: model.files(for: request.role),
                    onImport: { activeImportRole = request.role },
                    onRemove: model.removeFile
                )
            }
        }
        .sectionBox()
    }

    private var notesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("AI 참고 메모 / 내 의견")
                .font(.headline)
            TextEditor(text: $model.userNotes)
                .font(.body)
                .frame(minHeight: 150)
                .padding(10)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                .overlay(alignment: .topLeading) {
                    if model.userNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(placeholderForNotes)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 18)
                            .allowsHitTesting(false)
                    }
                }
            Text("메모는 시스템 프롬프트를 대체하지 않고, 네가 직접 알려준 판단 근거와 실험 상황을 추가로 반영하는 입력입니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .sectionBox()
    }

    private var policySection: some View {
        Toggle(isOn: $model.policyAccepted) {
            Text("본인이 이용 권한을 가진 파일만 사용하며, 학교·교사·평가기준의 AI 사용 규정을 확인했고, 생성물은 학습 보조 초안으로만 사용합니다. 그대로 제출하지 않습니다.")
                .font(.callout.weight(.semibold))
        }
        .toggleStyle(.checkboxLike)
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 18) {
                DatePicker("날짜", selection: $model.reportDate, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .environment(\.locale, Locale(identifier: "ko_KR"))

                if model.selectedKind == .chemistryPre {
                    TextField("이름 (선택)", text: $model.studentName)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 220)
                }
            }

            if model.selectedKind != .physicsResult {
                HStack(spacing: 12) {
                    TextField("실험 온도 (°C, 선택)", text: $model.temperature)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                    TextField("기압 (hPa, 선택)", text: $model.pressure)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                }
            }
        }
        .sectionBox()
    }

    private var outputSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("출력 형식")
                        .font(.headline)
                    Picker("출력 형식", selection: $model.outputFormat) {
                        Text(".docx (MS Word)").tag(OutputFormat.docx)
                        Text(".hwpx (한글)").tag(OutputFormat.hwpx)
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 360)
                }

                if model.selectedKind != .physicsResult {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("보고서 스타일")
                            .font(.headline)
                        Picker("보고서 스타일", selection: $model.reportStyle) {
                            ForEach(ReportStyle.allCases) { style in
                                Text(style.title).tag(style)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 260)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("글꼴")
                    .font(.headline)
                Picker("글꼴", selection: $model.fontFace) {
                    ForEach(availableFonts) { font in
                        Text(font.title).tag(font)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: 320, alignment: .leading)
                .padding(12)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .sectionBox()
    }

    private var generateSection: some View {
        HStack(spacing: 12) {
            Button {
                model.generate()
            } label: {
                Label(model.isGenerating ? "생성 중" : "\(model.selectedKind.title) 생성", systemImage: "wand.and.sparkles")
                    .frame(minWidth: 210)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isGenerating)

            if let report = model.generatedReport {
                ShareLink(item: report.url) {
                    Label("내보내기", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.bordered)
                .controlSize(.large)

                Text(report.title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Text(model.selectedKind == .chemistryResult ? "생성에는 보통 2~4분 정도 걸립니다." : "생성에는 보통 2~3분 정도 걸립니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var logsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(model.isGenerating ? "생성 중..." : "진행 로그")
                .font(.title3.weight(.bold))
            VStack(alignment: .leading, spacing: 6) {
                if model.logs.isEmpty {
                    Text("아직 작업 없음")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.logs) { log in
                        Text("[\(timeString(log.date))] \(log.message)")
                            .font(.system(.callout, design: .monospaced))
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(red: 0.05, green: 0.08, blue: 0.14), in: RoundedRectangle(cornerRadius: 8))
            .foregroundStyle(.white)
        }
        .sectionBox()
    }

    private var filesPanel: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("내 파일")
                .font(.title2.weight(.bold))

            if let report = model.generatedReport {
                HStack(spacing: 14) {
                    Image(systemName: report.url.pathExtension.lowercased() == "hwpx" ? "doc.text.fill" : "doc.fill")
                        .font(.title2)
                        .foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(report.title)
                            .font(.headline)
                        Text("이 기기 안에 저장된 최신 생성 파일")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    ShareLink(item: report.url) {
                        Label("내보내기", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(16)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            } else {
                ContentUnavailableView("생성된 보고서 없음", systemImage: "folder", description: Text("보고서를 생성하면 여기에서 바로 내보낼 수 있습니다."))
                    .frame(maxWidth: .infinity)
            }

            Text("서버 보관함이 아니라 로컬 앱 저장소를 사용합니다. 생성 파일은 Share 버튼으로 파일 앱, AirDrop, 메일 등에 내보낼 수 있습니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .sectionBox()
    }

    private var feedbackPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("건의사항")
                .font(.title2.weight(.bold))
            Picker("분류", selection: $model.feedbackCategory) {
                ForEach(["버그 제보", "보고서 내용", "데이터 처리", "문서 형식", "기능 제안", "기타"], id: \.self) {
                    Text($0)
                }
            }
            .pickerStyle(.segmented)

            TextEditor(text: $model.feedbackText)
                .frame(minHeight: 170)
                .padding(10)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                .overlay(alignment: .topLeading) {
                    if model.feedbackText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("어떤 화면에서 어떤 파일로 어떤 문제가 났는지 적어두면 나중에 고치기 쉽습니다.")
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 18)
                            .allowsHitTesting(false)
                    }
                }

            HStack {
                Button {
                    sendFeedbackMail()
                } label: {
                    Label("메일로 보내기", systemImage: "paperplane.fill")
                }
                .buttonStyle(.borderedProminent)

                Button("비우기", role: .destructive) {
                    model.resetFeedback()
                }
                .buttonStyle(.bordered)
            }

            Text("로컬 앱에서는 서버 이메일 전송이 없어서 iPad의 메일 작성 화면을 엽니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .sectionBox()
    }

    private var settingsPanel: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("개인 설정")
                .font(.title2.weight(.bold))

            VStack(alignment: .leading, spacing: 10) {
                Text("Anthropic API")
                    .font(.headline)
                SecureField("API Key", text: $model.apiKey)
                    .textContentType(.password)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)
                TextField("모델", text: $model.modelName)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)
                Button("API 키 저장") {
                    model.saveAPIKey()
                }
                .buttonStyle(.borderedProminent)
            }

            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                GridRow {
                    Text("서버")
                        .foregroundStyle(.secondary)
                    Text("사용 안 함")
                }
                GridRow {
                    Text("파일 처리")
                        .foregroundStyle(.secondary)
                    Text("기기 내부")
                }
                GridRow {
                    Text("Claude 호출")
                        .foregroundStyle(.secondary)
                    Text("앱에서 직접 호출")
                }
                GridRow {
                    Text("출력")
                        .foregroundStyle(.secondary)
                    Text("DOCX / HWPX")
                }
            }
            .font(.callout)
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        }
        .sectionBox()
    }

    private var placeholderForNotes: String {
        switch model.selectedKind {
        case .chemistryPre:
            "예: 선생님이 안전 주의와 수율 계산을 특히 강조했고, 왜 ice bath를 쓰는지 자세히 설명하고 싶음"
        case .chemistryResult:
            "예: 색 변화가 예상보다 늦게 나타났고, 마지막 적정값은 종말점 판단이 애매해서 오차 분석에 반영하고 싶음"
        case .physicsResult:
            "예: 예비 시행 1회는 포토게이트가 흔들려 제외했고, 재측정에서는 트랙 이음새를 지나며 카트가 살짝 튀는 현상이 있었음"
        }
    }

    private var availableFonts: [FontFace] {
        if model.selectedKind == .physicsResult {
            return FontFace.allCases
        }
        if model.outputFormat == .hwpx {
            return [.malgunGothic, .nanumMyeongjo, .hamchoromBatang]
        }
        return [.malgunGothic, .nanumMyeongjo]
    }

    private func fileRequests(for kind: ReportKind) -> [FileRequest] {
        switch kind {
        case .chemistryPre:
            [
                FileRequest(role: .manual, title: "실험 매뉴얼 PDF", subtitle: "화학 사전보고서 생성에 사용하는 실험 안내서입니다.", required: true, allowsMultiple: false)
            ]
        case .chemistryResult:
            [
                FileRequest(role: .preReport, title: "사전보고서", subtitle: "PDF 권장, DOCX/HWPX도 가능합니다.", required: true, allowsMultiple: false),
                FileRequest(role: .data, title: "실험 데이터", subtitle: "엑셀·CSV·텍스트·사진. 엑셀로 정리할 정도가 없으면 메모를 활용할 수 있습니다.", required: false, allowsMultiple: true),
                FileRequest(role: .photos, title: "실험 사진", subtitle: "여러 장 첨부 가능", required: false, allowsMultiple: true),
                FileRequest(role: .manual, title: "실험 매뉴얼 PDF", subtitle: "선택", required: false, allowsMultiple: false)
            ]
        case .physicsResult:
            [
                FileRequest(role: .cap, title: "PASCO Capstone 파일 (.cap)", subtitle: "Capstone 원자료", required: false, allowsMultiple: false),
                FileRequest(role: .data, title: "엑셀/CSV/텍스트 데이터", subtitle: "여러 개 가능. 사용자가 정리한 데이터는 .cap보다 우선합니다.", required: false, allowsMultiple: true),
                FileRequest(role: .manual, title: "실험 매뉴얼 PDF", subtitle: "엑셀 사용 시 권장", required: false, allowsMultiple: false),
                FileRequest(role: .photos, title: "실험 사진 / 데이터표·그래프 스크린샷", subtitle: "여러 장 가능", required: false, allowsMultiple: true)
            ]
        }
    }

    private func allowsMultiple(for role: ImportedFileRole) -> Bool {
        role == .data || role == .photos || role == .general
    }

    private func allowedContentTypes(for role: ImportedFileRole) -> [UTType] {
        let pdf = UTType.pdf
        let image = UTType.image
        let text = UTType.plainText
        let markdown = UTType(filenameExtension: "md") ?? .plainText
        let csv = UTType.commaSeparatedText
        let xlsx = UTType(filenameExtension: "xlsx") ?? .data
        let xls = UTType(filenameExtension: "xls") ?? .data
        let cap = UTType(importedAs: "com.pasco.capstone.cap")
        let hwpx = UTType(filenameExtension: "hwpx") ?? .data
        let docx = UTType(filenameExtension: "docx") ?? .data

        switch role {
        case .manual:
            return [pdf]
        case .preReport:
            return [pdf, docx, hwpx]
        case .cap:
            return [cap, .data, .item]
        case .data:
            return [xlsx, xls, csv, text, markdown, image]
        case .photos:
            return [image]
        case .general:
            return [pdf, docx, hwpx, xlsx, xls, csv, text, markdown, cap, image, .data]
        }
    }

    private func sendFeedbackMail() {
        let body = model.feedbackText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else {
            model.errorMessage = "건의사항 내용을 먼저 적어주세요."
            return
        }

        var components = URLComponents()
        components.scheme = "mailto"
        components.path = "fakeminjun7321@gmail.com"
        components.queryItems = [
            URLQueryItem(name: "subject", value: "[보고서 작성툴 iPad] \(model.feedbackCategory)"),
            URLQueryItem(name: "body", value: body)
        ]

        guard let url = components.url else {
            model.errorMessage = "메일 링크를 만들 수 없습니다."
            return
        }
        UIApplication.shared.open(url)
    }

    private func timeString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}

private struct FileRequestRow: View {
    let request: FileRequest
    let files: [ImportedDocument]
    let onImport: () -> Void
    let onRemove: (ImportedDocument) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text(request.title)
                            .font(.headline)
                        if request.required {
                            Text("*")
                                .font(.headline)
                                .foregroundStyle(.red)
                        }
                    }
                    Text(request.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    onImport()
                } label: {
                    Label("파일 선택", systemImage: "doc.badge.plus")
                }
                .buttonStyle(.bordered)
            }

            if files.isEmpty {
                Text("선택된 파일 없음")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            } else {
                VStack(spacing: 8) {
                    ForEach(files) { file in
                        HStack(spacing: 10) {
                            Image(systemName: icon(for: file.type))
                                .foregroundStyle(.blue)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(file.filename)
                                    .font(.callout.weight(.semibold))
                                    .lineLimit(1)
                                Text("\(file.type.rawValue) · \(file.sizeLabel)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(role: .destructive) {
                                onRemove(file)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                        }
                        .padding(12)
                        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    private func icon(for type: ImportedDocumentType) -> String {
        switch type {
        case .pdf: "doc.richtext"
        case .hwpx, .docx: "doc.text"
        case .xlsx, .csv: "tablecells"
        case .cap: "waveform.path.ecg"
        case .image: "photo"
        case .text: "text.alignleft"
        case .other: "doc"
        }
    }
}

private struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .foregroundStyle(configuration.isOn ? .blue : .secondary)
                    .font(.title3)
                configuration.label
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
    }
}

private extension ToggleStyle where Self == CheckboxToggleStyle {
    static var checkboxLike: CheckboxToggleStyle { CheckboxToggleStyle() }
}

private extension View {
    func sectionBox() -> some View {
        self
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(.separator).opacity(0.35))
            }
    }
}
