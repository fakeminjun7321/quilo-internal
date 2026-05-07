import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @Bindable var model: AppModel
    @State private var showingImporter = false
    @State private var selectedTab: AppTab = .generate

    var body: some View {
        TabView(selection: $selectedTab) {
            GenerateView(model: model, showingImporter: $showingImporter)
                .tabItem { Label("생성", systemImage: "doc.badge.plus") }
                .tag(AppTab.generate)

            SettingsView(model: model)
                .tabItem { Label("설정", systemImage: "key") }
                .tag(AppTab.settings)
        }
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: supportedTypes,
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                model.importFiles(urls)
            case .failure(let error):
                model.errorMessage = error.localizedDescription
            }
        }
        .alert("오류", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button("확인", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var supportedTypes: [UTType] {
        [
            .pdf,
            .image,
            .plainText,
            .commaSeparatedText,
            UTType(filenameExtension: "md") ?? .plainText,
            UTType(filenameExtension: "hwpx") ?? .data,
            UTType(filenameExtension: "docx") ?? .data,
            UTType(filenameExtension: "xlsx") ?? .data,
            UTType(filenameExtension: "xls") ?? .data,
            UTType(filenameExtension: "cap") ?? .data
        ]
    }
}

enum AppTab {
    case generate
    case settings
}

#Preview {
    ContentView(model: AppModel())
}
