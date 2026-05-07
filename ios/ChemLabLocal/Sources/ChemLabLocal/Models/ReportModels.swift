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

enum ReportStyle: String, CaseIterable, Identifiable {
    case standard
    case minimal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .standard: "기본 양식"
        case .minimal: "간단 양식"
        }
    }
}

enum FontFace: String, CaseIterable, Identifiable {
    case malgunGothic
    case nanumGothic
    case nanumMyeongjo
    case hamchoromBatang

    var id: String { rawValue }

    var title: String {
        switch self {
        case .malgunGothic: "맑은 고딕"
        case .nanumGothic: "나눔고딕"
        case .nanumMyeongjo: "나눔명조"
        case .hamchoromBatang: "함초롬바탕"
        }
    }

    var documentName: String {
        switch self {
        case .malgunGothic: "Malgun Gothic"
        case .nanumGothic: "NanumGothic"
        case .nanumMyeongjo: "NanumMyeongjo"
        case .hamchoromBatang: "HCR Batang"
        }
    }
}

enum ImportedFileRole: String, CaseIterable, Identifiable {
    case general
    case manual
    case preReport
    case cap
    case data
    case photos

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: "입력 파일"
        case .manual: "실험 매뉴얼"
        case .preReport: "사전보고서"
        case .cap: "PASCO Capstone"
        case .data: "실험 데이터"
        case .photos: "사진/스크린샷"
        }
    }

    var promptLabel: String {
        switch self {
        case .general: "일반 첨부"
        case .manual: "실험 매뉴얼"
        case .preReport: "기존 사전보고서"
        case .cap: "PASCO Capstone 원자료"
        case .data: "사용자가 정리한 실험 데이터"
        case .photos: "실험 사진 또는 데이터표/그래프 스크린샷"
        }
    }
}

struct ImportedDocument: Identifiable, Hashable {
    let id = UUID()
    let url: URL
    let filename: String
    let sizeBytes: Int64
    let type: ImportedDocumentType
    let role: ImportedFileRole

    var sizeLabel: String {
        ByteCountFormatter.string(fromByteCount: sizeBytes, countStyle: .file)
    }
}

enum ImportedDocumentType: String, CaseIterable {
    case pdf = "PDF"
    case hwpx = "HWPX"
    case docx = "DOCX"
    case xlsx = "XLSX"
    case xls = "XLS"
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
        if ext == "xlsx" { return .xlsx }
        if ext == "xls" { return .xls }
        if ext == "csv" { return .csv }
        if ext == "cap" { return .cap }
        if ["txt", "md", "json", "log"].contains(ext) { return .text }
        if contentType?.conforms(to: .image) == true || ["png", "jpg", "jpeg", "heic", "webp", "gif"].contains(ext) {
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
