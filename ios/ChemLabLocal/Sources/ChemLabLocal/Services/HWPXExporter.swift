import Foundation
import ZIPFoundation

struct HWPXExporter {
    private enum TemplateStyle {
        // These IDs are defined in result-report-template.hwpx. Do not invent
        // new IDs here; Hangul can reject a document with dangling style refs.
        static let titleCharPr = 13
        static let titleParaPr = 14
        static let headingCharPr = 14
        static let headingParaPr = 14
        static let bodyCharPr = 18
        static let bodyParaPr = 14
    }

    func writeReport(
        title: String,
        bodyMarkdown: String,
        kind: ReportKind,
        fontFace _: FontFace = .malgunGothic
    ) throws -> URL {
        guard let template = Bundle.main.url(forResource: "result-report-template", withExtension: "hwpx") else {
            throw NSError(domain: "HWPXExporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "HWPX 템플릿을 찾을 수 없습니다."])
        }

        let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let out = docs.appendingPathComponent("\(safeFilename(title))-\(timestamp()).hwpx")
        if FileManager.default.fileExists(atPath: out.path) {
            try FileManager.default.removeItem(at: out)
        }
        try FileManager.default.copyItem(at: template, to: out)

        guard let archive = Archive(url: out, accessMode: .update) else {
            throw NSError(domain: "HWPXExporter", code: 2, userInfo: [NSLocalizedDescriptionKey: "출력 HWPX를 열 수 없습니다."])
        }

        guard let section = archive["Contents/section0.xml"] else {
            throw NSError(domain: "HWPXExporter", code: 3, userInfo: [NSLocalizedDescriptionKey: "section0.xml을 찾을 수 없습니다."])
        }
        try validateTemplateStyleReferences(in: archive)

        var data = Data()
        _ = try archive.extract(section) { data.append($0) }
        guard var xml = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "HWPXExporter", code: 4, userInfo: [NSLocalizedDescriptionKey: "section XML 인코딩 오류"])
        }

        if !kind.usesBundledBodyTemplate {
            xml = blankSectionXML(from: xml)
        }

        let body = makeParagraphs(title: title, markdown: bodyMarkdown)
        if let range = xml.range(of: "</hs:sec>", options: .backwards) {
            xml.replaceSubrange(range, with: body + "</hs:sec>")
        } else {
            xml += body
        }
        try validateXML(xml, path: "Contents/section0.xml")

        try archive.remove(section)
        try addData(Data(xml.utf8), path: "Contents/section0.xml", to: archive)

        let previewText = "\(title)\n\n\(plainText(from: bodyMarkdown))"
        if let preview = archive["Preview/PrvText.txt"] {
            try archive.remove(preview)
        }
        try addData(Data(previewText.utf8), path: "Preview/PrvText.txt", to: archive)

