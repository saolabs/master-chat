import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { messengerScript, messengerTimestamp } from "../src/core/messenger.ts";
import { reconcileInbox } from "../src/core/inbox.ts";
import { isAutoReplyEnabled } from "../src/core/auto-reply.ts";
import { emptyState } from "../src/core/types.ts";
import { ingest, latestId } from "../src/core/conversation.ts";
import { messengerReadIssue } from "../src/core/messenger-readiness.ts";
const now = new Date(2026, 9, 4, 11, 0, 30).getTime();
const stamp = new Date(2026, 9, 4, 10, 19).getTime();
const message = (sender: string, time: string, text: string, id = "") =>
  `<div role="article" ${id ? `data-message-id="${id}"` : ""}><div role="button" aria-label="${`Nhập, Tin nhắn do ${sender} gửi lúc ${time}: ${text}`.normalize("NFD")}"></div></div>`;
function fixture(messages = message("Tôi là DEV", "10:19", "Xin chào")) {
  const d = new JSDOM(
    `<div role="grid" aria-label="${"Đoạn chat".normalize("NFD")}"><div role="row"><a aria-current="page" href="/messages/t/123/"><span dir="auto">Tôi là DEV</span><span>Tin nhắn chưa đọc</span></a></div><a href="https://example.com/messages/t/999/">Ngoài Facebook</a></div>${messages}<div contenteditable="true" role="textbox" aria-label="Viết cho Tôi là DEV"></div><div role="button" aria-label="Gửi lượt thích"></div><button aria-label="Nhấn Enter để gửi"></button>`,
    {
      url: "https://www.facebook.com/messages/t/123/",
      runScripts: "outside-only",
    },
  );
  Object.defineProperty(d.window.Element.prototype, "getClientRects", {
    value: () => [{ x: 0, y: 0, width: 50, height: 20 }],
  });
  const run = (
    action: Parameters<typeof messengerScript>[0],
    options: Parameters<typeof messengerScript>[1] = {},
  ) =>
    vm.runInContext(
      messengerScript(action, { now, ...options }),
      d.getInternalVMContext(),
    );
  return { d, run };
}
test("live semantic Vietnamese NFD labels read direction, content and minute timestamps without message IDs", () => {
  const { d, run } = fixture(
    message("Bạn", "10:18", "Hi") +
      message("Tôi là DEV", "10:19", "Xin chào: bạn"),
  );
  try {
    const r = run("read");
    assert.equal(r.threadId, "123");
    assert.equal(r.messages.length, 2);
    assert.equal(r.messages[0].direction, "outgoing");
    assert.equal(r.messages[1].text, "Xin chào: bạn");
    assert.equal(r.messages[1].timestamp, stamp);
    assert.equal(r.messages[1].identity, "fingerprint");
    assert.equal(r.messages[1].precision, "minute");
    assert.equal(r.ambiguous, 0);
    assert.equal(r.composerPresent, true);
    assert.equal(r.sendPresent, true);
    const again = run("read");
    assert.equal(again.messages[1].id, r.messages[1].id);
  } finally {
    d.window.close();
  }
});
function renderedConversation(d: JSDOM) {
  const doc = d.window.document;
  doc.querySelector("a[aria-current]")!.removeAttribute("aria-current");
  const region = doc.createElement("section");
  region.setAttribute(
    "aria-label",
    "Cuộc trò chuyện với Tôi là DEV".normalize("NFD"),
  );
  for (const element of [
    ...doc.querySelectorAll('[role="article"],[contenteditable],button'),
  ])
    region.append(element);
  doc.body.append(region);
  return region;
}
test("Messenger without aria-current binds the labelled conversation, composer and unique inbox URL for new incoming", () => {
  const { d, run } = fixture();
  try {
    const region = renderedConversation(d);
    region.insertAdjacentHTML(
      "afterbegin",
      message("Tôi là DEV", "10:20", "Tin mới", "new-message"),
    );
    const read = run("read");
    assert.equal(read.selectedThreadId, "123");
    assert.equal(
      messengerReadIssue(read, { platformId: "123", name: "Tôi là DEV" }),
      null,
    );
    assert.ok(
      read.messages.some((m: { id: string }) => m.id === "new-message"),
    );
    assert.equal(
      run("preflight", {
        threadId: "123",
        recipient: "Tôi là DEV",
        latest: read.messages.at(-1).id,
      }),
      true,
    );
    region.setAttribute("aria-label", "Conversation with Tôi là DEV");
    assert.equal(run("read").selectedThreadId, "123");
  } finally {
    d.window.close();
  }
});
test("missing selection marker cannot use stale recipient DOM, duplicate names, foreign links or URL alone", () => {
  const { d, run } = fixture();
  try {
    const region = renderedConversation(d);
    const doc = d.window.document;
    const link = doc.querySelector('a[href="/messages/t/123/"]')!;
    const latest = run("read").messages.at(-1).id;
    const blocked = () => {
      assert.equal(run("read").selectedThreadId, null);
      assert.throws(
        () => run("preflight", { threadId: "123", latest }),
        /Sai hội thoại/,
      );
    };
    region.setAttribute("aria-label", "Cuộc trò chuyện với Người khác");
    blocked();
    region.setAttribute("aria-label", "Cuộc trò chuyện với Tôi là DEV");
    link.setAttribute("href", "/messages/t/999/");
    blocked();
    link.setAttribute("href", "/messages/t/123/");
    const duplicate = link.cloneNode(true) as Element;
    duplicate.setAttribute("href", "/messages/t/999/");
    link.parentElement!.append(duplicate);
    blocked();
    duplicate.remove();
    link.setAttribute("href", "https://example.com/messages/t/123/");
    blocked();
    link.setAttribute("href", "/messages/t/123/");
    region.removeAttribute("aria-label");
    blocked();
  } finally {
    d.window.close();
  }
});
test("selection on inbox row and aria-current=true work, but conflicting explicit selection never falls back", () => {
  const { d, run } = fixture();
  try {
    renderedConversation(d);
    const doc = d.window.document;
    const link = doc.querySelector('a[href="/messages/t/123/"]')!;
    link.parentElement!.setAttribute("aria-selected", "true");
    assert.equal(run("read").selectedThreadId, "123");
    link.parentElement!.removeAttribute("aria-selected");
    link.setAttribute("aria-current", "true");
    assert.equal(run("read").selectedThreadId, "123");
    const other = doc.createElement("a");
    other.href = "/messages/t/999/";
    other.setAttribute("aria-current", "page");
    other.innerHTML = '<span dir="auto">Người khác</span>';
    link.parentElement!.append(other);
    assert.equal(run("read").selectedThreadId, null);
    link.removeAttribute("aria-current");
    assert.equal(run("read").selectedThreadId, "999");
    const latest = run("read").messages.at(-1).id;
    assert.throws(
      () => run("preflight", { threadId: "123", latest }),
      /Sai hội thoại/,
    );
  } finally {
    d.window.close();
  }
});
test("inbox uses list links despite root redirect, normalizes names and rejects foreign links", () => {
  const { d, run } = fixture();
  try {
    const r = run("inbox");
    assert.equal(r.threads.length, 1);
    assert.equal(r.threads[0].name, "Tôi là DEV");
    assert.equal(r.threads[0].platformId, "123");
    assert.equal(r.threads[0].unread, true);
    assert.equal(r.threads[0].url, "https://www.facebook.com/messages/t/123/");
  } finally {
    d.window.close();
  }
});
test("unknown weekday/relative dates are retained as raw context without inventing a date", () => {
  assert.equal(messengerTimestamp("Thứ bảy 3:53sáng", now).timestamp, null);
  assert.equal(messengerTimestamp("1 giờ trước", now).timestamp, null);
  assert.equal(messengerTimestamp("25:99", now).timestamp, null);
  assert.equal(
    messengerTimestamp("Hôm qua 10:19", now).timestamp,
    new Date(2026, 9, 3, 10, 19).getTime(),
  );
  assert.equal(messengerTimestamp("04/10/2026 10:19", now).timestamp, stamp);
  assert.equal(
    messengerTimestamp("2026-10-04T10:19:00+07:00", now).precision,
    "exact",
  );
});
test("identical messages in one minute are ambiguous and cannot authorize a send", () => {
  const { d, run } = fixture(
    message("Tôi là DEV", "10:19", "Hi") + message("Tôi là DEV", "10:19", "Hi"),
  );
  try {
    const r = run("read");
    assert.equal(r.ambiguous, 2);
    assert.throws(
      () => run("preflight", { threadId: "123", latest: r.messages.at(-1).id }),
      /định danh/,
    );
  } finally {
    d.window.close();
  }
});
test("native send rejects drift, manual composer, modal/PIN and like-only buttons", () => {
  const { d, run } = fixture();
  try {
    const latest = run("read").messages[0].id;
    assert.equal(run("preflight", { threadId: "123", latest }), true);
    assert.throws(
      () => run("preflight", { threadId: "999", latest }),
      /Sai hội thoại/,
    );
    assert.throws(
      () => run("preflight", { threadId: "123", latest: "stale" }),
      /tin mới/,
    );
    const composer = d.window.document.querySelector("[contenteditable]")!;
    composer.textContent = "Đang soạn";
    assert.throws(
      () => run("preflight", { threadId: "123", latest }),
      /Người dùng/,
    );
    composer.textContent = "Reply";
    d.window.document.querySelector("button")!.remove();
    assert.throws(
      () => run("click", { threadId: "123", latest, text: "Reply" }),
      /nút gửi/,
    );
    d.window.document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="dialog">PIN</div>',
    );
    assert.equal(run("read").blocked, true);
    assert.throws(
      () => run("click", { threadId: "123", latest, text: "Reply" }),
      /xác minh/,
    );
  } finally {
    d.window.close();
  }
});
test("native click sends only exact composer text and uses the message send control", () => {
  const { d, run } = fixture();
  try {
    let sends = 0,
      likes = 0;
    d.window.document
      .querySelector("button")!
      .addEventListener("click", () => sends++);
    d.window.document
      .querySelector('[aria-label="Gửi lượt thích"]')!
      .addEventListener("click", () => likes++);
    const latest = run("read").messages[0].id;
    d.window.document.querySelector("[contenteditable]")!.textContent = "Reply";
    assert.throws(
      () => run("click", { threadId: "123", latest, text: "Other" }),
      /Nội dung/,
    );
    assert.equal(
      run("click", { threadId: "123", latest, text: "Reply" }),
      true,
    );
    assert.equal(sends, 1);
    assert.equal(likes, 0);
  } finally {
    d.window.close();
  }
});
test("DOM observer records mutations while replayed IDs remain stable", async () => {
  const { d, run } = fixture();
  try {
    const initial = run("read");
    d.window.document
      .querySelector('[role="grid"]')!
      .appendChild(d.window.document.createElement("span"));
    await new Promise((r) => setImmediate(r));
    const after = run("read");
    assert.ok(after.revision > initial.revision);
    assert.equal(after.messages[0].id, initial.messages[0].id);
  } finally {
    d.window.close();
  }
});
function stateFixture() {
  const s = emptyState();
  s.accounts.push(
    {
      id: "a",
      name: "Account",
      platform: "messenger-personal",
      username: "",
      password: "",
      cookies: [],
    },
    {
      id: "b",
      name: "Other",
      platform: "messenger-personal",
      username: "",
      password: "",
      cookies: [],
    },
  );
  return s;
}
const scan = (id = "123") => ({
  scannedAt: now,
  coverage: "visible" as const,
  revision: 1,
  threads: [
    {
      platformId: id,
      name: "Tôi là DEV",
      url: `https://www.facebook.com/messages/t/${id}/`,
      unread: true,
      signature: "1",
    },
  ],
});
test("inbox preview and native order update before history reads; unseen partial rows remain", () => {
  const s = stateFixture();
  const first = scan();
  first.threads.push({ ...first.threads[0], platformId: "456" });
  reconcileInbox(s, "a", first);
  reconcileInbox(s, "a", {
    ...scan("456"),
    coverage: "partial",
    threads: [
      { ...scan("456").threads[0], signature: "new", preview: "New incoming" },
    ],
  });
  assert.deepEqual(s.accounts[0].inboxOrder, ["456", "123"]);
  assert.equal(s.conversations[1].inboxPreview, "New incoming");
  assert.equal(s.conversations[1].inboxUnread, true);
  assert.equal(s.conversations[1].messages.length, 0);
  assert.deepEqual(s.conversations[1].pendingIds, []);
});

