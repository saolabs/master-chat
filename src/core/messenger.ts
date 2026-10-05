import type { Attachment, InboxThread, Message } from "./types.ts";
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
  recoveryRequired?: boolean;
  rateLimited?: boolean;
  revision: number;
};
export type NativeOptions = {
  historyLimit?: number;
  threadId?: string;
  recipient?: string;
  scrollTop?: number;
  latest?: string | null;
  contextBound?: boolean;
  text?: string;
  now?: number;
  messageId?: string;
  attachmentId?: string;
  load?: boolean;
  nativePlayback?: boolean;
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
    | "hover"
    | "media-source",
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
  // Facebook can render this as a full page with old chat popups still present.
  // Match visible page headings, never another person's message text.
  const rateLimited = Array.from(
    document.querySelectorAll('h1,h2,h3,[role="heading"]'),
  ).some(
    (heading) =>
      visible(heading) &&
      /^(?:ban tam thoi bi chan|you(?:'|’)re temporarily blocked|you are temporarily blocked|temporarily blocked)\s*[.!]?$/i.test(
        plain(heading.textContent ?? "").trim(),
      ),
  );
  const rateLimitReason =
    "Facebook tạm thời chặn tính năng do thao tác quá nhanh. Đồng bộ tài khoản đã dừng; chờ Facebook gỡ chặn rồi mở tab Messenger và bấm Tải lại để kiểm tra.";
  const blockedReason = rateLimited
    ? rateLimitReason
    : /checkpoint|two_factor|two_step|challenge/.test(location.pathname)
      ? "Facebook yêu cầu xác minh tài khoản."
      : authInput
        ? "Messenger đang yêu cầu đăng nhập hoặc mã PIN."
        : dialog
          ? `Messenger có hộp thoại đang mở${dialog.getAttribute("aria-label") ? `: ${norm(dialog.getAttribute("aria-label")!).slice(0, 120)}` : "."}`
          : undefined;
  const blocked = Boolean(blockedReason);
  const dialogTitle = dialog
    ? plain(
        `${dialog.getAttribute("aria-label") ?? ""} ${Array.from(
          dialog.querySelectorAll('h1,h2,h3,[role="heading"]'),
        )
          .map((h) => h.textContent ?? "")
          .join(" ")}`,
      )
    : "";
  if (rateLimited && action !== "read")
    throw Object.assign(new Error(rateLimitReason), { rateLimited: true });
  const recoveryRequired =
    !rateLimited &&
    Boolean(
      authInput ||
      /checkpoint|two_factor|two_step|challenge/.test(location.pathname) ||
      /khoi phuc|restore|recovery|dong bo lich su|sync (?:your )?chat history|nhap (?:ma )?pin|enter (?:your )?pin|xac minh|verification/.test(
        dialogTitle,
      ),
    );
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
  const moveScroll = (element: HTMLElement, top: number) => {
    const before = element.scrollTop;
    element.scrollTop = top;
    const moved = element.scrollTop !== before;
    // Detached Electron views may not paint a frame that emits scroll. Notify
    // virtualized lists explicitly so their rendered rows follow the offset.
    if (moved) element.dispatchEvent(new Event("scroll"));
    return moved;
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
      if (scroll) moveScroll(scroll, 0);
      return true;
    }
    if (action === "seek-inbox") {
      if (scroll) moveScroll(scroll, Math.max(0, options.scrollTop ?? 0));
      return true;
    }
    if (action === "scroll-inbox") {
      if (!scroll) return false;
      return moveScroll(
        scroll,
        scroll.scrollTop + Math.max(250, scroll.clientHeight - 50),
      );
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
      const snippets = Array.from(a.querySelectorAll('span[dir="auto"]'))
        .filter((span) => !span.querySelector('span[dir="auto"]'))
        .map((span) => norm(span.textContent ?? "").trim())
        .filter(
          (text) =>
            text &&
            text !== name &&
            !/^(tin nhan chua doc|unread)$/.test(plain(text)),
        );
      const preview =
        snippets.join(" ").slice(0, 500) ||
        label
          .split("\n")
          .map((line) => line.trim())
          .filter(
            (line) =>
              line &&
              line !== name &&
              !/^(tin nhan chua doc|unread)$/.test(plain(line)),
          )
          .join(" ")
          .slice(0, 500);
      map.set(id, {
        platformId: id,
        name: name.slice(0, 200),
        url: `${url.origin}${url.pathname}`,
        unread: /tin nhan chua doc|unread/.test(plain(label)),
        signature: hash(label),
        preview: preview || undefined,
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
    return moveScroll(
      scroll,
      scroll.scrollTop - Math.max(250, scroll.clientHeight - 50),
    );
  }
  if (action === "scroll-latest") {
    if (scroll) moveScroll(scroll, scroll.scrollHeight);
    return true;
  }
  const messages: NativeMessage[] = [];
  const messageNodes = new Map<string, HTMLElement>();
  const audioPlayer = (root: Element) =>
    Array.from(root.querySelectorAll('[role="slider"][aria-label]')).some(
      (slider) =>
        /am thanh|audio|voice/.test(
          plain(slider.getAttribute("aria-label") || ""),
        ),
    ) &&
    Array.from(root.querySelectorAll('button,[role="button"]')).some((button) =>
      /^(phat|tam dung|play|pause)(?:\s|$)/.test(
        plain(button.getAttribute("aria-label") || button.textContent || ""),
      ),
    );
  const messageRoot = (node: HTMLElement): Element => {
    const article = node.closest('[role="article"]');
    if (article) return article;
    // Current Messenger places the voice player beside its semantic message
    // button. Stop before an ancestor contains another message's controls.
    let parent = node.parentElement;
    for (
      let n = 0;
      parent && parent !== document.body && n < 4;
      n++, parent = parent.parentElement
    ) {
      if (nodes.some((other) => other !== node && parent!.contains(other)))
        break;
      if (parent.querySelector("audio") || audioPlayer(parent)) return parent;
    }
    return node;
  };
  const now = options.now ?? Date.now();
  for (const node of nodes) {
    const label = norm(node.getAttribute("aria-label") ?? "");
    const match =
      label.match(/Tin nhắn do (.+?) gửi lúc (.+?): ([\s\S]*)$/i) ??
      label.match(/Message sent by (.+?) at (.+?): ([\s\S]*)$/i) ??
      label.match(/Tin nhắn do (.+?) gửi lúc (.+)$/i) ??
      label.match(/Message sent by (.+?) at (.+)$/i);
    if (!match) continue;
    const direction = /^(ban|you)$/.test(plain(match[1]))
      ? ("outgoing" as const)
      : ("incoming" as const);
    let text = (match[3] ?? "").trim();
    const article = messageRoot(node);
    const attachments: Attachment[] = [];
    const seenSources = new Set<string>();
    const addMedia = (
      kind: Attachment["kind"],
      source: string | undefined,
      label = "",
    ) => {
      if (source && seenSources.has(source)) return;
      if (source) seenSources.add(source);
      let identity = label;
      try {
        const u = new URL(source!);
        identity =
          kind === "audio" || u.protocol === "blob:"
            ? label
            : u.origin + u.pathname;
      } catch {}
      attachments.push({
        id: `media:${hash(JSON.stringify([kind, identity, attachments.length]))}`,
        kind,
        ...(source ? { source } : {}),
        ...(label ? { label } : {}),
      });
    };
    for (const img of Array.from(
      node.querySelectorAll<HTMLImageElement>("img[src]"),
    )) {
      const alt = norm(img.alt || img.getAttribute("aria-label") || "");
      if (/avatar|profile picture|anh dai dien/.test(plain(alt))) continue;
      if (
        img.naturalWidth > 40 ||
        img.width > 40 ||
        /anh|photo|image|sticker/.test(plain(alt))
      )
        addMedia("image", img.currentSrc || img.src, alt);
    }
    for (const audio of Array.from(
      article.querySelectorAll<HTMLAudioElement>("audio"),
    )) {
      addMedia(
        "audio",
        audio.currentSrc ||
          audio.src ||
          audio.querySelector("source")?.src ||
          undefined,
        "Tin nhắn thoại",
      );
    }
    const mediaLabel = plain(
      Array.from(node.querySelectorAll("[aria-label]"))
        .map((e) => e.getAttribute("aria-label"))
        .join(" "),
    );
    if (
      !attachments.some((a) => a.kind === "audio") &&
      (audioPlayer(article) ||
        /tin nhan (?:thoai|am thanh)|voice message|audio message/.test(
          mediaLabel,
        ) ||
        /^(?:tin nhan (?:thoai|am thanh)|voice message|audio message)(?:\s*[\d:]+)?$/.test(
          plain(text),
        ))
    )
      addMedia("audio", undefined, "Tin nhắn thoại");
    if (
      !attachments.some((a) => a.kind === "image") &&
      /^(?:Ảnh|Photo|Image)(?:\s+\d+)?$/iu.test(text)
    )
      addMedia("image", undefined, "Ảnh");
    if (!text && attachments.length)
      text = attachments.some((a) => a.kind === "audio")
        ? "[Tin nhắn thoại]"
        : "[Hình ảnh]";
    if (!text) continue;
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
      ...(attachments.length ? { attachments } : {}),
    });
    messageNodes.set(id, article as HTMLElement);
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
  const recipient = norm(composer?.getAttribute("aria-label") ?? "").replace(
    /^(?:Viết cho|Message)\s+/i,
    "",
  );
  const sameName = (a: string, b: string) =>
    norm(a).trim().toLocaleLowerCase() === norm(b).trim().toLocaleLowerCase();
  const links = Array.from(
    grid?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [],
  ).flatMap((link) => {
    const url = new URL(link.getAttribute("href")!, location.href);
    const id = url.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/)?.[1];
    if (
      !id ||
      url.protocol !== "https:" ||
      !["www.facebook.com", "facebook.com"].includes(url.hostname)
    )
      return [];
    const name =
      link.querySelector('span[dir="auto"]')?.textContent?.trim() ||
      (
        link.getAttribute("aria-label") ||
        link.innerText ||
        link.textContent ||
        ""
      )
        .split("\n")[0]
        .trim();
    const marker = link.closest(
      '[aria-current="page"],[aria-current="true"],[aria-selected="true"]',
    );
    return [{ id, name, marked: Boolean(marker && grid?.contains(marker)) }];
  });
  const markedIds = new Set(
    links.filter((link) => link.marked).map((link) => link.id),
  );
  let selectedThreadId = markedIds.size === 1 ? [...markedIds][0] : null;
  // Some Messenger layouts omit aria-current entirely. Bind the rendered
  // conversation region and its composer to a unique inbox name + URL instead.
  // A stale/conflicting explicit selection must never use this fallback.
  if (!markedIds.size && threadId && composer && recipient) {
    for (
      let region = composer.parentElement;
      region;
      region = region.parentElement
    ) {
      const label = norm(region.getAttribute("aria-label") ?? "");
      const match = label.match(
        /^(?:Cuộc trò chuyện với|Conversation with)\s+(.+)$/i,
      );
      if (!match) continue;
      const matchingIds = new Set(
        links
          .filter((link) => sameName(link.name, recipient))
          .map((link) => link.id),
      );
      if (
        visible(region) &&
        sameName(match[1], recipient) &&
        matchingIds.size === 1 &&
        matchingIds.has(threadId)
      )
        selectedThreadId = threadId;
      break;
    }
  }
  const result: MessengerRead = {
    threadId,
    selectedThreadId,
    name: recipient,
    messages: messages.slice(
      -Math.min(5000, Math.max(1, options.historyLimit ?? 59)),
    ),
    composerPresent: Boolean(composer),
    sendPresent: Boolean(send),
    invalid: messages.filter((m) => m.timestamp === null).length,
    ambiguous,
    blocked,
    blockedReason,
    recoveryRequired,
    rateLimited,
    revision: w.__masterChatDOM.revision,
  };
  if (action === "read") return result;
  if (action === "hover") {
    const node = messageNodes.get(options.latest ?? "");
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
  if (action === "media-source") {
    const message = messages.find((m) => m.id === options.messageId);
    const attachment = message?.attachments?.find(
      (a) => a.id === options.attachmentId,
    );
    if (!message || !attachment)
      throw new Error("Tệp đính kèm không còn nằm trong đúng tin nhắn.");
    // Messenger may use a detached Audio instance rather than an <audio>
    // descendant. Capture only playback triggered in this isolated worker for
    // the requested message, and refuse an ambiguous second audio instance.
    const scope = window as unknown as {
      __masterChatVoice?: {
        messageId: string;
        attachmentId: string;
        audios: Set<HTMLMediaElement>;
        restore: () => void;
      };
    };
    if (!attachment.source && attachment.kind === "audio" && options.load) {
      const node = messageNodes.get(message.id)!;
      const play = Array.from(
        (
          node.closest('[role="article"]') ?? node
        ).querySelectorAll<HTMLElement>('button,[role="button"]'),
      ).find((e) =>
        /^(phat|play)(?:\s|$)/.test(
          plain(e.getAttribute("aria-label") || e.textContent || ""),
        ),
      );
      if (play) {
        scope.__masterChatVoice?.restore();
        const original = HTMLMediaElement.prototype.play;
        const OriginalAudio = window.Audio;
        const audios = new Set<HTMLMediaElement>();
        // Some players cache play() before we attach. Also capture detached
        // Audio instances created by this requested playback gesture.
        const CapturedAudio = class extends OriginalAudio {
          constructor(src?: string) {
            super(src);
            audios.add(this);
          }
        };
        const capture = function (this: HTMLMediaElement) {
          if (this instanceof HTMLAudioElement) audios.add(this);
          return original.call(this);
        };
        const restore = () => {
          if (HTMLMediaElement.prototype.play === capture)
            HTMLMediaElement.prototype.play = original;
          if (window.Audio === CapturedAudio) window.Audio = OriginalAudio;
        };
        scope.__masterChatVoice = {
          messageId: message.id,
          attachmentId: attachment.id,
          audios,
          restore,
        };
        HTMLMediaElement.prototype.play = capture;
        window.Audio = CapturedAudio;
        window.setTimeout(restore, 16000);
        if (options.nativePlayback) {
          play.scrollIntoView({ block: "center", inline: "nearest" });
          const rect = play.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          if (!visible(play) || !hit || !(hit === play || play.contains(hit)))
            throw new Error(
              "Không xác định được nút phát của đúng tệp âm thanh.",
            );
          return { ...attachment, playPoint: { x, y } };
        }
        play.click();
      }
    }
    const captured = scope.__masterChatVoice;
    if (
      !attachment.source &&
      attachment.kind === "audio" &&
      captured?.messageId === message.id &&
      captured.attachmentId === attachment.id &&
      captured.audios.size === 1
    ) {
      const audio = [...captured.audios][0];
      const source = audio.currentSrc || audio.src;
      if (source) {
        attachment.source = source;
        audio.pause();
        captured.restore();
      }
    }
    if (attachment.source)
      for (const audio of Array.from(document.querySelectorAll("audio")))
        if (!audio.paused) audio.pause();
    return attachment;
  }
  if (
    options.contextBound !== false &&
    (messages.at(-1)?.id ?? null) !== options.latest
  )
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
