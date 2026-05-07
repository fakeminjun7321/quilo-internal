import Foundation
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

struct LocalFileExtractor {
    func extract(_ document: ImportedDocument) throws -> ExtractedFileContext {
        let data = try Data(contentsOf: document.url)
        switch document.type {
        case .text, .csv:
            return context(document, text: decodeText(data), data: nil, mediaType: nil)
        case .pdf:
            return context(document, text: "PDF는 Claude document 입력으로 함께 전송됨.", data: data, mediaType: "application/pdf")
        case .image:
            return context(document, text: "이미지는 Claude vision 입력으로 함께 전송됨.", data: data, mediaType: imageMediaType(document.url))
        case .hwpx:
            return context(document, text: try extractHWPXText(document.url), data: nil, mediaType: nil)
        case .docx:
            return context(document, text: try extractDOCXText(document.url), data: nil, mediaType: nil)
        case .xlsx:
            return context(document, text: try extractXLSXText(document.url), data: nil, mediaType: nil)
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
        case "heic": "image/heic"
        default: "image/png"
        }
    }

    private func archive(_ url: URL) throws -> Archive {
        guard let archive = Archive(url: url, accessMode: .read) else {
            throw NSError(domain: "LocalFileExtractor", code: 1, userInfo: [NSLocalizedDescriptionKey: "ZIP 기반 파일을 열 수 없습니다: \(url.lastPathComponent)"])
        }
        return archive
    }

    private func stringEntry(_ archive: Archive, _ path: String) throws -> String? {
        guard let entry = archive[path] else { return nil }
        var data = Data()
        _ = try archive.extract(entry) { data.append($0) }
        return decodeText(data)
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
            let preferred = [
                "main.xml",
                "document.xml",
                "Contents/section0.xml",
                "DataSets.xml",
                "Experiment.xml"
            ]
            let text = try extractZipText(archive, preferredNames: preferred)
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