test("semantic inbox snippets retain preview without turning unread labels into messages", () => {
  const { d, run } = fixture();
  try {
    d.window.document
      .querySelector("a[aria-current]")!
      .insertAdjacentHTML("beforeend", '<span dir="auto">Tin mới</span>');
    const inbox = run("inbox");
    assert.equal(inbox.threads[0].preview, "Tin mới");
    assert.equal(inbox.threads[0].unread, true);
  } finally {
    d.window.close();
  }
});
test("first inbox scan creates baseline with auto off; repeat and same thread across accounts are isolated", () => {
  const s = stateFixture();
  assert.equal(reconcileInbox(s, "a", scan()).added.length, 1);
  assert.equal(s.conversations[0].autoReply, null);
  assert.equal(isAutoReplyEnabled(s.conversations[0], s.accounts), false);
  assert.equal(s.conversations[0].initialized, false);
  assert.equal(reconcileInbox(s, "a", scan()).added.length, 0);
  assert.equal(reconcileInbox(s, "b", scan()).added.length, 1);
  assert.equal(s.conversations.length, 2);
});
test("new thread after baseline uses account opt-in but old unread and cutoff-minute messages never enqueue", () => {
  const s = stateFixture();
  reconcileInbox(s, "a", scan());
  s.accounts[0].autoDiscoverReply = true;
  reconcileInbox(s, "a", scan("456"));
  const c = s.conversations[1];
  assert.equal(c.autoReply, null);
  assert.equal(isAutoReplyEnabled(c, s.accounts), true);
  assert.equal(c.initialized, true);
  const cutoff = stamp + 30_000;
  const messages = [
    {
      id: "old",
      text: "old",
      direction: "incoming" as const,
      timestamp: stamp - 60_000,
      observedAt: now,
    },
    {
      id: "boundary",
      text: "maybe old",
      direction: "incoming" as const,
      timestamp: stamp,
      precision: "minute" as const,
      observedAt: now,
    },
    {
      id: "new",
      text: "new",
      direction: "incoming" as const,
      timestamp: stamp + 60_000,
      precision: "minute" as const,
      observedAt: now,
    },
  ];
  assert.deepEqual(ingest(c, messages, cutoff), ["new"]);
  assert.deepEqual(ingest(c, messages, cutoff), []);
  assert.deepEqual(c.pendingIds, ["new"]);
  assert.equal(isAutoReplyEnabled(s.conversations[0], s.accounts), true);
});
test("unknown-time old messages preserve DOM chronology and do not displace the newest message", () => {
  const s = stateFixture();
  reconcileInbox(s, "a", scan());
  const c = s.conversations[0];
  ingest(
    c,
    [
      {
        id: "old",
        text: "old",
        direction: "incoming",
        timestamp: null,
        observedAt: now,
      },
      {
        id: "latest",
        text: "today",
        direction: "outgoing",
        timestamp: stamp,
        observedAt: now,
      },
    ],
    stamp,
  );
  assert.equal(latestId(c), "latest");
  assert.deepEqual(c.pendingIds, []);
});

