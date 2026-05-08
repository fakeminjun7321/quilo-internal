import SwiftUI

struct SettingsView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationStack {
            Form {
                Section("Anthropic API") {
                    SecureField("API Key", text: $model.apiKey)
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    TextField("모델", text: $model.modelName)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    HStack {
                        Button("API 키 저장") {
                            model.saveAPIKey()
                        }
                        Button {
                            model.testAPIConnection()
                        } label: {
                            Label(model.isTestingAPI ? "테스트 중" : "Claude 연결 테스트", systemImage: "network")
                        }
                        .disabled(model.isTestingAPI || model.isGenerating)
                    }
                }

                Section("로컬 앱 구조") {
                    LabeledContent("서버") {
                        Text("사용 안 함")
                    }
                    LabeledContent("파일 처리") {
                        Text("기기 내부")
                    }
                    LabeledContent("출력") {
                        Text("HWPX")
                    }
                }

                Section {
                    Text("API 키는 iPad Keychain에 저장됩니다. 여러 사용자에게 배포할 앱이라면 사용자별 API 키 입력 방식이 가장 안전합니다.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("설정")
        }
    }
}
