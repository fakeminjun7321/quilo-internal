import Foundation
import PDFKit
import ZIPFoundation

struct ExtractedFileContext: Identifiable {
    let id = UUID()
    let document: ImportedDocument
    let extractedText: String
    let attachmentData: Data?
    let mediaType: String?

    var promptBlock: String {
        """
        === \(document.filename) [\(document.role.promptLabel), \(document.type.rawValue), \(document.sizeLabel)] ===
        \(extractedText)
        === 파일 끝 ===
        """
    }
}

private struct CapMeasurementMeta {
    let measurementName: String
    let shortName: String
    let symbol: String
    let unit: String
    let dependent: Bool
}

private struct CapDataset {
    let kind: String
    let values: [Double]
    let stringValues: [String]
    let rawCount: Int
    let validCount: Int
    let min: Double
    let max: Double
}

struct LocalFileExtractor {
    func extract(_ document: ImportedDocument) throws -> ExtractedFileContext {
        let data = try Data(contentsOf: document.url)
        switch document.type {
        case .text, .csv:
            return context(document, text: decodeText(data), data: nil, mediaType: nil)
        case .pdf:
            let extracted = extractPDFText(document.url)
            if extracted.trimmingCharacters(in: .whitespacesAndNewlines).count >= 800 {
                return context(
                    document,
                    text: "PDF 원문 텍스트를 iPad에서 먼저 추출했습니다. 전송 시간을 줄이기 위해 PDF 원본 업로드는 생략합니다.\n\n\(extracted)",
                    data: nil,
                    mediaType: nil
                )
            }
            return context(document, text: "PDF 텍스트 추출량이 부족하여 Claude document 입력으로 함께 전송됨.", data: data, mediaType: "application/pdf")
        case .image:
            return context(document, text: "이미지는 Claude vision 입력으로 함께 전송됨.", data: data, mediaType: imageMediaType(document.url))
        case .hwpx:
            return context(document, text: try extractHWPXText(document.url), data: nil, mediaType: nil)
        case .docx:
            return context(document, text: try extractDOCXText(document.url), data: nil, mediaType: nil)
        case .xlsx:
            return context(document, text: try extractXLSXText(document.url), data: nil, mediaType: nil)
        case .xls:
            let decoded = decodeText(data).trimmingCharacters(in: .whitespacesAndNewlines)
            let text = decoded.count > 120
                ? decoded
                : "구형 .xls 파일은 iPad 로컬 앱에서 직접 표 파싱이 제한됩니다. 가능하면 .xlsx 또는 .csv로 저장해서 다시 첨부하세요. 이 파일명과 사용자 메모는 보고서 작성 참고자료로 전달됩니다."
            return context(document, text: text, data: nil, mediaType: nil)
        case .cap:
            return context(document, text: try extractCAPText(document.url), data: nil, mediaType: nil)
        case .other:
            return context(document, text: "지원되지 않는 바이너리 형식. 파일명과 사용자 메모만 참고.", data: nil, mediaType: nil)
        }
    }

    private func context(_ doc: ImportedDocument, text: String, data: Data?, mediaType: String?) -> ExtractedFileContext {
        ExtractedFileContext(
            document: doc,
            extractedText: TextUtilities.truncate(text),
            attachmentData: data,
            mediaType: mediaType
        )
    }

