import type { MessengerRead } from "./messenger.ts";

export function messengerReadIssue(
  read: MessengerRead,
  expected: { platformId: string; name: string },
): string | null {
  if (read.blocked)
    return (
      read.blockedReason ?? "Messenger có hộp thoại hoặc yêu cầu đăng nhập/PIN."
    );
  if (read.threadId !== expected.platformId)
    return `URL hội thoại chưa khớp (cần ${expected.platformId}, nhận ${read.threadId ?? "không có"}).`;
  if (read.selectedThreadId !== expected.platformId)
    return `Danh sách chat chưa chọn đúng hội thoại (cần ${expected.platformId}, nhận ${read.selectedThreadId ?? "không có"}).`;
  if (!read.composerPresent) return "Ô soạn tin chưa sẵn sàng.";
  if (
    read.name.normalize("NFC").trim().toLocaleLowerCase() !==
    expected.name.normalize("NFC").trim().toLocaleLowerCase()
  )
    return "Tên người nhận trong ô soạn chưa khớp tên hội thoại đã lưu.";
  if (read.ambiguous)
    return `${read.ambiguous} tin trùng định danh DOM; cần ID nền tảng để phân biệt.`;
  return null;
}

// Scroll and React hydration can temporarily unmount the selected link/composer.
// Poll actual readiness at every history stage; elapsed time alone never authorizes a read.
export async function waitForMessengerRead(
  capture: () => Promise<MessengerRead>,
  expected: { platformId: string; name: string },
  stage: string,
  delay = () => new Promise<void>((resolve) => setTimeout(resolve, 250)),
): Promise<MessengerRead> {
  let issue = "DOM chưa sẵn sàng.";
  for (let attempt = 0; attempt < 12; attempt++) {
    const read = await capture();
    const current = messengerReadIssue(read, expected);
    if (!current) return read;
    issue = current;
    if (attempt < 11) await delay();
  }
  throw new Error(`${stage}: ${issue}`);
}
