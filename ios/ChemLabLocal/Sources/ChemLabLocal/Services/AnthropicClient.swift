import Foundation
import UIKit

struct AnthropicClient {
    static let defaultModel = "claude-opus-4-7"

    let apiKey: String
    let model: String

    static func apiModelName(for rawModel: String) -> String {
        let trimmed = rawModel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return defaultModel }

        let aliases: [String: String] = [
            // Let users type human-friendly names while still sending API slugs.
            "opus-4-7": "claude-opus-4-7",
            "opus 4.7": "claude-opus-4-7",
            "opus-4-5": "claude-opus-4-5",
            "opus 4.5": "claude-opus-4-5",
            "sonnet-4-6": "claude-sonnet-4-6",
            "sonnet 4.6": "claude-sonnet-4-6",
            "sonnet-4-5": "claude-sonnet-4-5",
            "sonnet 4.5": "claude-sonnet-4-5"
        ]
        return aliases[trimmed.lowercased()] ?? trimmed
    }

    func generateReport(
        prompt: String,
        attachments: [ExtractedFileContext],
        maxTokens: Int = 12000,
        status: (@MainActor (String) -> Void)? = nil
    ) async throws -> String {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.setValue(apiKey.trimmingCharacters(in: .whitespacesAndNewlines), forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 240

        let apiModel = Self.apiModelName(for: model)
        await status?("Claude API 모델: \(apiModel)")

        var content: [[String: Any]] = []
        for attachment in attachments {
            guard let data = attachment.attachmentData, let mediaType = attachment.mediaType else { continue }
            if mediaType == "application/pdf" {
                guard data.count <= 28_000_000 else {
                    throw NSError(domain: "AnthropicClient", code: 413, userInfo: [NSLocalizedDescriptionKey: "\(attachment.document.filename)이 너무 큽니다. PDF는 28MB 이하 파일로 줄여서 넣어주세요."])
                }
                content.append([
                    "type": "document",
                    "source": [
                        "type": "base64",
                        "media_type": mediaType,
                        "data": data.base64EncodedString()
                    ]
                ])
            } else if mediaType.hasPrefix("image/") {
                let prepared = try preparedImageData(data, mediaType: mediaType, filename: attachment.document.filename)
                content.append([
                    "type": "image",
                    "source": [
                        "type": "base64",
                        "media_type": prepared.mediaType,
                        "data": prepared.data.base64EncodedString()
                    ]
                ])
            }
        }
        content.append(["type": "text", "text": prompt])

        let body: [String: Any] = [
            "model": apiModel,
            "max_tokens": maxTokens,
            "messages": [
                ["role": "user", "content": content]
            ]
        ]
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let bodySize = ByteCountFormatter.string(fromByteCount: Int64(bodyData.count), countStyle: .file)
        await status?("Claude 요청 본문 구성 완료: \(bodySize), 첨부 블록 \(max(content.count - 1, 0))개")
        guard bodyData.count <= 31_000_000 else {
            throw NSError(
                domain: "AnthropicClient",
                code: 413,
                userInfo: [NSLocalizedDescriptionKey: "Claude 요청이 너무 큽니다(\(bodySize)). Anthropic Messages API는 전체 JSON 요청이 32MB 이하여야 합니다. PDF/사진을 줄이거나 일부 첨부를 빼고 다시 시도하세요."]
            )
        }
        request.httpBody = bodyData

        let started = Date()
        await status?("Claude API 전송 중...")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "AnthropicClient", code: 0, userInfo: [NSLocalizedDescriptionKey: "응답을 해석할 수 없습니다."])
        }
        let elapsed = Date().timeIntervalSince(started)
        await status?("Claude 응답 수신: HTTP \(http.statusCode), \(String(format: "%.1f", elapsed))초")
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "AnthropicClient", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "Claude API 오류 \(http.statusCode): \(apiErrorMessage(from: data))"])
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let blocks = json?["content"] as? [[String: Any]] ?? []
        let text = blocks.compactMap { block -> String? in
            guard block["type"] as? String == "text" else { return nil }
            return block["text"] as? String
        }.joined(separator: "\n")
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw NSError(domain: "AnthropicClient", code: 1, userInfo: [NSLocalizedDescriptionKey: "Claude 응답에 텍스트가 없습니다."])
        }
        return text
    }

    private func preparedImageData(_ data: Data, mediaType: String, filename: String) throws -> (data: Data, mediaType: String) {
        let maxBytes = 4_800_000
        let acceptedMediaTypes: Set<String> = ["image/jpeg", "image/png", "image/gif", "image/webp"]
        let needsReencoding = !acceptedMediaTypes.contains(mediaType)
        if data.count <= maxBytes && !needsReencoding {
            return (data, mediaType)
        }

        guard let image = UIImage(data: data) else {
            let reason = needsReencoding ? "Claude가 바로 받을 수 있는 이미지 형식이 아닙니다." : "5MB보다 크고 자동 압축할 수 없습니다."
            throw NSError(domain: "AnthropicClient", code: 413, userInfo: [NSLocalizedDescriptionKey: "\(filename)은 \(reason) JPG/PNG로 저장하거나 해상도를 낮춰 다시 넣어주세요."])
        }

        var maxDimension: CGFloat = 2200
        var quality: CGFloat = 0.82
        var smallest: Data?
        for _ in 0..<8 {
            let resized = image.resized(maxDimension: maxDimension)
            guard let jpeg = resized.jpegData(compressionQuality: quality) else { break }
            smallest = jpeg
            if jpeg.count <= maxBytes {
                return (jpeg, "image/jpeg")
            }
            maxDimension *= 0.82
            quality *= 0.86
        }

        if let smallest, smallest.count <= 8_000_000 {
            return (smallest, "image/jpeg")
        }
        throw NSError(domain: "AnthropicClient", code: 413, userInfo: [NSLocalizedDescriptionKey: "\(filename)을 Claude 이미지 제한에 맞게 줄이지 못했습니다. 사진을 잘라내거나 해상도를 낮춰주세요."])
    }

    private func apiErrorMessage(from data: Data) -> String {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = json["error"] as? [String: Any]
        else {
            return String(data: data, encoding: .utf8) ?? "알 수 없는 오류"
        }
        return error["message"] as? String ?? String(data: data, encoding: .utf8) ?? "알 수 없는 오류"
    }
}

private extension UIImage {
    func resized(maxDimension: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxDimension, longest > 0 else { return self }
        let scale = maxDimension / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
