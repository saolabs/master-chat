import type { DOMProfile } from "./types.ts";
// This source is executed inside the remote Chromium renderer without Node/preload privileges.
export function readDOM(profile: DOMProfile) {
  const active = document.querySelector(profile.threadSelector);
  const threadId = active?.getAttribute(profile.threadIdAttribute) ?? null;
  const messages = active
    ? Array.from(active.querySelectorAll(profile.messageSelector))
        .slice(-59)
        .map((el) => {
          const stamp = el.getAttribute(profile.timestampAttribute);
          const parsed =
            stamp && /^\d{13}$/.test(stamp)
              ? Number(stamp)
              : stamp &&
                  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(stamp)
                ? Date.parse(stamp)
                : NaN;
          const direction = el.getAttribute(profile.directionAttribute);
          return {
            id: el.getAttribute(profile.messageIdAttribute),
            text:
              el.querySelector(profile.textSelector)?.textContent?.trim() ?? "",
            direction:
              direction === profile.incomingValue
                ? "incoming"
                : direction === profile.outgoingValue
                  ? "outgoing"
                  : "system",
            timestamp: Number.isFinite(parsed) ? parsed : null,
          };
        })
    : [];
  return {
    threadId,
    messages,
    composerPresent: Boolean(document.querySelector(profile.composerSelector)),
    invalid: messages.filter((m) => !m.id || !m.text || m.timestamp === null)
      .length,
  };
}
export function readScript(profile: DOMProfile): string {
  return `(${readDOM.toString()})(${JSON.stringify(profile)})`;
}
export function sendCheck(
  profile: DOMProfile,
  threadId: string,
  latest: string | null,
  text: string,
  contextBound = true,
) {
  const root = document.querySelector(profile.threadSelector);
  if (root?.getAttribute(profile.threadIdAttribute) !== threadId)
    throw new Error("Hội thoại đã thay đổi.");
  const last =
    Array.from(root.querySelectorAll(profile.messageSelector))
      .at(-1)
      ?.getAttribute(profile.messageIdAttribute) ?? null;
  if (contextBound && last !== latest)
    throw new Error("Có tin mới; bản nháp đã hết hiệu lực.");
  const composer = document.querySelector(profile.composerSelector) as
    HTMLInputElement | HTMLElement | null;
  const send = document.querySelector(
    profile.sendSelector,
  ) as HTMLElement | null;
  if (!composer || !send)
    throw new Error("Không xác định được nút gửi/composer.");
  if (
    (composer instanceof HTMLInputElement ||
    composer instanceof HTMLTextAreaElement
      ? composer.value
      : composer.textContent
    )?.trim()
  )
    throw new Error("Người dùng đang soạn tin; không ghi đè.");
  return true;
}
