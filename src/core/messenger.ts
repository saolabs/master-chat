import type { InboxThread, Message } from "./types.ts";
export function messengerTimestamp(
  value: string,
  now = Date.now(),
): { timestamp: number | null; precision: "exact" | "minute" } {
  const s = value.normalize("NFC").trim().toLowerCase();
  if (/^\d{13}$/.test(s)) return { timestamp: Number(s), precision: "exact" };
  if (/^\d{4}-\d{2}-\d{2}t.*(?:z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return { timestamp: Number.isFinite(t) ? t : null, precision: "exact" };
  }
  const plain = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
  const clock = plain.match(
    /(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|sang|chieu|toi)?/,
  );
  if (!clock) return { timestamp: null, precision: "minute" };
  let hour = Number(clock[1]);
  const minute = Number(clock[2]),
    second = Number(clock[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59)
    return { timestamp: null, precision: "minute" };
  if (["pm", "chieu", "toi"].includes(clock[4] ?? "") && hour < 12) hour += 12;
  if (["am", "sang"].includes(clock[4] ?? "") && hour === 12) hour = 0;
  const date = plain.match(
    /(?:ngay\s*)?(\d{1,2})\s*(?:\/|thang\s*|thg\s*)(\d{1,2})\s*(?:\/|,?\s*(?:nam\s*)?)(\d{4})/,
  );
  let d = new Date(now);
  if (date) {
    const day = Number(date[1]),
      month = Number(date[2]),
      year = Number(date[3]);
    d = new Date(year, month - 1, day);
    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    )
      return { timestamp: null, precision: "minute" };
  } else if (/yesterday|hom qua/.test(plain)) d.setDate(d.getDate() - 1);
  else if (
    /thu |chu nhat|monday|tuesday|wednesday|thursday|friday|saturday|sunday|ago|truoc/.test(
      plain,
    )
  )
    return { timestamp: null, precision: "minute" };
  else if (
    !/^(?:luc\s*)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|sang|chieu|toi)?$/.test(
      plain,
    ) &&
    !/today|hom nay/.test(plain)
  )
    return { timestamp: null, precision: "minute" };
  d.setHours(hour, minute, second, 0);
  return { timestamp: d.getTime(), precision: clock[3] ? "exact" : "minute" };
}
export type NativeMessage = Omit<Message, "baseline" | "observedAt">;
export type MessengerRead = {
  threadId: string | null;
  selectedThreadId: string | null;
  name: string;
  messages: NativeMessage[];
  composerPresent: boolean;
  sendPresent: boolean;
  invalid: number;
  ambiguous: number;
  blocked: boolean;
  blockedReason?: string;
  revision: number;
};
export type NativeOptions = {
  threadId?: string;
  recipient?: string;
  scrollTop?: number;
  latest?: string | null;
  text?: string;
  now?: number;
};
// Public rendered DOM only. No private React stores, endpoints, tokens or requests are inspected.
export function messengerDOM(
  action:
    | "read"
    | "inbox"
    | "scroll-inbox"
    | "seek-inbox"
    | "reset-inbox"
    | "scroll-history"
    | "scroll-latest"
    | "preflight"
    | "focus"
    | "click"
    | "hover",
  options: NativeOptions = {},
  parseStamp = messengerTimestamp,
): any {
  const norm = (s: string) => s.normalize("NFC");
  const plain = (s: string) =>
    norm(s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase();
  const visible = (e: Element) =>
    e.getClientRects().length > 0 &&
    getComputedStyle(e).visibility !== "hidden" &&
    !e.closest('[aria-hidden="true"]');
  const threadId =
    location.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/)?.[1] ??
    null;
  const allowed =
    location.protocol === "https:" &&
    ["www.facebook.com", "facebook.com"].includes(location.hostname);
  if (!allowed) throw new Error("Không phải trang Facebook HTTPS được phép.");
  const authInput = Array.from(
    document.querySelectorAll(
      'input[type="password"],input[autocomplete="one-time-code"],iframe[src*="captcha"]',
    ),
  ).find(visible);
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(
    visible,
  );
  const blockedReason = /checkpoint|two_factor|two_step|challenge/.test(
    location.pathname,
  )
    ? "Facebook yêu cầu xác minh tài khoản."
    : authInput
      ? "Messenger đang yêu cầu đăng nhập hoặc mã PIN."
      : dialog
        ? `Messenger có hộp thoại đang mở${dialog.getAttribute("aria-label") ? `: ${norm(dialog.getAttribute("aria-label")!).slice(0, 120)}` : "."}`
        : undefined;
  const blocked = Boolean(blockedReason);
  const hash = (s: string) => {
    let a = 2166136261,
      b = 2246822519,
      c = 3266489917,
      d = 668265263;
    for (let i = 0; i < s.length; i++) {
      const v = s.charCodeAt(i);
      a = Math.imul(a ^ v, 16777619);
      b = Math.imul(b ^ v, 1597334677);
      c = Math.imul(c ^ v, 3812015801);
      d = Math.imul(d ^ v, 958282693);
    }
    return [a, b, c, d]
      .map((v) => (v >>> 0).toString(16).padStart(8, "0"))
      .join("");
  };
  // Observer is a hint to prioritize polling; it never authorizes a reply or invents a timestamp.
  const w = window as unknown as {
    __masterChatDOM?: { revision: number; observer: MutationObserver };
  };
  if (!w.__masterChatDOM) {
    const state = {
      revision: 0,
      observer: null as unknown as MutationObserver,
    };
    state.observer = new MutationObserver(() => state.revision++);
    state.observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    w.__masterChatDOM = state;
  }
  const grid = Array.from(document.querySelectorAll('[role="grid"]')).find(
    (e) =>
      /^(doan chat|chats)$/.test(plain(e.getAttribute("aria-label") ?? "")),
  );
  const scrollParent = (e: Element | null): HTMLElement | null => {
    for (let n = e?.parentElement; n; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (
        /auto|scroll/.test(style.overflowY) &&
        n.scrollHeight > n.clientHeight + 10
      )
        return n;
    }
    return null;
  };
  if (
    action === "inbox" ||
    action === "scroll-inbox" ||
    action === "seek-inbox" ||
    action === "reset-inbox"
  ) {
    if (blocked || !grid)
      throw new Error(
        "Chưa đọc được danh sách chat. Kiểm tra đăng nhập/PIN hoặc giao diện Messenger.",
      );
    const scroll =
      scrollParent(grid) ??
      (grid.scrollHeight > grid.clientHeight + 10
        ? (grid as HTMLElement)
        : null);
    if (action === "reset-inbox") {
      if (scroll) scroll.scrollTop = 0;
      return true;
    }
    if (action === "seek-inbox") {
      if (scroll) scroll.scrollTop = Math.max(0, options.scrollTop ?? 0);
      return true;
    }
    if (action === "scroll-inbox") {
      if (!scroll) return false;
      const before = scroll.scrollTop;
      scroll.scrollTop += Math.max(250, scroll.clientHeight - 50);
      return scroll.scrollTop > before;
    }
    const map = new Map<string, InboxThread>();
    for (const a of Array.from(
      grid.querySelectorAll<HTMLAnchorElement>("a[href]"),
    )) {
      const url = new URL(a.getAttribute("href")!, location.href);
      if (
        url.protocol !== "https:" ||
        !["www.facebook.com", "facebook.com"].includes(url.hostname)
      )
        continue;
      const id = url.pathname.match(
        /^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/,
      )?.[1];
      if (!id) continue;
      const label = norm(
        a.getAttribute("aria-label") || a.innerText || a.textContent || "",
      ).trim();
      const name = norm(
        a.querySelector('span[dir="auto"]')?.textContent?.trim() ||
          label.split("\n")[0] ||
          `Hội thoại ${id}`,
      );
      map.set(id, {
        platformId: id,
        name: name.slice(0, 200),
        url: `${url.origin}${url.pathname}`,
        unread: /tin nhan chua doc|unread/.test(plain(label)),
        signature: hash(label),
      });
    }
    return {
      threads: [...map.values()],
      revision: w.__masterChatDOM.revision,
      nextOffset: scroll?.scrollTop ?? 0,
      more: Boolean(
        scroll &&
        scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 4,
      ),
    };
  }
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>('[role="button"][aria-label]'),
  ).filter((e) =>
    /tin nhan do .+ gui luc |message sent by .+ at /.test(
      plain(e.getAttribute("aria-label") ?? ""),
    ),
  );
  const first = nodes[0] ?? null,
    scroll = scrollParent(first);
  if (action === "scroll-history") {
    if (!scroll) return false;
    const before = scroll.scrollTop;
    scroll.scrollTop -= Math.max(250, scroll.clientHeight - 50);
    return scroll.scrollTop < before;
  }
  if (action === "scroll-latest") {
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    return true;
  }
  const messages: NativeMessage[] = [];
  const now = options.now ?? Date.now();
  for (const node of nodes) {
    const label = norm(node.getAttribute("aria-label") ?? "");
    const match =
      label.match(/Tin nhắn do (.+?) gửi lúc (.+?): ([\s\S]*)$/i) ??
      label.match(/Message sent by (.+?) at (.+?): ([\s\S]*)$/i);
    if (!match) continue;
    const direction = /^(ban|you)$/.test(plain(match[1]))
      ? ("outgoing" as const)
      : ("incoming" as const);
    const text = match[3].trim();
    if (!text) continue;
    const article = node.closest('[role="article"]') ?? node;
    const stamp =
      article.querySelector("time[datetime]")?.getAttribute("datetime") ??
      article
        .querySelector("[data-timestamp]")
        ?.getAttribute("data-timestamp") ??
      article.querySelector("[data-utime]")?.getAttribute("data-utime");
    const parsed = parseStamp(
      stamp && /^\d{10}$/.test(stamp) ? `${stamp}000` : (stamp ?? match[2]),
      now,
    );
    const platformId =
      article.getAttribute("data-message-id") ??
      node.getAttribute("data-message-id");
    const id =
      platformId ??
      `dom:${hash(JSON.stringify([threadId, direction, text, parsed.timestamp === null ? match[2] : Math.floor(parsed.timestamp / 60_000)]))}`;
    messages.push({
      id,
      text,
      direction,
      timestamp: parsed.timestamp,
      precision: parsed.precision,
      identity: platformId ? "platform" : "fingerprint",
    });
  }
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  const ambiguous = messages.filter((m) => (counts.get(m.id) ?? 0) > 1).length;
  const composers = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[contenteditable="true"][role="textbox"]',
    ),
  ).filter(visible);
  const composer =
    composers.find((e) =>
      /^(viet cho |message |nhap tin nhan|type a message)/.test(
        plain(e.getAttribute("aria-label") ?? ""),
      ),
    ) ?? (composers.length === 1 ? composers[0] : null);
  const send = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="button"][aria-label],button[aria-label]',
    ),
  )
    .filter(visible)
    .find((e) =>
      /^(nhan enter de gui|press enter to send|send|gui)$/.test(
        plain(e.getAttribute("aria-label") ?? ""),
      ),
    );
  const selectedLink = grid?.querySelector<HTMLAnchorElement>(
    'a[aria-current="page"]',
  );
  const selectedThreadId =
    selectedLink?.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/)?.[1] ??
    null;
  const recipient = norm(composer?.getAttribute("aria-label") ?? "").replace(
    /^(?:Viết cho|Message)\s+/i,
    "",
  );
  const result: MessengerRead = {
    threadId,
    selectedThreadId,
    name: recipient,
    messages: messages.slice(-59),
    composerPresent: Boolean(composer),
    sendPresent: Boolean(send),
    invalid: messages.filter((m) => m.timestamp === null).length,
    ambiguous,
    blocked,
    blockedReason,
    revision: w.__masterChatDOM.revision,
  };
  if (action === "read") return result;
  if (action === "hover") {
    const node = nodes.find((_, i) => messages[i]?.id === options.latest);
    if (!node) return null;
    node.scrollIntoView({ block: "nearest" });
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  if (
    blocked ||
    !threadId ||
    threadId !== options.threadId ||
    selectedThreadId !== threadId ||
    (options.recipient !== undefined &&
      norm(options.recipient).toLocaleLowerCase() !==
        recipient.toLocaleLowerCase()) ||
    ambiguous
  )
    throw new Error(
      "Sai hội thoại, cần xác minh hoặc tin nhắn chưa định danh duy nhất.",
    );
  if ((messages.at(-1)?.id ?? null) !== options.latest)
    throw new Error("Có tin mới; bản nháp đã hết hiệu lực.");
  if (!composer) throw new Error("Không tìm thấy ô soạn Messenger.");
  const current = (composer.innerText || composer.textContent || "").trim();
  if (action === "click") {
    if (current !== options.text)
      throw new Error("Nội dung composer đã đổi; không gửi.");
    if (
      !send ||
      send.getAttribute("aria-disabled") === "true" ||
      send.hasAttribute("disabled")
    )
      throw new Error("Không có nút gửi tin nhắn khả dụng.");
    send.click();
    return true;
  }
  if (current) throw new Error("Người dùng đang soạn tin; không ghi đè.");
  if (action === "focus") composer.focus();
  return true;
}
export function messengerScript(
  action: Parameters<typeof messengerDOM>[0],
  options: NativeOptions = {},
): string {
  return `(() => {const __name=(value)=>value; return (${messengerDOM.toString()})(${JSON.stringify(action)},${JSON.stringify(options)},(${messengerTimestamp.toString()}));})()`;
}