test("URL updated before selected DOM or recipient is ready cannot authorize sending", () => {
  const { d, run } = fixture();
  try {
    const latest = run("read").messages[0].id;
    const selected = d.window.document.querySelector('a[aria-current="page"]')!;
    selected.setAttribute("href", "/messages/t/999/");
    assert.throws(
      () =>
        run("preflight", { threadId: "123", recipient: "Tôi là DEV", latest }),
      /Sai hội thoại/,
    );
    selected.setAttribute("href", "/messages/t/123/");
    assert.throws(
      () =>
        run("preflight", {
          threadId: "123",
          recipient: "Someone else",
          latest,
        }),
      /Sai hội thoại/,
    );
    assert.equal(
      run("preflight", { threadId: "123", recipient: "Tôi là DEV", latest }),
      true,
    );
  } finally {
    d.window.close();
  }
});
test("scrolling can continue beyond the first bounded inbox scan and return to the top", () => {
  const { d, run } = fixture();
  try {
    const grid = d.window.document.querySelector(
      '[role="grid"]',
    ) as HTMLElement;
    Object.defineProperty(grid, "scrollHeight", { value: 5000 });
    Object.defineProperty(grid, "clientHeight", { value: 500 });
    assert.equal(run("inbox").more, true);
    run("scroll-inbox");
    assert.equal(run("inbox").nextOffset, 450);
    run("seek-inbox", { scrollTop: 3600 });
    assert.equal(run("inbox").nextOffset, 3600);
    run("reset-inbox");
    assert.equal(run("inbox").nextOffset, 0);
  } finally {
    d.window.close();
  }
});

