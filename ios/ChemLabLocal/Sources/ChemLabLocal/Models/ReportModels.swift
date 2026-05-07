import Foundation
import UniformTypeIdentifiers

enum ReportKind: String, CaseIterable, Identifiable {
    case chemistryPre
    case chemistryResult
    case physicsResult

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chemistryPre: "화학 사전보고서"
        case .chemistryResult: "화학 결과보고서"
        case .physicsResult: "물리 결과보고서"
        }
    }

    var outputTitle: String {
        switch self {
        case .chemistryPre: "사전보고서"
        case .chemistryResult: "결과보고서 추가 작성분"
        case .physicsResult: "물리 결과보고서"
        }
    }
}

enum OutputFormat: String, CaseIterable, Identifiable {
    case hwpx
    case docx

    var id: String { rawValue }

    var title: String {
        switch self {
        case .hwpx: "HWPX"
        case .docx: "DOCX"
        }
    }

    var fileExtension: String { rawValue }
}

struct ImportedDocument: Identifiable, Hashable {
    let id = UUID()
    let url: URL
    let filename: String
    let sizeBytes: Int64
    let type: ImportedDocumentType

    var sizeLabel: String {
        ByteCountFormatter.string(fromByteCount: sizeBytes, countStyle: .file)
    }
}

enum ImportedDocumentType: String, CaseIterable {
    case pdf = "PDF"
    case hwpx = "HWPX"
    case docx = "DOCX"
    case xlsx = "XLSX"
    case csv = "CSV"
    case cap = "CAP"
    case image = "Image"
    case text = "Text"
    case other = "Other"

    static func detect(url: URL, contentType: UTType?) -> ImportedDocumentType {
        let ext = url.pathExtension.lowercased()
        if ext == "pdf" { return .pdf }
        if ext == "hwpx" { return .hwpx }
        if ext == "docx" { return .docx }
        if ["xlsx", "xls"].contains(ext) { return .xlsx }
        if ext == "csv" { return .csv }
        if ext == "cap" { return .cap }
        if ["txt", "md"].contains(ext) { return .text }
        if contentType?.conforms(to: .image) == true || ["png", "jpg", "jpeg", "heic"].contains(ext) {
            return .image
        }
        return .other
    }
}

struct GenerationLog: Identifiable {
    let id = UUID()
    let date = Date()
    let message: String
}

struct GeneratedReport: Identifiable {
    let id = UUID()
    let url: URL
    let title: String
}
