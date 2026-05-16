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
        static let boldCharPr = 5
        static let subscriptCharPr = 20
        static let superscriptCharPr = 21
        static let tableBorderFill = 3
        static let tableWidth = 51_024
        static let tableCellHeight = 2_600
    }

    private struct InlineRun {
        let text: String
        let charPr: Int
    }

    func writeReport(
        title: String,
        bodyMarkdown: String,
        kind: ReportKind,
        fontFace: FontFace = .malgunGothic
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
        try updateHeaderForLocalExport(in: archive, fontFace: fontFace)
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
            inlineRuns(for: title, baseCharPr: TemplateStyle.titleCharPr),
            charPr: TemplateStyle.titleCharPr,
            paraPr: TemplateStyle.titleParaPr
        )
        var index = 0
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                result += paragraph(
                    [InlineRun(text: " ", charPr: TemplateStyle.bodyCharPr)],
                    charPr: TemplateStyle.bodyCharPr,
                    paraPr: TemplateStyle.bodyParaPr
                )
                index += 1
            } else if isMarkdownTableStart(lines, at: index) {
                let parsed = parseMarkdownTable(lines, start: index)
                result += table(parsed.rows)
                index = parsed.nextIndex
            } else if trimmed.hasPrefix("#") {
                let heading = trimmed.replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
                result += paragraph(
                    inlineRuns(for: cleanMarkdown(heading), baseCharPr: TemplateStyle.headingCharPr),
                    charPr: TemplateStyle.headingCharPr,
                    paraPr: TemplateStyle.headingParaPr
                )
                index += 1
            } else {
                result += paragraph(
                    inlineRuns(for: cleanMarkdown(trimmed), baseCharPr: TemplateStyle.bodyCharPr),
                    charPr: TemplateStyle.bodyCharPr,
                    paraPr: TemplateStyle.bodyParaPr
                )
                index += 1
            }
        }
        return result
    }

    private func paragraph(_ runs: [InlineRun], charPr: Int, paraPr: Int) -> String {
        let id = Int.random(in: 100_000_000...2_000_000_000)
        let runsXML = runs.isEmpty
            ? runXML(InlineRun(text: " ", charPr: charPr))
            : runs.map { runXML($0) }.joined()
        return """
        <hp:p id="\(id)" paraPrIDRef="\(paraPr)" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">\(runsXML)<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1100" textheight="1100" baseline="935" spacing="440" horzpos="0" horzsize="51024" flags="393216" /></hp:linesegarray></hp:p>
        """
    }

    private func runXML(_ run: InlineRun) -> String {
        let safeText = TextUtilities.escapeXML(xmlSafeText(run.text.isEmpty ? " " : run.text))
        return #"<hp:run charPrIDRef="\#(run.charPr)"><hp:t>\#(safeText)</hp:t></hp:run>"#
    }

    private func table(_ rows: [[String]]) -> String {
        let normalizedRows = rows
            .map { $0.map { cleanMarkdown($0) } }
            .filter { !$0.allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
        guard let maxCols = normalizedRows.map(\.count).max(), maxCols > 0 else { return "" }

        let width = TemplateStyle.tableWidth
        let colWidth = max(2_400, width / maxCols)
        let rowHeight = TemplateStyle.tableCellHeight
        let tableHeight = rowHeight * normalizedRows.count
        var xml = """
        <hp:tbl id="\(Int.random(in: 100_000_000...2_000_000_000))" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="\(normalizedRows.count)" colCnt="\(maxCols)" cellSpacing="0" borderFillIDRef="\(TemplateStyle.tableBorderFill)" noAdjust="0"><hp:sz width="\(width)" widthRelTo="ABSOLUTE" height="\(tableHeight)" heightRelTo="ABSOLUTE" protect="0" /><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0" /><hp:outMargin left="0" right="0" top="160" bottom="160" /><hp:inMargin left="0" right="0" top="0" bottom="0" />
        """

        for (rowIndex, row) in normalizedRows.enumerated() {
            xml += "<hp:tr>"
            for colIndex in 0..<maxCols {
                let text = colIndex < row.count ? row[colIndex] : ""
                let cellCharPr = rowIndex == 0 ? TemplateStyle.boldCharPr : TemplateStyle.bodyCharPr
                let runs = inlineRuns(for: text, baseCharPr: cellCharPr)
                xml += """
                <hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="\(TemplateStyle.tableBorderFill)"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">\(paragraph(runs, charPr: cellCharPr, paraPr: TemplateStyle.bodyParaPr))</hp:subList><hp:cellAddr colAddr="\(colIndex)" rowAddr="\(rowIndex)" /><hp:cellSpan colSpan="1" rowSpan="1" /><hp:cellSz width="\(colWidth)" height="\(rowHeight)" /><hp:cellMargin left="180" right="180" top="100" bottom="100" /></hp:tc>
                """
            }
            xml += "</hp:tr>"
        }
        xml += "</hp:tbl>"
        return xml
    }

    private func isMarkdownTableStart(_ lines: [String], at index: Int) -> Bool {
        guard index + 1 < lines.count else { return false }
        let current = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
        let next = lines[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
        return current.contains("|") && isMarkdownTableSeparator(next)
    }

    private func isMarkdownTableSeparator(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("|") else { return false }
        let scalars = trimmed.unicodeScalars.filter { !$0.properties.isWhitespace && $0.value != 0x7C }
        return !scalars.isEmpty && scalars.allSatisfy { $0.value == 0x2D || $0.value == 0x3A }
    }

    private func parseMarkdownTable(_ lines: [String], start: Int) -> (rows: [[String]], nextIndex: Int) {
        var rows: [[String]] = [parseMarkdownTableRow(lines[start])]
        var index = start + 2
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.contains("|"), !isMarkdownTableSeparator(trimmed), !trimmed.isEmpty else { break }
            rows.append(parseMarkdownTableRow(trimmed))
            index += 1
        }
        return (rows, index)
    }

    private func parseMarkdownTableRow(_ line: String) -> [String] {
        var text = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("|") { text.removeFirst() }
        if text.hasSuffix("|") { text.removeLast() }
        return text
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    private func cleanMarkdown(_ text: String) -> String {
        normalizeEquationMarkers(text)
            .replacingOccurrences(of: #"^\s*[-*]\s+"#, with: "• ", options: .regularExpression)
            .replacingOccurrences(of: #"\*\*([^*]+)\*\*"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\*([^*\n]+)\*"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "`", with: "")
            .replacingOccurrences(of: "->", with: "→")
    }

    private func plainText(from markdown: String) -> String {
        unicodeMathText(cleanMarkdown(markdown))
            .replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
    }

    private func inlineRuns(for text: String, baseCharPr: Int) -> [InlineRun] {
        let cleaned = cleanMarkdown(text)
        let chars = Array(cleaned)
        var runs: [InlineRun] = []
        var buffer = ""
        var index = 0

        func flush(_ charPr: Int = baseCharPr) {
            guard !buffer.isEmpty else { return }
            runs.append(InlineRun(text: buffer, charPr: charPr))
            buffer = ""
        }

        while index < chars.count {
            let ch = chars[index]
            if (ch == "_" || ch == "^"), index + 1 < chars.count, chars[index + 1] == "{" {
                var end = index + 2
                var value = ""
                while end < chars.count, chars[end] != "}" {
                    value.append(chars[end])
                    end += 1
                }
                if end < chars.count, chars[end] == "}", !value.isEmpty {
                    flush()
                    runs.append(
                        InlineRun(
                            text: value,
                            charPr: ch == "_" ? TemplateStyle.subscriptCharPr : TemplateStyle.superscriptCharPr
                        )
                    )
                    index = end + 1
                    continue
                }
            }
            buffer.append(ch)
            index += 1
        }
        flush()
        return runs.isEmpty ? [InlineRun(text: " ", charPr: baseCharPr)] : runs
    }

    private func normalizeEquationMarkers(_ text: String) -> String {
        var output = text
        for marker in ["{{EQ:", "{{EQN:"] {
            while let start = output.range(of: marker), let end = output[start.upperBound...].range(of: "}}") {
                let body = String(output[start.upperBound..<end.lowerBound])
                output.replaceSubrange(start.lowerBound..<end.upperBound, with: body)
            }
        }
        return output
    }

    private func unicodeMathText(_ text: String) -> String {
        let runs = inlineRuns(for: text, baseCharPr: TemplateStyle.bodyCharPr)
        return runs.map { run in
            if run.charPr == TemplateStyle.subscriptCharPr {
                return run.text.map { subscriptCharacter($0) }.joined()
            }
            if run.charPr == TemplateStyle.superscriptCharPr {
                return run.text.map { superscriptCharacter($0) }.joined()
            }
            return run.text
        }.joined()
    }

    private func subscriptCharacter(_ ch: Character) -> String {
        let map: [Character: String] = [
            "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
            "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
            "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
            "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ",
            "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ",
            "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ",
            "v": "ᵥ", "x": "ₓ"
        ]
        return map[ch] ?? String(ch)
    }

    private func superscriptCharacter(_ ch: Character) -> String {
        let map: [Character: String] = [
            "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
            "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
            "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
            "i": "ⁱ", "n": "ⁿ"
        ]
        return map[ch] ?? String(ch)
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

    private func updateHeaderForLocalExport(in archive: Archive, fontFace: FontFace) throws {
        guard let header = archive["Contents/header.xml"] else {
            throw NSError(domain: "HWPXExporter", code: 5, userInfo: [NSLocalizedDescriptionKey: "header.xml을 찾을 수 없습니다."])
        }
        var data = Data()
        _ = try archive.extract(header) { data.append($0) }
        guard var xml = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "HWPXExporter", code: 6, userInfo: [NSLocalizedDescriptionKey: "header.xml 인코딩 오류"])
        }

        xml = applyFontFace(fontFace, toHeaderXML: xml)
        xml = ensureLocalCharProperties(in: xml)
        try validateXML(xml, path: "Contents/header.xml")

        try archive.remove(header)
        try addData(Data(xml.utf8), path: "Contents/header.xml", to: archive)
    }

    private func applyFontFace(_ fontFace: FontFace, toHeaderXML xml: String) -> String {
        let face = TextUtilities.escapeXML(hwpFaceName(for: fontFace))
        // Generated paragraphs use font IDs 0 and 1 through existing charPr
        // entries. Rebind those IDs so the UI font picker actually affects
        // HWPX output instead of leaving the old template fonts in place.
        return xml.replacingOccurrences(
            of: #"(<hh:font id="(?:0|1)" face=")[^"]+(")"#,
            with: "$1\(face)$2",
            options: .regularExpression
        )
    }

    private func hwpFaceName(for fontFace: FontFace) -> String {
        switch fontFace {
        case .malgunGothic:
            "맑은 고딕"
        case .nanumGothic:
            "나눔고딕"
        case .nanumMyeongjo:
            "나눔명조"
        case .hamchoromBatang:
            "함초롬바탕"
        }
    }

    private func ensureLocalCharProperties(in xml: String) -> String {
        var output = xml
        var appended = ""
        if !output.contains(#"<hh:charPr id="20""#) {
            appended += charPropertyXML(id: TemplateStyle.subscriptCharPr, height: 900, relSize: 65, offset: -18)
        }
        if !output.contains(#"<hh:charPr id="21""#) {
            appended += charPropertyXML(id: TemplateStyle.superscriptCharPr, height: 900, relSize: 65, offset: 35)
        }
        guard !appended.isEmpty, let insertRange = output.range(of: "</hh:charProperties>") else {
            return output
        }

        output.replaceSubrange(insertRange, with: appended + "</hh:charProperties>")
        let charCount = ids(in: output, element: "hh:charPr").count
        output = output.replacingOccurrences(
            of: #"<hh:charProperties itemCnt="\d+">"#,
            with: #"<hh:charProperties itemCnt="\#(charCount)">"#,
            options: .regularExpression
        )
        return output
    }

    private func charPropertyXML(id: Int, height: Int, relSize: Int, offset: Int) -> String {
        """
        <hh:charPr id="\(id)" height="\(height)" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="\(relSize)" latin="\(relSize)" hanja="\(relSize)" japanese="\(relSize)" other="\(relSize)" symbol="\(relSize)" user="\(relSize)"/><hh:offset hangul="\(offset)" latin="\(offset)" hanja="\(offset)" japanese="\(offset)" other="\(offset)" symbol="\(offset)" user="\(offset)"/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>
        """
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
        let neededChars = [
            TemplateStyle.titleCharPr,
            TemplateStyle.headingCharPr,
            TemplateStyle.bodyCharPr,
            TemplateStyle.boldCharPr,
            TemplateStyle.subscriptCharPr,
            TemplateStyle.superscriptCharPr
        ]
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