    private func decodeText(_ data: Data) -> String {
        let koreanEncodings = [
            String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.EUC_KR.rawValue))),
            String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.dosKorean.rawValue)))
        ]
        let encodings: [String.Encoding] = [.utf8, .utf16, .utf16LittleEndian, .utf16BigEndian] + koreanEncodings + [.isoLatin1]
        for encoding in encodings {
            if let text = String(data: data, encoding: encoding), !text.isEmpty {
                return text
            }
        }
        return ""
    }

    private func imageMediaType(_ url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "jpg", "jpeg": "image/jpeg"
        case "png": "image/png"
        case "gif": "image/gif"
        case "webp": "image/webp"
        case "heic": "image/heic"
        default: "image/other"
        }
    }

    private func archive(_ url: URL) throws -> Archive {
        do {
            return try Archive(url: url, accessMode: .read)
        } catch {
            throw NSError(domain: "LocalFileExtractor", code: 1, userInfo: [NSLocalizedDescriptionKey: "ZIP 기반 파일을 열 수 없습니다: \(url.lastPathComponent)"])
        }
    }

    private func stringEntry(_ archive: Archive, _ path: String) throws -> String? {
        guard let entry = archive[path] else { return nil }
        var data = Data()
        _ = try archive.extract(entry) { data.append($0) }
        return decodeText(data)
    }

    private func dataEntry(_ archive: Archive, _ path: String) throws -> Data? {
        guard let entry = archive[path] else { return nil }
        var data = Data()
        _ = try archive.extract(entry) { data.append($0) }
        return data
    }

    private func extractHWPXText(_ url: URL) throws -> String {
        let archive = try archive(url)
        if let preview = try stringEntry(archive, "Preview/PrvText.txt"), !preview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return preview
        }
        var chunks: [String] = []
        for entry in archive where entry.path.hasPrefix("Contents/section") && entry.path.hasSuffix(".xml") {
            if let xml = try stringEntry(archive, entry.path) {
                chunks.append(TextUtilities.xmlText(xml))
            }
        }
        return chunks.joined(separator: "\n\n")
    }

    private func extractDOCXText(_ url: URL) throws -> String {
        let archive = try archive(url)
        guard let xml = try stringEntry(archive, "word/document.xml") else { return "" }
        return TextUtilities.xmlText(xml)
    }

    private func extractPDFText(_ url: URL) -> String {
        guard let document = PDFDocument(url: url) else { return "" }
        var pages: [String] = []
        for index in 0..<document.pageCount {
            guard let text = document.page(at: index)?.string else { continue }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                pages.append("## PDF \(index + 1)쪽\n\(trimmed)")
            }
            if pages.joined(separator: "\n\n").count > 24_000 { break }
        }
        return pages.joined(separator: "\n\n")
    }

    private func extractZipText(_ url: URL, preferredNames: [String]) throws -> String {
        let archive = try archive(url)
        return try extractZipText(archive, preferredNames: preferredNames)
    }

    private func extractZipText(_ archive: Archive, preferredNames: [String]) throws -> String {
        var chunks: [String] = []
        for name in preferredNames {
            if let xml = try stringEntry(archive, name) {
                chunks.append("# \(name)\n" + TextUtilities.xmlText(xml))
            }
        }
        if chunks.isEmpty {
            for entry in archive where isUsefulTextEntry(entry.path) {
                if let text = try stringEntry(archive, entry.path) {
                    let normalized = entry.path.hasSuffix(".xml") ? TextUtilities.xmlText(text) : text
                    chunks.append("# \(entry.path)\n" + normalized)
                }
                if chunks.joined().count > 24_000 { break }
            }
        }
        return chunks.joined(separator: "\n\n")
    }

    private func extractCAPText(_ url: URL) throws -> String {
        if let archive = try? archive(url) {
            let text = try summarizeCAPArchive(archive)
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return text
            }
        }

        let data = try Data(contentsOf: url)
        let decoded = decodeText(data)
        if decoded.trimmingCharacters(in: .whitespacesAndNewlines).count > 200 {
            return decoded
        }
        return printableStrings(from: data)
    }

    private func summarizeCAPArchive(_ archive: Archive) throws -> String {
        guard let mainXML = try stringEntry(archive, "main.xml") else {
            return try extractZipText(archive, preferredNames: ["document.xml", "DataSets.xml", "Experiment.xml"])
        }

        var lines: [String] = ["# PASCO Capstone (.cap) 자동 파싱 결과", ""]
        let pageChunks = elementChunks(mainXML, tag: "WorkbookPage")
        let pages = unique(pageChunks.compactMap { attr($0, "Name") }.filter { !$0.isEmpty })
        if !pages.isEmpty {
            lines.append("## 워크북 페이지 (\(pages.count)개)")
            lines += pages.map { "- \($0)" }
            lines.append("")
        }

        let sensorChunks = elementChunks(mainXML, tag: "Sensor")
        let sensorNames = unique(sensorChunks.compactMap { attr($0, "Name") }.filter { !$0.isEmpty && !$0.hasPrefix("?") })
        if !sensorNames.isEmpty {
            lines.append("## 센서 (\(sensorNames.count)개)")
            lines += sensorNames.map { "- \($0)" }
            lines.append("")
        }

        var pageTextCount = 0
        var pageTextLines: [String] = []
        for page in pageChunks {
            guard let pageName = attr(page, "Name"), !pageName.isEmpty else { continue }
            var texts: [String] = []
            for textEdit in elementChunks(page, tag: "CSTextEdit") {
                guard let raw = attr(textEdit, "HTML") else { continue }
                let text = stripHTML(xmlUnescape(raw))
                if text.count > 10 { texts.append(text) }
            }
            for title in elementChunks(page, tag: "DisplayTitle") {
                guard let raw = attr(title, "DisplayTitleText") else { continue }
                let text = stripHTML(xmlUnescape(raw))
                if text.count > 3 && !text.contains("Enter title here") {
                    texts.append("[Title] \(text)")
                }
            }
            guard !texts.isEmpty else { continue }
            pageTextCount += texts.count
            pageTextLines.append("### [\(pageName)]")
            for text in texts {
                pageTextLines.append(text.count > 800 ? String(text.prefix(800)) + "..." : text)
                pageTextLines.append("")
            }
        }
        if !pageTextLines.isEmpty {
            lines.append("## 페이지별 텍스트 콘텐츠 (\(pageTextCount)개)")
            lines += pageTextLines
        }

        let datasetMeta = capDatasetMetadata(from: mainXML)
        var datasets: [String: CapDataset] = [:]
        var imageNames: [String] = []

        for entry in archive {
            if entry.path.hasPrefix("data/"), entry.path.hasSuffix(".tmp") {
                var data = Data()
                _ = try archive.extract(entry) { data.append($0) }
                guard let decoded = decodeCAPTmp(data), decoded.validCount >= 3 else { continue }
                datasets[(entry.path as NSString).lastPathComponent] = decoded
            } else if entry.path.hasPrefix("images/") {
                let lower = entry.path.lowercased()
                if lower.hasSuffix(".png") || lower.hasSuffix(".jpg") || lower.hasSuffix(".jpeg") {
                    imageNames.append((entry.path as NSString).lastPathComponent)
                }
            }
        }

        if !datasets.isEmpty {
            appendCAPDatasetSummary(datasets, metadata: datasetMeta, to: &lines)
        } else {
            lines.append("## 측정 데이터")
            lines.append("- data/*.tmp에서 보고서에 바로 쓸 만한 숫자/문자 데이터가 감지되지 않았습니다. 엑셀/CSV/텍스트로 정리한 파일이 있으면 그 값을 우선 사용하세요.")
            lines.append("")
        }

        if !imageNames.isEmpty {
            lines.append("## 캡스톤 내장 이미지 (\(imageNames.count)개)")
            lines += imageNames.prefix(20).map { "- \($0)" }
            if imageNames.count > 20 {
                lines.append("- ... 외 \(imageNames.count - 20)개")
            }
            lines.append("")
        }

        lines.append("## 파싱 원칙")
        lines.append("- 엑셀/CSV/텍스트로 사용자가 정리한 데이터가 함께 첨부되면 그 값을 .cap 원자료보다 우선합니다.")
        lines.append("- .cap의 사용자 입력 표는 행 순서가 시편/측정 회차 순서일 가능성이 높으므로 임의로 재정렬하지 않습니다.")
        return lines.joined(separator: "\n")
    }

    private func capDatasetMetadata(from xml: String) -> [String: CapMeasurementMeta] {
        var mapping: [String: CapMeasurementMeta] = [:]
        for source in elementChunks(xml, tag: "DataSource") {
            let name = attr(source, "MeasurementName") ?? attr(source, "LongName") ?? "(미상)"
            let shortName = attr(source, "ShortName") ?? ""
            let symbol = attr(source, "SymbolName") ?? ""
            let unit = attr(source, "BaseUnit") ?? ""

            for dep in elementChunks(source, tag: "DependentStorageElement") {
                guard let file = attr(dep, "FileName"), !file.isEmpty else { continue }
                mapping[(file as NSString).lastPathComponent] = CapMeasurementMeta(
                    measurementName: name,
                    shortName: shortName,
                    symbol: symbol,
                    unit: unit,
                    dependent: true
                )
            }

            for ind in elementChunks(source, tag: "IndependentStorageElement") {
                guard let file = attr(ind, "FileName"), !file.isEmpty else { continue }
                mapping[(file as NSString).lastPathComponent] = CapMeasurementMeta(
                    measurementName: "\(name) (시간축)",
                    shortName: shortName,
                    symbol: "t",
                    unit: "s",
                    dependent: false
                )
            }
        }
        return mapping
    }

    private func appendCAPDatasetSummary(_ datasets: [String: CapDataset], metadata: [String: CapMeasurementMeta], to lines: inout [String]) {
        var numericGroups: [String: [CapDataset]] = [:]
        var stringGroups: [String: [CapDataset]] = [:]

        for (filename, dataset) in datasets {
            let meta = metadata[filename]
            if meta?.dependent == false { continue }
            let name = meta?.measurementName.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = (name?.isEmpty == false ? name! : "(미상)")
            if dataset.kind == "string" {
                stringGroups[key, default: []].append(dataset)
            } else {
                numericGroups[key, default: []].append(dataset)
            }
        }

        let stringColumns = stringGroups.compactMap { name, group -> (name: String, values: [String])? in
            let values = group.max(by: { $0.stringValues.count < $1.stringValues.count })?.stringValues ?? []
            guard (3...20).contains(values.count) else { return nil }
            return (name, values)
        }
        let numericColumns = numericGroups.compactMap { name, group -> (name: String, values: [Double])? in
            guard group.count == 1, let values = group.first?.values, (3...20).contains(values.count) else { return nil }
            let nonZero = values.map(abs).filter { $0 > 1e-12 }
            if let minValue = nonZero.min(), let maxValue = nonZero.max(), minValue > 0, maxValue / minValue > 100 {
                return nil
            }
            return (name, values)
        }

        if stringColumns.count + numericColumns.count >= 2 {
            lines.append("## 캡스톤 사용자 입력 표 (보고서 측정 데이터 표의 원본)")
            lines.append("⚠️ 각 행이 한 시편 또는 측정 회차에 해당할 가능성이 큽니다. 행 순서를 그대로 유지하세요.")
            let headers = stringColumns.map(\.name) + numericColumns.map(\.name)
            lines.append("| # | \(headers.joined(separator: " | ")) |")
            lines.append("|---|\(headers.map { _ in "---" }.joined(separator: "|"))|")
            let rowCount = max(stringColumns.map { $0.values.count }.max() ?? 0, numericColumns.map { $0.values.count }.max() ?? 0)
            for index in 0..<rowCount {
                var row = [String(index + 1)]
                for column in stringColumns {
                    row.append(index < column.values.count ? column.values[index] : "—")
                }
                for column in numericColumns {
                    row.append(index < column.values.count ? formatCAPNumber(column.values[index]) : "—")
                }
                lines.append("| \(row.joined(separator: " | ")) |")
            }
            lines.append("")
        }

        lines.append("## 측정 데이터 상세 (\(datasets.count)개 raw dataset)")
        for (name, group) in numericGroups.sorted(by: { $0.key < $1.key }) {
            let filtered = group.filter { dataset in
                dataset.validCount >= 3 && (abs(dataset.min) > 1e-9 || abs(dataset.max) > 1e-9)
            }
            guard !filtered.isEmpty else { continue }
            lines.append("### \(name) — \(filtered.count)개 run")
            for (index, dataset) in filtered.prefix(20).enumerated() {
                let stats = capStats(dataset.values)
                let sample = sampleEvenly(dataset.values, count: dataset.values.count <= 30 ? dataset.values.count : 5)
                    .map { String(format: "%.5g", $0) }
                    .joined(separator: ", ")
                lines.append("run \(index + 1): n=\(stats.n), mean=\(formatCAPNumber(stats.mean)), std=\(formatCAPNumber(stats.std)), range=[\(formatCAPNumber(stats.min)), \(formatCAPNumber(stats.max))], values=[\(sample)]")
            }
            if filtered.count > 20 {
                lines.append("... 외 \(filtered.count - 20)개 run")
            }
            lines.append("")
        }

        if !stringGroups.isEmpty {
            lines.append("## 측정 조건/카테고리 라벨")
            for (name, group) in stringGroups.sorted(by: { $0.key < $1.key }) {
                let values = unique(group.flatMap(\.stringValues))
                guard !values.isEmpty else { continue }
                lines.append("- \(name): \(values.prefix(30).joined(separator: ", "))")
            }
            lines.append("")
        }
    }

    private func decodeCAPTmp(_ data: Data) -> CapDataset? {
        let format = detectCAPTmpFormat(data)
        if format == "timeseries" {
            return decodeCAPTimeseries(data)
        }
        if format == "userdata" {
            return decodeCAPUserData(data)
        }
        return nil
    }

    private func detectCAPTmpFormat(_ data: Data) -> String {
        var offset = 0
        while offset + 4 <= data.count {
            let value = uint32LE(data, offset)
            if value == 1 { return "timeseries" }
            if value == 2 { return "userdata" }
            if value != 0 { return "unknown" }
            offset += 4
        }
        return "empty"
    }

    private func decodeCAPTimeseries(_ data: Data) -> CapDataset? {
        let recordSize = 12
        let total = data.count / recordSize
        let limit = min(total, 200_000)
        var values: [Double] = []
        values.reserveCapacity(min(limit, 2048))
        var minValue = Double.infinity
        var maxValue = -Double.infinity

        for index in 0..<limit {
            let offset = index * recordSize
            guard uint32LE(data, offset) == 1 else { continue }
            let value = doubleLE(data, offset + 4)
            guard value.isFinite else { continue }
            values.append(value)
            minValue = min(minValue, value)
            maxValue = max(maxValue, value)
        }
        guard !values.isEmpty else { return nil }
        return CapDataset(kind: "numeric", values: values, stringValues: [], rawCount: total, validCount: values.count, min: minValue, max: maxValue)
    }

    private func decodeCAPUserData(_ data: Data) -> CapDataset? {
        var rawStrings: [String] = []
        var offset = 0
        var lastLength = 0

        while offset + 8 <= data.count {
            let type = uint32LE(data, offset)
            let length = Int(uint32LE(data, offset + 4))
            if type == 0 && length == 0 {
                offset += 8
                continue
            }
            if type == 2, length > 0, length <= 4096, length % 2 == 0, offset + 8 + length <= data.count {
                let range = offset + 8..<offset + 8 + length
                if let text = String(data: data.subdata(in: range), encoding: .utf16LittleEndian) {
                    rawStrings.append(text)
                }
                offset += 8 + length
                lastLength = length
                continue
            }
            if lastLength > 0, offset + lastLength <= data.count {
                while offset + lastLength <= data.count {
                    let range = offset..<offset + lastLength
                    if let text = String(data: data.subdata(in: range), encoding: .utf16LittleEndian) {
                        rawStrings.append(text)
                    }
                    offset += lastLength
                }
            }
            break
        }

        let cleaned = rawStrings.map {
            $0.replacingOccurrences(of: "\u{0000}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty && $0.count < 200 }

        var numbers: [Double] = []
        var labels: [String] = []
        for value in cleaned {
            if let number = Double(value), number.isFinite {
                numbers.append(number)
            } else {
                labels.append(value)
            }
        }

        let kind: String
        if numbers.isEmpty && labels.isEmpty {
            return nil
        } else if !numbers.isEmpty && labels.isEmpty {
            kind = "numeric"
        } else if numbers.isEmpty {
            kind = "string"
        } else {
            kind = numbers.count >= labels.count ? "numeric" : "string"
        }

        let minValue = numbers.min() ?? 0
        let maxValue = numbers.max() ?? 0
        return CapDataset(kind: kind, values: numbers, stringValues: labels, rawCount: rawStrings.count, validCount: numbers.count + labels.count, min: minValue, max: maxValue)
    }

    private func uint32LE(_ data: Data, _ offset: Int) -> UInt32 {
        guard offset + 4 <= data.count else { return 0 }
        return UInt32(data[offset])
            | (UInt32(data[offset + 1]) << 8)
            | (UInt32(data[offset + 2]) << 16)
            | (UInt32(data[offset + 3]) << 24)
    }

    private func uint64LE(_ data: Data, _ offset: Int) -> UInt64 {
        guard offset + 8 <= data.count else { return 0 }
        var value: UInt64 = 0
        for index in 0..<8 {
            value |= UInt64(data[offset + index]) << UInt64(index * 8)
        }
        return value
    }

    private func doubleLE(_ data: Data, _ offset: Int) -> Double {
        Double(bitPattern: uint64LE(data, offset))
    }

    private func capStats(_ values: [Double]) -> (n: Int, mean: Double, std: Double, min: Double, max: Double) {
        guard !values.isEmpty else { return (0, 0, 0, 0, 0) }
        let n = values.count
        let sum = values.reduce(0, +)
        let mean = sum / Double(n)
        let squareMean = values.reduce(0) { $0 + $1 * $1 } / Double(n)
        let variance = max(0, squareMean - mean * mean)
        return (n, mean, sqrt(variance), values.min() ?? 0, values.max() ?? 0)
    }

    private func sampleEvenly(_ values: [Double], count: Int) -> [Double] {
        guard count > 0, values.count > count else { return values }
        return (0..<count).map { index in
            values[Int(round(Double(index) * Double(values.count - 1) / Double(count - 1)))]
        }
    }

    private func formatCAPNumber(_ value: Double) -> String {
        if value != 0, abs(value) < 1e-3 || abs(value) >= 1e6 {
            return String(format: "%.4e", value)
        }
        return String(format: "%.6g", value)
    }

    private func elementChunks(_ xml: String, tag: String) -> [String] {
        let pattern = #"(?s)<\#(tag)\b[^>]*(?:/>|>.*?</\#(tag)>)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = xml as NSString
        return regex.matches(in: xml, range: NSRange(location: 0, length: ns.length)).map {
            ns.substring(with: $0.range)
        }
    }

    private func attr(_ xml: String, _ name: String) -> String? {
        let pattern = #"\b\#(name)\s*=\s*(?:"([^"]*)"|'([^']*)')"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let ns = xml as NSString
        guard let match = regex.firstMatch(in: xml, range: NSRange(location: 0, length: ns.length)) else { return nil }
        for index in 1..<match.numberOfRanges where match.range(at: index).location != NSNotFound {
            return xmlUnescape(ns.substring(with: match.range(at: index))).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }

    private func stripHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"(?i)<\s*/?\s*(p|div|br|li|tr|h[1-6])\s*[^>]*>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"<[^>]+>"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func xmlUnescape(_ value: String) -> String {
        var text = value
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&nbsp;", with: " ")

        if let decimal = try? NSRegularExpression(pattern: #"&#(\d+);"#) {
            let ns = text as NSString
            var result = text
            for match in decimal.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
                let raw = ns.substring(with: match.range(at: 1))
                if let code = UInt32(raw), let scalar = UnicodeScalar(code) {
                    result = (result as NSString).replacingCharacters(in: match.range, with: String(scalar))
                }
            }
            text = result
        }
        return text
    }

    private func unique<T: Hashable>(_ values: [T]) -> [T] {
        var seen = Set<T>()
        var result: [T] = []
        for value in values where !seen.contains(value) {
            seen.insert(value)
            result.append(value)
        }
        return result
    }

    private func isUsefulTextEntry(_ path: String) -> Bool {
        let lower = path.lowercased()
        return lower.hasSuffix(".xml")
            || lower.hasSuffix(".txt")
            || lower.hasSuffix(".csv")
            || lower.hasSuffix(".json")
            || lower.hasSuffix(".plist")
    }

    private func printableStrings(from data: Data) -> String {
        var chunks: [String] = []
        var current = [UInt8]()
        for byte in data {
            if (32...126).contains(byte) || byte == 9 || byte == 10 || byte == 13 {
                current.append(byte)
            } else {
                if current.count >= 12, let text = String(bytes: current, encoding: .utf8) {
                    chunks.append(text)
                }
                current.removeAll(keepingCapacity: true)
            }
            if chunks.joined().count > 24_000 { break }
        }
        if current.count >= 12, let text = String(bytes: current, encoding: .utf8) {
            chunks.append(text)
        }
        return chunks.joined(separator: "\n")
    }

    private func extractXLSXText(_ url: URL) throws -> String {
        let archive = try archive(url)
        let shared = try sharedStrings(archive)
        var chunks: [String] = []
        for entry in archive where entry.path.hasPrefix("xl/worksheets/sheet") && entry.path.hasSuffix(".xml") {
            guard let xml = try stringEntry(archive, entry.path) else { continue }
            let rows = parseSheetRows(xml, sharedStrings: shared)
            let table = rows.map { $0.joined(separator: " | ") }.joined(separator: "\n")
            chunks.append("## \(entry.path)\n\(table)")
        }
        return chunks.joined(separator: "\n\n")
    }

    private func sharedStrings(_ archive: Archive) throws -> [String] {
        guard let xml = try stringEntry(archive, "xl/sharedStrings.xml") else { return [] }
        let pattern = #"(?s)<si[^>]*>(.*?)</si>"#
        let regex = try NSRegularExpression(pattern: pattern)
        let ns = xml as NSString
        return regex.matches(in: xml, range: NSRange(location: 0, length: ns.length)).map { match in
            TextUtilities.xmlText(ns.substring(with: match.range(at: 1)))
        }
    }

    private func parseSheetRows(_ xml: String, sharedStrings: [String]) -> [[String]] {
        let rowRegex = try? NSRegularExpression(pattern: #"(?s)<row[^>]*>(.*?)</row>"#)
        let cellRegex = try? NSRegularExpression(pattern: #"(?s)<c([^>]*)>(.*?)</c>"#)
        let valueRegex = try? NSRegularExpression(pattern: #"(?s)<v[^>]*>(.*?)</v>"#)
        let inlineRegex = try? NSRegularExpression(pattern: #"(?s)<is[^>]*>(.*?)</is>"#)
        let ns = xml as NSString
        return rowRegex?.matches(in: xml, range: NSRange(location: 0, length: ns.length)).map { rowMatch in
            let rowXML = ns.substring(with: rowMatch.range(at: 1))
            let rowNS = rowXML as NSString
            return cellRegex?.matches(in: rowXML, range: NSRange(location: 0, length: rowNS.length)).map { cell in
                let attrs = rowNS.substring(with: cell.range(at: 1))
                let body = rowNS.substring(with: cell.range(at: 2))
                if let inline = inlineRegex?.firstMatch(in: body, range: NSRange(location: 0, length: (body as NSString).length)) {
                    return TextUtilities.xmlText((body as NSString).substring(with: inline.range(at: 1)))
                }
                guard let value = valueRegex?.firstMatch(in: body, range: NSRange(location: 0, length: (body as NSString).length)) else {
                    return ""
                }
                let raw = TextUtilities.xmlText((body as NSString).substring(with: value.range(at: 1)))
                if attrs.contains(#" t="s""#), let index = Int(raw), sharedStrings.indices.contains(index) {
                    return sharedStrings[index]
                }
                return raw
            } ?? []
        } ?? []
    }
}
