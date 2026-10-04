import path from "node:path";
import { open } from "node:fs/promises";
import WordExtractor from "word-extractor";
import { convert } from "html-to-text";
import {
  MAX_DOCUMENT_FILES,
  MAX_DOCUMENT_TEXT,
} from "../src/core/knowledge.ts";
import type { DocumentImport, DocumentUpload } from "../src/core/types.ts";

export const DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "html",
  "htm",
  "txt",
  "md",
  "markdown",
];
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_BATCH_BYTES = 100 * 1024 * 1024;

function decodeText(data: Uint8Array) {
  const encoding =
    data[0] === 0xff && data[1] === 0xfe
      ? "utf-16le"
      : data[0] === 0xfe && data[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch {
    throw new Error(
      "Không đọc được mã hóa văn bản. Hãy lưu file dưới dạng UTF-8.",
    );
  }
}

export async function extractDocument({
  name,
  data,
}: DocumentUpload): Promise<DocumentImport> {
  const fileName = path.basename(name),
    extension = path.extname(fileName).slice(1).toLowerCase();
  try {
    if (!DOCUMENT_EXTENSIONS.includes(extension))
      throw new Error("Định dạng chưa được hỗ trợ.");
    if (data.byteLength > MAX_DOCUMENT_BYTES)
      throw new Error("File vượt quá giới hạn 20 MB.");
    let text: string;
    if (extension === "pdf") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = getDocument({
        data: Uint8Array.from(data),
        useSystemFonts: true,
        verbosity: 0,
      });
      try {
        const document = await task.promise;
        const pages: string[] = [];
        let length = 0;
        for (let n = 1; n <= document.numPages; n++) {
          const page = await document.getPage(n),
            content = await page.getTextContent();
          const pageText = content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("");
          length += pageText.length;
          if (length > MAX_DOCUMENT_TEXT)
            throw new Error(
              "Nội dung vượt quá 100.000 ký tự. Hãy chia nhỏ tài liệu.",
            );
          pages.push(pageText);
          page.cleanup();
        }
        text = pages.join("\n\n");
      } finally {
        await task.destroy();
      }
    } else if (extension === "doc" || extension === "docx") {
      const document = await new WordExtractor().extract(Buffer.from(data));
      text = [
        document.getBody(),
        document.getFootnotes(),
        document.getEndnotes(),
        document.getTextboxes({ includeHeadersAndFooters: false }),
      ]
        .filter(Boolean)
        .join("\n\n");
    } else {
      text = decodeText(data);
      if (extension === "html" || extension === "htm")
        text = convert(text, {
          wordwrap: false,
          selectors: [
            { selector: "script", format: "skip" },
            { selector: "style", format: "skip" },
            { selector: "head", format: "skip" },
            { selector: "noscript", format: "skip" },
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
          ],
        });
    }
    text = text
      .replace(/\r\n?/g, "\n")
      .replace(/\u0000/g, "")
      .trim();
    if (!text)
      throw new Error(
        extension === "pdf"
          ? "PDF không có văn bản trích xuất được. Nếu là bản scan, hãy OCR trước khi nhập."
          : "Tài liệu không có nội dung văn bản.",
      );
    if (text.length > MAX_DOCUMENT_TEXT)
      throw new Error(
        "Nội dung vượt quá 100.000 ký tự. Hãy chia nhỏ tài liệu.",
      );
    return {
      fileName,
      title: path.basename(fileName, path.extname(fileName)).slice(0, 200),
      text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      fileName,
      error: /password/i.test(message)
        ? "Tài liệu có mật khẩu. Hãy mở khóa file trước khi nhập."
        : message,
    };
  }
}

export async function readDocumentFiles(
  paths: string[],
): Promise<DocumentImport[]> {
  if (paths.length > MAX_DOCUMENT_FILES)
    throw new Error("Mỗi lần chỉ nhập tối đa 30 file.");
  const results: DocumentImport[] = [];
  let total = 0;
  for (const filePath of paths) {
    let file;
    try {
      file = await open(filePath, "r");
      const info = await file.stat();
      if (!info.isFile())
        throw new Error("Đường dẫn không phải file tài liệu.");
      if (info.size > MAX_DOCUMENT_BYTES)
        throw new Error("File vượt quá giới hạn 20 MB.");
      total += info.size;
      if (total > MAX_BATCH_BYTES)
        throw new Error(
          "Tổng dung lượng vượt quá 100 MB. Hãy nhập thành nhiều đợt.",
        );
      // Read at most the limit plus one byte, even if the file grows after stat.
      const data = Buffer.alloc(info.size + 1);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await file.read(
          data,
          offset,
          data.length - offset,
          offset,
        );
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > info.size)
        throw new Error(
          "File đã thay đổi khi đang đọc. Hãy chọn lại tài liệu.",
        );
      results.push(
        await extractDocument({
          name: filePath,
          data: data.subarray(0, offset),
        }),
      );
    } catch (error) {
      results.push({
        fileName: path.basename(filePath),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await file?.close();
    }
  }
  return results;
}

export async function readDocumentUploads(files: DocumentUpload[]) {
  if (files.length > MAX_DOCUMENT_FILES)
    throw new Error("Mỗi lần chỉ nhập tối đa 30 file.");
  if (files.reduce((sum, f) => sum + f.data.byteLength, 0) > MAX_BATCH_BYTES)
    throw new Error("Tổng dung lượng vượt quá 100 MB.");
  const results: DocumentImport[] = [];
  for (const file of files) results.push(await extractDocument(file));
  return results;
}
