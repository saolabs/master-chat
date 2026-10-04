import type {
  AIConfig,
  AIProvider,
  ModelSelection,
  Role,
} from "../src/core/types.ts";
import { providerURL, resolveModel } from "../src/core/ai-config.ts";
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
function headers(p: AIProvider): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(p.type === "anthropic"
      ? { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" }
      : p.type === "google"
        ? { "x-goog-api-key": p.apiKey }
        : p.apiKey
          ? { Authorization: `Bearer ${p.apiKey}` }
          : {}),
  };
}
async function request(
  p: AIProvider,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const base = providerURL(p, p.allowRemote).toString().replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: headers(p),
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
        : AbortSignal.timeout(body ? 90_000 : 20_000),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(
      "Không kết nối được provider. Kiểm tra Base URL, server và mạng.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Provider trả HTTP ${response.status}${response.status === 401 || response.status === 403 ? " · Kiểm tra API key/quyền truy cập." : ""}`,
    );
  try {
    return await response.json();
  } catch {
    throw new Error("Provider trả JSON không hợp lệ.");
  }
}
export async function providerChat(
  p: AIProvider,
  selection: ModelSelection,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  if (!p.enabled) throw new Error("Provider đang tắt.");
  providerURL(p, p.allowRemote);
  let content: unknown;
  const max = selection.maxOutputTokens;
  if (p.type === "anthropic") {
    const data = await request(
      p,
      "messages",
      {
        model: selection.modelId,
        max_tokens: max ?? 2048,
        ...(selection.temperature !== undefined
          ? { temperature: selection.temperature }
          : {}),
        system: messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n"),
        messages: messages.filter((m) => m.role !== "system"),
      },
      signal,
    );
    content = data.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
  } else if (p.type === "google") {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => ({ text: m.content }));
    const data = await request(
      p,
      `models/${encodeURIComponent(selection.modelId)}:generateContent`,
      {
        ...(system.length ? { systemInstruction: { parts: system } } : {}),
        contents: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        generationConfig: {
          ...(selection.temperature !== undefined
            ? { temperature: selection.temperature }
            : {}),
          ...(max ? { maxOutputTokens: max } : {}),
        },
      },
      signal,
    );
    content = data.candidates?.[0]?.content?.parts
      ?.filter((p: any) => !p.thought)
      .map((p: any) => p.text ?? "")
      .join("");
  } else {
    const data = await request(
      p,
      "chat/completions",
      {
        model: selection.modelId,
        messages,
        stream: false,
        ...(selection.temperature !== undefined
          ? { temperature: selection.temperature }
          : {}),
        ...(max
          ? {
              [p.type === "openai" ? "max_completion_tokens" : "max_tokens"]:
                max,
            }
          : {}),
      },
      signal,
    );
    content = data.choices?.[0]?.message?.content;
  }
  if (
    typeof content !== "string" ||
    !content.trim() ||
    content.length > 100_000
  )
    throw new Error("AI trả nội dung rỗng hoặc quá dài.");
  return content.trim();
}
// Engine entry point: every remote request requires permission on the selected provider.
export async function localChat(
  config: AIConfig,
  role: Role,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const { provider, selection } = resolveModel(config, role);
  return providerChat(provider, selection, messages, signal);
}
export async function discoverModels(p: AIProvider): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams();
    if (p.type === "google") {
      params.set("pageSize", "1000");
      if (cursor) params.set("pageToken", cursor);
    }
    if (p.type === "anthropic") {
      params.set("limit", "1000");
      if (cursor) params.set("after_id", cursor);
    }
    const data = await request(p, `models${params.size ? `?${params}` : ""}`);
    const rows = Array.isArray(data) ? data : (data.data ?? data.models);
    if (!Array.isArray(rows))
      throw new Error("Provider không trả danh sách model hợp lệ.");
    for (const row of rows) {
      if (!row) continue;
      if (
        p.type === "google" &&
        !row.supportedGenerationMethods?.includes("generateContent")
      )
        continue;
      const id = typeof row === "string" ? row : (row.id ?? row.name);
      if (typeof id === "string" && id.trim())
        ids.push(p.type === "google" ? id.replace(/^models\//, "") : id.trim());
    }
    cursor =
      p.type === "google"
        ? data.nextPageToken
        : p.type === "anthropic" && data.has_more
          ? data.last_id
          : undefined;
    if (!cursor) break;
    if (page === 19) throw new Error("Catalog vượt giới hạn phân trang.");
  }
  if (!ids.length)
    throw new Error(
      "Provider chưa có model khả dụng. Với Ollama, hãy tải model trước.",
    );
  return [...new Set(ids)].sort();
}