        return out
    }

    private func addData(_ data: Data, path: String, to archive: Archive) throws {
        try archive.addEntry(
            with: path,
            type: .file,
            uncompressedSize: UInt32(data.count),
            compressionMethod: .deflate
        ) { position, size in
            data.subdata(in: Int(position)..<Int(position) + size)
        }
    }

    private func makeParagraphs(title: String, markdown: String) -> String {
        let lines = markdown
            .replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n")
        var result = paragraph(
            title,
            charPr: TemplateStyle.titleCharPr,
            paraPr: TemplateStyle.titleParaPr
        )
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                result += paragraph(
                    " ",
                    charPr: TemplateStyle.bodyCharPr,
                    paraPr: TemplateStyle.bodyParaPr
                )
            } else if trimmed.hasPrefix("#") {
                let heading = trimmed.replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
                result += paragraph(
                    heading,
                    charPr: TemplateStyle.headingCharPr,
                    paraPr: TemplateStyle.headingParaPr
                )
            } else {
                result += paragraph(
                    cleanMarkdown(trimmed),
                    charPr: TemplateStyle.bodyCharPr,
                    paraPr: TemplateStyle.bodyParaPr
                )
            }
        }
        return result
    }

    private func paragraph(_ text: String, charPr: Int, paraPr: Int) -> String {
        let id = Int.random(in: 100_000_000...2_000_000_000)
        let safeText = TextUtilities.escapeXML(xmlSafeText(text))
        return """
        <hp:p id="\(id)" paraPrIDRef="\(paraPr)" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="\(charPr)"><hp:t>\(safeText)</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1100" textheight="1100" baseline="935" spacing="440" horzpos="0" horzsize="51024" flags="393216" /></hp:linesegarray></hp:p>
        """
    }

    private func cleanMarkdown(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"^\s*[-*]\s+"#, with: "• ", options: .regularExpression)
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "`", with: "")
    }

    private func plainText(from markdown: String) -> String {
        markdown
            .replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "`", with: "")
    }

    private func safeFilename(_ text: String) -> String {
        let invalid = CharacterSet(charactersIn: #"/\?%*|"<>"#)
        return text.components(separatedBy: invalid).joined(separator: "_")
    }

    private func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }

    private func blankSectionXML(from xml: String) -> String {
        guard
            let secStart = xml.range(of: "<hs:sec"),
            let openEnd = xml[secStart.upperBound...].range(of: ">"),
            let closeStart = xml.range(of: "</hs:sec>", options: .backwards)
        else {
            return xml
        }
        return String(xml[..<openEnd.upperBound]) + String(xml[closeStart.lowerBound...])
    }

    private func validateTemplateStyleReferences(in archive: Archive) throws {
        guard let header = archive["Contents/header.xml"] else {
            throw NSError(domain: "HWPXExporter", code: 5, userInfo: [NSLocalizedDescriptionKey: "header.xml을 찾을 수 없습니다."])
        }
        var data = Data()
        _ = try archive.extract(header) { data.append($0) }
        guard let xml = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "HWPXExporter", code: 6, userInfo: [NSLocalizedDescriptionKey: "header.xml 인코딩 오류"])
        }

        let charIDs = ids(in: xml, element: "hh:charPr")
        let paraIDs = ids(in: xml, element: "hh:paraPr")
        let neededChars = [TemplateStyle.titleCharPr, TemplateStyle.headingCharPr, TemplateStyle.bodyCharPr]
        let neededParas = [TemplateStyle.titleParaPr, TemplateStyle.headingParaPr, TemplateStyle.bodyParaPr]
        let missingChars = neededChars.filter { !charIDs.contains($0) }
        let missingParas = neededParas.filter { !paraIDs.contains($0) }
        guard missingChars.isEmpty, missingParas.isEmpty else {
            throw NSError(
                domain: "HWPXExporter",
                code: 7,
                userInfo: [NSLocalizedDescriptionKey: "HWPX 템플릿 서식 ID가 맞지 않습니다. charPr 누락: \(missingChars), paraPr 누락: \(missingParas)"]
            )
        }
    }

    private func ids(in xml: String, element: String) -> Set<Int> {
        let pattern = #"<\#(element)\b[^>]*\bid="(\d+)""#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = xml as NSString
        return Set(
            regex.matches(in: xml, range: NSRange(location: 0, length: ns.length)).compactMap {
                Int(ns.substring(with: $0.range(at: 1)))
            }
        )
    }

    private func validateXML(_ xml: String, path: String) throws {
        let parser = XMLParser(data: Data(xml.utf8))
        guard parser.parse() else {
            let message = parser.parserError?.localizedDescription ?? "알 수 없는 XML 오류"
            throw NSError(
                domain: "HWPXExporter",
                code: 8,
                userInfo: [NSLocalizedDescriptionKey: "\(path) XML 생성 오류: \(message)"]
            )
        }
    }

    private func xmlSafeText(_ text: String) -> String {
        String(text.unicodeScalars.map { scalar in
            switch scalar.value {
            case 0x9, 0xA, 0xD,
                 0x20...0xD7FF,
                 0xE000...0xFFFD,
                 0x10000...0x10FFFF:
                Character(scalar)
            default:
                " "
            }
        })
    }
}

private extension ReportKind {
    var usesBundledBodyTemplate: Bool {
        self == .physicsResult
    }
}