test("hidden dialogs and login controls do not block a ready Messenger page", () => {
  const { d, run } = fixture();
  try {
    const hidden = d.window.document.createElement("div");
    hidden.setAttribute("aria-hidden", "true");
    hidden.innerHTML = '<div role="dialog"></div><input type="password">';
    d.window.document.body.append(hidden);
    assert.equal(run("read").blocked, false);
    const visibleDialog = d.window.document.createElement("div");
    visibleDialog.setAttribute("role", "dialog");
    visibleDialog.setAttribute("aria-label", "Khôi phục lịch sử chat");
    d.window.document.body.append(visibleDialog);
    const result = run("read");
    assert.equal(result.blocked, true);
    assert.equal(result.recoveryRequired, true);
    assert.match(result.blockedReason, /Khôi phục lịch sử chat/);
    assert.throws(
      () =>
        run("preflight", { threadId: "123", latest: result.messages[0].id }),
      /xác minh/,
    );
  } finally {
    d.window.close();
  }
});

test("loading and ordinary modals block sending without being classified as authentication recovery", () => {
  const { d, run } = fixture();
  try {
    const dialog = d.window.document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = "<h2>Đang tải tin nhắn...</h2><button>Đóng</button>";
    d.window.document.body.append(dialog);
    const loading = run("read");
    assert.equal(loading.blocked, true);
    assert.equal(loading.recoveryRequired, false);
    assert.throws(
      () =>
        run("preflight", {
          threadId: "123",
          recipient: "Tôi là DEV",
          latest: loading.messages[0].id,
        }),
      /xác minh/,
    );
    dialog.innerHTML = "<h2>Tùy chọn hội thoại</h2>";
    assert.equal(run("read").recoveryRequired, false);
    dialog.innerHTML = "<h2>Nhập mã PIN để khôi phục đoạn chat</h2>";
    assert.equal(run("read").recoveryRequired, true);
  } finally {
    d.window.close();
  }
});

