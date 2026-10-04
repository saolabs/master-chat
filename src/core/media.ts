export type MediaPayload = {
  kind: "image" | "audio";
  mimeType: string;
  data: string;
};
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export function allowedMediaSource(value: string) {
  try {
    const u = new URL(value);
    if (u.username || u.password) return false;
    if (u.protocol === "blob:")
      return ["https://www.facebook.com", "https://facebook.com"].includes(
        u.origin,
      );
    return (
      u.protocol === "https:" &&
      ["facebook.com", "fbcdn.net", "fbsbx.com"].some(
        (domain) => u.hostname === domain || u.hostname.endsWith("." + domain),
      ) &&
      (!u.port || u.port === "443")
    );
  } catch {
    return false;
  }
}
export async function boundedMedia(
  response: Response,
  kind: MediaPayload["kind"],
  signal?: AbortSignal,
): Promise<MediaPayload> {
  if (!response.ok) throw new Error("Không tải được tệp đính kèm Messenger.");
  const mimeType =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
    "";
  const accepted =
    kind === "image"
      ? /^image\/(png|jpeg|webp|gif)$/
      : /^audio\/(wav|x-wav|mpeg|mp3|ogg|aac|flac|webm|mp4|m4a|opus)$/;
  if (!accepted.test(mimeType))
    throw new Error("Định dạng tệp đính kèm chưa được hỗ trợ.");
  if (Number(response.headers.get("content-length")) > MAX_MEDIA_BYTES) {
    await response.body?.cancel();
    throw new Error("Tệp đính kèm vượt giới hạn 20 MB.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Tệp đính kèm rỗng.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MEDIA_BYTES)
        throw new Error("Tệp đính kèm vượt giới hạn 20 MB.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  if (!size) throw new Error("Tệp đính kèm rỗng.");
  return { kind, mimeType, data: Buffer.concat(chunks).toString("base64") };
}
// Runs only inside the matching Messenger WebContents, for page-owned blob URLs.
export async function readMediaBlob(source: string, kind: "image" | "audio") {
  const u = new URL(source);
  if (
    u.protocol !== "blob:" ||
    !["https://www.facebook.com", "https://facebook.com"].includes(u.origin)
  )
    throw new Error("Nguồn blob không được phép.");
  const response = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const mimeType =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
    "";
  if (
    !response.ok ||
    !(
      kind === "image"
        ? /^image\/(png|jpeg|webp|gif)$/
        : /^audio\/(wav|x-wav|mpeg|mp3|ogg|aac|flac|webm|mp4|m4a|opus)$/
    ).test(mimeType)
  )
    throw new Error("Không đọc được blob media.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Blob rỗng.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 20 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Media quá lớn.");
    }
    chunks.push(value);
  }
  let binary = "";
  for (const chunk of chunks)
    for (let i = 0; i < chunk.length; i += 8192)
      binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
  return { kind, mimeType, data: btoa(binary) };
}
