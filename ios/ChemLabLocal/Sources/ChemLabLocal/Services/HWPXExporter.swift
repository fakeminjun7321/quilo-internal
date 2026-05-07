import Foundation
import ZIPFoundation

struct HWPXExporter {
    func writeReport(title: String, bodyMarkdown: String) throws -> URL {
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
        var data = Data()
        _ = try archive.extract(section) { data.append($0) }
        guard var xml = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "HWPXExporter", code: 4, userInfo: [NSLocalizedDescriptionKey: "section XML 인코딩 오류"])
        }

        let body = makeParagraphs(title: title, markdown: bodyMarkdown)
        if let range = xml.range(of: "</hs:sec>", options: .backwards) {
            xml.replaceSubrange(range, with: body + "</hs:sec>")
        } else {
            xml += body
        }

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
        var result = paragraph(title, charPr: 13, paraPr: 14)
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                result += paragraph(" ", charPr: 21, paraPr: 18)
            } else if trimmed.hasPrefix("#") {
                let heading = trimmed.replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
                result += paragraph(heading, charPr: 20, paraPr: 19)
            } else {
                result += paragraph(cleanMarkdown(trimmed), charPr: 21, paraPr: 18)
            }
        }
        return result
    }

    private func paragraph(_ text: String, charPr: Int, paraPr: Int) -> String {
        let id = Int.random(in: 100_000_000...2_000_000_000)
        return """
        <hp:p id="\(id)" paraPrIDRef="\(paraPr)" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="\(charPr)"><hp:t>\(TextUtilities.escapeXML(text))</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1100" textheight="1100" baseline="935" spacing="440" horzpos="0" horzsize="51024" flags="393216" /></hp:linesegarray></hp:p>
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
}
