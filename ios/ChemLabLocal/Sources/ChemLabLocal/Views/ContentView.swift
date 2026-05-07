import SwiftUI

struct ContentView: View {
    let model: AppModel

    var body: some View {
        LocalReportToolView(model: model)
    }
}

#Preview {
    ContentView(model: AppModel())
}
