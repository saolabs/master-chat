import {
  withProviderKeys,
  providerHTTPError,
  type KeyOptions,
} from "./provider-keys.ts";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { providerURL, resolveModel } from "../src/core/ai-config.ts";
import { MAX_MEDIA_BYTES, type MediaPayload } from "../src/core/media.ts";
import type {
  AIConfig,
  ModelSelection,
  TranscriptionSettings,
} from "../src/core/types.ts";
const STT_MODEL = /whisper|transcrib/i;
function runtimeRoots() {
  const resources = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  return [
    ...(resources ? [path.join(resources, "speech")] : []),
    path.resolve(
      process.cwd(),
      "runtime/speech",
      `${process.platform}-${process.arch}`,
    ),
    path.resolve(
      typeof __dirname === "undefined"
        ? process.cwd()
        : path.join(__dirname, "../.."),
      "runtime/speech",
      `${process.platform}-${process.arch}`,
    ),
  ];
}
export function isTranscriptionModel(modelId: string) {
  return STT_MODEL.test(modelId);
}
export function transcriptionMode(
  settings?: TranscriptionSettings,
  override?: ModelSelection | null,
) {
  return settings?.mode ?? (override ? "provider" : "local");
}
export function validateTranscriptionSelection(
  config: AIConfig,
  selection: ModelSelection,
) {
  const resolved = resolveModel(
    { ...config, tasks: { ...config.tasks, reply: selection } },
    "reply",
  );
  if (
    ["google", "anthropic"].includes(resolved.provider.type) ||
    !isTranscriptionModel(selection.modelId)
  )
    throw new Error(
      "Chọn model chuyên phiên âm Whisper/transcription; model chat không nhận tệp âm thanh.",
    );
  return resolved;
}
function validateTranscript(text: unknown) {
  if (typeof text !== "string" || !text.trim() || text.length > 20000)
    throw new Error("Bản phiên âm rỗng hoặc quá dài; kiểm tra tin nhắn thoại.");
  return text.trim();
}
function languageCode(value?: string) {
  const code = value?.trim().toLowerCase() || "auto";
  if (!/^(auto|[a-z]{2,3})$/.test(code))
    throw new Error("Ngôn ngữ phiên âm cần mã như vi, en hoặc auto.");
  return code;
}
async function executablePath(configured: string | undefined, name: string) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const candidates = configured?.trim()
    ? [configured.trim()]
    : [
        ...runtimeRoots().map((root) => path.join(root, name + suffix)),
        path.join("/opt/homebrew/bin", name),
        path.join("/usr/local/bin", name),
        ...(process.env.PATH ?? "")
          .split(path.delimiter)
          .filter(Boolean)
          .map((dir) => path.join(dir, name + suffix)),
      ];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(
    `Chưa tìm thấy ${name}. Cài Whisper/FFmpeg trên máy hoặc đặt đường dẫn tại Cấu hình AI → Phiên âm.`,
  );
}
async function modelPath(configured?: string) {
  const candidates = configured?.trim()
    ? [configured.trim()]
    : [
        ...runtimeRoots().map((root) => path.join(root, "ggml-base.bin")),
        path.join(homedir(), ".cache/whisper/ggml-base.bin"),
        path.join(homedir(), ".local/share/whisper.cpp/models/ggml-base.bin"),
      ];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {}
  }
  throw new Error(
    "Chưa có model Whisper local. Chọn tệp ggml đa ngôn ngữ trong Cấu hình AI → Phiên âm (ví dụ ggml-base.bin).",
  );
}
export function runTranscriptionProcess(
  executable: string,
  args: string[],
  timeout: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        shell: false,
        windowsHide: true,
        timeout,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        signal,
      },
      (error) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new Error("Phiên âm đã bị dừng."));
          return;
        }
        if (error) {
          reject(
            new Error(
              "Không chạy được bước chuyển đổi/phiên âm âm thanh. Kiểm tra công cụ, model và giới hạn 10 phút.",
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
}
export async function transcribeLocalAudio(
  media: MediaPayload,
  settings?: TranscriptionSettings,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const language = languageCode(settings?.language);
  const executable = await executablePath(settings?.executable, "whisper-cli");
  const ffmpeg = await executablePath(settings?.ffmpegPath, "ffmpeg");
  const model = await modelPath(settings?.modelPath);
  const directory = await mkdtemp(path.join(tmpdir(), "master-chat-stt-"));
  try {
    await chmod(directory, 0o700);
    const input = path.join(directory, "voice.audio"),
      wav = path.join(directory, "voice.wav"),
      output = path.join(directory, "transcript");
    await writeFile(input, Buffer.from(media.data, "base64"), { mode: 0o600 });
    // Decode on the machine; restricted protocols/demuxers prevent an audio container from opening a URL/playlist.
    await runTranscriptionProcess(
      ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,mp3,wav,ogg,flac,aac,matroska,webm",
        "-i",
        input,
        "-map",
        "0:a:0",
        "-vn",
        "-t",
        "601",
        "-fs",
        "19232044",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wav,
      ],
      60000,
      signal,
    );
    await chmod(wav, 0o600);
    const size = (await stat(wav)).size;
    if (size <= 44 || size > 19200444)
      throw new Error(
        "Tin nhắn thoại rỗng hoặc dài hơn giới hạn phiên âm local 10 phút.",
      );
    await runTranscriptionProcess(
      executable,
      [
        "-m",
        model,
        "-f",
        wav,
        "-l",
        language,
        "-otxt",
        "-of",
        output,
        "-np",
        "-nt",
      ],
      300000,
      signal,
    );
    signal?.throwIfAborted();
    if ((await stat(output + ".txt")).size > 80000)
      throw new Error("Bản phiên âm quá dài.");
    return validateTranscript(await readFile(output + ".txt", "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function transcribeWithProvider(
  config: AIConfig,
  media: MediaPayload,
  selection: ModelSelection,
  language: string,
  signal?: AbortSignal,
  options?: KeyOptions,
) {
  const { provider } = validateTranscriptionSelection(config, selection);
  return withProviderKeys(
    provider,
    (selected) =>
      transcribeWithKey(
        {
          ...config,
          providers: config.providers.map((p) =>
            p.id === selected.id ? selected : p,
          ),
        },
        media,
        selection,
        language,
        signal,
      ),
    signal,
    options,
  );
}
async function transcribeWithKey(
  config: AIConfig,
  media: MediaPayload,
  selection: ModelSelection,
  language: string,
  signal?: AbortSignal,
) {
  const { provider } = validateTranscriptionSelection(config, selection);
  const base = providerURL(provider, provider.allowRemote)
    .toString()
    .replace(/\/$/, "");
  const form = new FormData();
  form.set("model", selection.modelId);
  form.set("response_format", "json");
  if (language !== "auto") form.set("language", language);
  const extension = media.mimeType
    .split("/")[1]
    .replace("mpeg", "mp3")
    .replace("x-wav", "wav")
    .replace("mp4", "m4a");
  form.set(
    "file",
    new Blob([Buffer.from(media.data, "base64")], { type: media.mimeType }),
    `voice.${extension}`,
  );
  let response: Response;
  try {
    response = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      redirect: "error",
      headers: provider.apiKey
        ? { Authorization: `Bearer ${provider.apiKey}` }
        : {},
      body: form,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw Object.assign(new Error("Không kết nối được dịch vụ phiên âm."), {
      retryKey: true,
    });
  }
  if (!response.ok)
    throw await providerHTTPError(
      response,
      `Phiên âm trả HTTP ${response.status}.`,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Dịch vụ phiên âm trả nội dung rỗng.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256000)
        throw new Error("Dịch vụ phiên âm trả nội dung quá dài.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  let result: { text?: unknown };
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Dịch vụ phiên âm trả JSON không hợp lệ.");
  }
  return validateTranscript(result.text);
}
export async function transcribeAudio(
  config: AIConfig,
  media: MediaPayload,
  override?: ModelSelection | null,
  signal?: AbortSignal,
  settings?: TranscriptionSettings,
  options?: KeyOptions,
) {
  signal?.throwIfAborted();
  if (
    media.kind !== "audio" ||
    !/^audio\/(wav|x-wav|mpeg|mp3|ogg|aac|flac|webm|mp4|m4a|opus)$/.test(
      media.mimeType,
    )
  )
    throw new Error("Định dạng âm thanh chưa được hỗ trợ.");
  const bytes = Buffer.from(media.data, "base64").length;
  if (!bytes || bytes > MAX_MEDIA_BYTES)
    throw new Error("Âm thanh rỗng hoặc vượt 20 MB.");
  const language = languageCode(settings?.language);
  if (transcriptionMode(settings, override) === "provider") {
    if (!override)
      throw new Error("Chọn model chuyên phiên âm tại Cấu hình AI → Phiên âm.");
    return transcribeWithProvider(
      config,
      media,
      override,
      language,
      signal,
      options,
    );
  }
  // Reuse an existing local STT service only, never the default cloud/chat model.
  if (!settings?.executable && !settings?.modelPath && !settings?.ffmpegPath) {
    for (const p of config.providers.filter(
      (p) => p.enabled && !["google", "anthropic"].includes(p.type),
    )) {
      let local = false;
      try {
        providerURL(p, false);
        local = true;
      } catch {}
      const modelId = p.models.find(isTranscriptionModel);
      if (local && modelId)
        return transcribeWithProvider(
          config,
          media,
          { providerId: p.id, modelId },
          language,
          signal,
          options,
        );
    }
  }
  return transcribeLocalAudio(media, settings, signal);
}