test("semantic image messages preserve attachments and exclude avatars without misreading Anh as an image", () => {
  const markup =
    message("Tôi là DEV", "10:19", "Ảnh", "photo").replace(
      "</div></div>",
      '<img alt="Ảnh được gửi" width="240" src="https://scontent.fbcdn.net/photo.jpg?token=a"><img alt="Ảnh đại diện" width="80" src="https://scontent.fbcdn.net/avatar.jpg"></div></div>',
    ) + message("Tôi là DEV", "10:20", "Anh ơi");
  const { d, run } = fixture(markup);
  try {
    const read = run("read");
    assert.equal(read.messages[0].attachments.length, 1);
    assert.equal(read.messages[0].attachments[0].kind, "image");
    assert.equal(read.messages[1].attachments, undefined);
    const attachment = read.messages[0].attachments[0];
    d.window.document.querySelector<HTMLImageElement>("img")!.src =
      "https://scontent.fbcdn.net/photo.jpg?token=b";
    assert.equal(run("read").messages[0].attachments[0].id, attachment.id);
    assert.equal(
      run("media-source", {
        threadId: "123",
        recipient: "Tôi là DEV",
        messageId: "photo",
        attachmentId: attachment.id,
      }).source,
      "https://scontent.fbcdn.net/photo.jpg?token=b",
    );
    assert.throws(
      () =>
        run("media-source", {
          threadId: "999",
          recipient: "Tôi là DEV",
          messageId: "photo",
          attachmentId: attachment.id,
        }),
      /hội thoại/,
    );
  } finally {
    d.window.close();
  }
});
test("voice message identity stays stable when a lazy audio source appears, including empty semantic text", () => {
  const markup = message("Tôi là DEV", "10:19", "Tin nhắn thoại", "voice");
  const { d, run } = fixture(markup);
  try {
    const first = run("read").messages[0];
    assert.equal(first.attachments[0].kind, "audio");
    const article = d.window.document.querySelector('[role="article"]')!;
    article.insertAdjacentHTML(
      "beforeend",
      '<audio src="blob:https://www.facebook.com/voice"></audio>',
    );
    const loaded = run("read").messages[0];
    assert.equal(loaded.attachments.length, 1);
    assert.equal(loaded.attachments[0].id, first.attachments[0].id);
    const node = article.querySelector("[aria-label]")!;
    node.setAttribute("aria-label", "Tin nhắn do Tôi là DEV gửi lúc 10:19");
    assert.equal(run("read").messages[0].text, "[Tin nhắn thoại]");
  } finally {
    d.window.close();
  }
});
test("voice player beside its semantic label is read and loaded without borrowing adjacent message media", () => {
  const { d, run } = fixture(
    `<section><div><div role="button" aria-label="Tin nhắn do Tôi là DEV gửi lúc 10:18: Văn bản trước"></div></div>` +
      `<div id="voice-row"><div><button>Phát</button><div role="slider" aria-label="Thanh kéo âm thanh"></div><span>0:03</span></div><div role="button" aria-label="Nhập, Tin nhắn do Tôi là DEV gửi lúc 10:19"></div></div>` +
      `<div><div role="button" aria-label="Tin nhắn do Tôi là DEV gửi lúc 10:20: Văn bản sau"></div></div></section>`,
  );
  try {
    const first = run("read").messages;
    assert.equal(first.length, 3);
    assert.equal(first[0].attachments, undefined);
    assert.equal(first[2].attachments, undefined);
    const voice = first[1];
    assert.equal(voice.text, "[Tin nhắn thoại]");
    assert.equal(voice.attachments[0].kind, "audio");
    let plays = 0;
    const row = d.window.document.querySelector("#voice-row")!;
    row.querySelector("button")!.onclick = () => {
      plays++;
      row.insertAdjacentHTML(
        "beforeend",
        '<audio src="blob:https://www.facebook.com/voice-sibling"></audio>',
      );
    };
    run("media-source", {
      threadId: "123",
      recipient: "Tôi là DEV",
      messageId: voice.id,
      attachmentId: voice.attachments[0].id,
      load: true,
    });
    assert.equal(plays, 1);
    const loaded = run("read").messages;
    assert.equal(loaded[1].id, voice.id);
    assert.equal(loaded[1].attachments[0].id, voice.attachments[0].id);
    assert.equal(
      loaded[1].attachments[0].source,
      "blob:https://www.facebook.com/voice-sibling",
    );
    assert.equal(loaded[0].attachments, undefined);
    assert.equal(loaded[2].attachments, undefined);
  } finally {
    d.window.close();
  }
});
test("voice source from a detached Audio player is bound to the requested attachment", () => {
  const { d, run } = fixture(
    '<div role="article"><div role="button" aria-label="Tin nhắn do Tôi là DEV gửi lúc 10:19: Tin nhắn thoại"></div><button aria-label="Phát"></button></div>',
  );
  try {
    const original = d.window.HTMLMediaElement.prototype.play;
    d.window.HTMLMediaElement.prototype.play = async function () {};
    d.window.HTMLMediaElement.prototype.pause = function () {};
    const voice = run("read").messages[0];
    const options = {
      threadId: "123",
      recipient: "Tôi là DEV",
      messageId: voice.id,
      attachmentId: voice.attachments[0].id,
    };
    d.window.document.querySelector<HTMLButtonElement>(
      '[aria-label="Phát"]',
    )!.onclick = () => {
      const audio = new d.window.Audio(
        "blob:https://www.facebook.com/detached-voice",
      );
      void audio.play();
    };
    const media = run("media-source", { ...options, load: true });
    assert.equal(media.source, "blob:https://www.facebook.com/detached-voice");
    assert.equal(run("media-source", options).source, media.source);
    d.window.HTMLMediaElement.prototype.play = original;
  } finally {
    d.window.close();
  }
});
