import Foundation
import ZIPFoundation

struct DOCXExporter {
    func writeReport(title: String, bodyMarkdown: String, fontFace: FontFace = .malgunGothic) throws -> URL {
        let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let out = docs.appendingPathComponent("\(safeFilename(title))-\(timestamp()).docx")
        if FileManager.default.fileExists(atPath: out.path) {
            try FileManager.default.removeItem(at: out)
        }

        guard let archive = Archive(url: out, accessMode: .create) else {
            throw NSError(domain: "DOCXExporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "DOCX 파일을 만들 수 없습니다."])
        }

        try add("[Content_Types].xml", contentTypesXML, to: archive)
        try add("_rels/.rels", packageRelsXML, to: archive)
        try add("word/document.xml", documentXML(title: title, markdown: bodyMarkdown), to: archive)
        try add("word/styles.xml", stylesXML(fontFace: fontFace), to: archive)
        try add("word/_rels/document.xml.rels", documentRelsXML, to: archive)
        return out
    }

    private func add(_ path: String, _ text: String, to archive: Archive) throws {
        let data = Data(text.utf8)
        try archive.addEntry(
            with: path,
            type: .file,
            uncompressedSize: UInt32(data.count),
            compressionMethod: .deflate
        ) { position, size in
            data.subdata(in: Int(position)..<Int(position) + size)
        }
    }

    private func documentXML(title: String, markdown: String) -> String {
        let paragraphs = makeParagraphs(title: title, markdown: markdown)
        return """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>\(paragraphs)<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>
        """
    }

    private func makeParagraphs(title: String, markdown: String) -> String {
        var xml = paragraph(title, style: "Title")
        let lines = markdown
            .replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n")

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                xml += paragraph(" ", style: "Body")
            } else if trimmed.hasPrefix("#") {
                let heading = trimmed.replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
                xml += paragraph(heading, style: "Heading")
            } else if trimmed.contains("|") {
                xml += paragraph(cleanMarkdown(trimmed).replacingOccurrences(of: "|", with: "\t"), style: "Body")
            } else {
                xml += paragraph(cleanMarkdown(trimmed), style: "Body")
            }
        }
        return xml
    }

    private func paragraph(_ text: String, style: String) -> String {
        """
        <w:p><w:pPr><w:pStyle w:val="\(style)"/></w:pPr><w:r><w:t xml:space="preserve">\(TextUtilities.escapeXML(text))</w:t></w:r></w:p>
        """
    }

    private func cleanMarkdown(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"^\s*[-*]\s+"#, with: "• ", options: .regularExpression)
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

    private var contentTypesXML: String {
        """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>
        """
    }

    private var packageRelsXML: String {
        """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>
        """
    }

    private var documentRelsXML: String {
        """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
        """
    }

    private func stylesXML(fontFace: FontFace) -> String {
        let font = TextUtilities.escapeXML(fontFace.documentName)
        return """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/><w:rPr><w:rFonts w:ascii="\(font)" w:hAnsi="\(font)" w:eastAsia="\(font)"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="\(font)" w:hAnsi="\(font)" w:eastAsia="\(font)"/><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="Heading"/><w:pPr><w:spacing w:before="180" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="\(font)" w:hAnsi="\(font)" w:eastAsia="\(font)"/><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>
        """
    }
}
