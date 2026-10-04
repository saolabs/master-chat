import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
import {
  ConversationPanel,
  type ComposerState,
} from "../src/renderer/conversation-panel.tsx";
import {
  emptyState,
  publicState,
  type Command,
  type Snapshot,
  type ReplyReview,
} from "../src/core/types.ts";

async function mount(t: TestContext, review?: ReplyReview) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.test/" });
  // JSDOM has no layout; ProseMirror measures ranges when it focuses a draft.
  dom.window.Range.prototype.getClientRects = () =>
    [] as unknown as DOMRectList;
  dom.window.Range.prototype.getBoundingClientRect = () =>
    new dom.window.DOMRect();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.matchMedia = (() => ({
    matches: true,
  })) as unknown as typeof window.matchMedia;
  const { createRoot } = await import("react-dom/client");
  const state = emptyState();
  state.accounts.push({
    id: "a",
    name: "Me",
    platform: "messenger-personal",
    username: "",
    password: "",
    cookies: [],
  });
  state.conversations.push({
    id: "c",
    accountId: "a",
    platformId: "123",
    name: "Friend",
    url: "https://www.facebook.com/messages/t/123/",
    messages: [],
    initialized: true,
    autoReply: true,
    pendingIds: [],
    summary: { text: "", coveredIds: [], revision: 0 },
  });
  const calls: Command[] = [];
  let composition: ComposerState = { text: "" };
  let failSend = false;
  let render!: () => void;
  const snapshot = (): Snapshot => ({
    data: publicState(structuredClone(state)),
    tabs: [],
    paused: true,
    notice: "",
  });
  const run = async (command: Command) => {
    calls.push(command);
    if (command.type === "draft.generate")
      state.drafts.push({
        id: "ai",
        conversationId: "c",
        text: "AI reply",
        review,
        basedOnId: null,
        triggerIds: [],
        proactive: false,
        status: "draft",
        createdAt: 1,
      });
    if (command.type === "draft.send" && !failSend)
      state.drafts.find((d) => d.id === command.draftId)!.status = "sent";
    if (command.type === "conversation.send" && !failSend)
      for (const draft of state.drafts)
        if (
          draft.conversationId === command.conversationId &&
          draft.status === "draft"
        )
          draft.status = "stale";
    if (command.type === "draft.discard")
      state.drafts.find((d) => d.id === command.draftId)!.status = "stale";
    render();
    return failSend &&
      ["conversation.send", "draft.send"].includes(command.type)
      ? null
      : snapshot();
  };
  function Harness() {
    const [composer, setComposer] = useState<ComposerState>(composition);
    const [version, setVersion] = useState(0);
    render = () => setVersion((v) => v + 1);
    void version;
    return (
      <ConversationPanel
        c={state.conversations[0]}
        snapshot={snapshot()}
        busy={false}
        run={run}
        open={() => {}}
        composer={composer}
        onComposerChange={(v) => {
          composition = v;
          setComposer(v);
        }}
      />
    );
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(<Harness />));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });
  const input = () =>
    dom.window.document.querySelector<HTMLDivElement>(
      '.chat-composer [role="textbox"]',
    )!;
  const click = async (text: string) => {
    const button = Array.from(
      dom.window.document.querySelectorAll("button"),
    ).find(
      (b) => b.textContent === text || b.getAttribute("aria-label") === text,
    );
    assert.ok(button, text);
    await act(async () => button.click());
  };
  const type = async (text: string) => {
    await act(async () => {
      input().replaceChildren(
        ...text.split("\n").map((line) => {
          const paragraph = dom.window.document.createElement("p");
          paragraph.textContent = line;
          return paragraph;
        }),
      );
      input().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return {
    dom,
    state,
    calls,
    input,
    click,
    type,
    refresh: () => act(async () => render()),
    fail: () => {
      failSend = true;
    },
    composition: () => composition,
  };
}

test("manual composer sends while automation is paused and preserves content on failure", async (t) => {
  const r = await mount(t);
  await r.type("My reply");
  assert.equal(r.composition().text, "My reply");
  r.fail();
  await r.click("Gửi");
  assert.deepEqual(r.calls.at(-1), {
    type: "conversation.send",
    conversationId: "c",
    text: "My reply",
    basedOnId: null,
  });
  assert.equal(r.input().textContent, "My reply");
});

test("AI draft fills the editor, explicit send approves the edited text as manual, and clears it", async (t) => {
  const r = await mount(t);
  await r.click("Tạo nháp AI");
  assert.equal(r.input().textContent, "AI reply");
  assert.equal(r.calls.filter((c) => c.type === "draft.send").length, 0);
  await r.type("Edited AI reply");
  await r.click("Gửi");
  assert.deepEqual(r.calls.at(-1), {
    type: "conversation.send",
    conversationId: "c",
    basedOnId: null,
    text: "Edited AI reply",
  });
  assert.equal(r.input().textContent, "");
});

test("explicit send-after-generation sends once and discarding a draft keeps composer empty", async (t) => {
  const r = await mount(t);
  await r.click("Trợ lý AI");
  const checkbox = Array.from(r.dom.window.document.querySelectorAll("label"))
    .find((l) => l.textContent?.includes("Gửi ngay sau khi tạo nháp"))!
    .querySelector("input")!;
  await act(async () => checkbox.click());
  await r.click("Tạo nháp AI");
  assert.equal(r.calls.filter((c) => c.type === "draft.send").length, 1);
  assert.equal(r.input().textContent, "");
  await act(async () => checkbox.click());
  r.state.drafts = [];
  await r.click("Tạo nháp AI");
  await r.click("Xóa nội dung");
  assert.equal(r.input().textContent, "");
  assert.equal(r.state.drafts[0].status, "stale");
});

test("stale draft requires review, uncertain blocks retry, and manual text survives snapshot updates", async (t) => {
  const r = await mount(t);
  await r.type("Keep this");
  r.state.drafts.push({
    id: "other",
    conversationId: "c",
    text: "Other AI",
    basedOnId: null,
    triggerIds: [],
    proactive: false,
    status: "draft",
    createdAt: 1,
  });
  await r.refresh();
  assert.equal(r.input().textContent, "Keep this");
  await r.click("Trợ lý AI · 1");
  await r.click("Đưa vào ô soạn");
  r.state.drafts[0].status = "stale";
  await r.refresh();
  assert.equal(
    Array.from(r.dom.window.document.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Gửi",
    )!.disabled,
    true,
  );
  await r.click("Dùng như tin nhắn mới");
  assert.equal(r.composition().draftId, undefined);
  r.state.drafts[0].status = "uncertain";
  await r.refresh();
  await r.click("Gửi");
  assert.equal(
    r.calls.filter(
      (c) => c.type === "conversation.send" || c.type === "draft.send",
    ).length,
    0,
  );
  assert.equal(r.input().textContent, "Other AI");
});

test("Enter sends, Shift+Enter and IME composition do not", async (t) => {
  const r = await mount(t);
  await r.type("Hello");
  await act(async () =>
    r.input().dispatchEvent(
      new r.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
      }),
    ),
  );
  const beforeComposition = r.composition().text;
  await act(async () =>
    r.input().dispatchEvent(
      new r.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  assert.equal(r.calls.length, 0);
  assert.equal(r.composition().text, beforeComposition);
  await act(async () =>
    r.input().dispatchEvent(
      new r.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        bubbles: true,
      }),
    ),
  );
  assert.equal(r.composition().text, beforeComposition);
  assert.equal(r.calls.length, 0);
  await act(async () =>
    r.input().dispatchEvent(
      new r.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    ),
  );
  assert.equal(r.calls.filter((c) => c.type === "conversation.send").length, 1);
  assert.equal(r.input().textContent, "");
});

test("cached audio is labelled and searchable across older local history", async (t) => {
  const r = await mount(t),
    c = r.state.conversations[0];
  c.messages = Array.from({ length: 80 }, (_, n) => ({
    id: `m-${n}`,
    text: n === 0 ? "" : `Tin ${n}`,
    direction: "incoming",
    timestamp: n,
    observedAt: n,
    baseline: true,
    ...(n === 0
      ? {
          attachments: [
            {
              id: "voice",
              kind: "audio" as const,
              analysis: "Hẹn bạn lúc mười giờ sáng mai",
            },
          ],
        }
      : {}),
  }));
  await r.refresh();
  assert.ok(
    !r.dom.window.document
      .querySelector(".history")!
      .textContent!.includes("Hẹn bạn"),
  );
  const search =
    r.dom.window.document.querySelector<HTMLInputElement>(
      "input[type=search]",
    )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      r.dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "mười giờ");
    search.dispatchEvent(new r.dom.window.Event("input", { bubbles: true }));
  });
  assert.match(
    r.dom.window.document.querySelector(".history")!.textContent!,
    /Bản chép âm thanh · đã lưu/,
  );
  assert.match(
    r.dom.window.document.querySelector(".history")!.textContent!,
    /Hẹn bạn lúc mười giờ/,
  );
  assert.match(
    r.dom.window.document.querySelector(".history-tools")!.textContent!,
    /1 tin khớp trong 80/,
  );
});

test("relationship context and long-term direction are saved separately and optional", async (t) => {
  const r = await mount(t);
  await r.click("Trợ lý AI");
  const edit = async (label: string, text: string) => {
    const field = r.dom.window.document.querySelector<HTMLTextAreaElement>(
      `textarea[aria-label="${label}"]`,
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        r.dom.window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(field, text);
      field.dispatchEvent(new r.dom.window.Event("input", { bubbles: true }));
    });
  };
  await edit("Ngữ cảnh quan hệ", "Bạn thân từ đại học, đang gặp chuyện buồn.");
  await edit(
    "Định hướng trò chuyện",
    "Lắng nghe trước, không ép đưa lời khuyên.",
  );
  await r.click("Lưu hồ sơ & định hướng");
  const command = r.calls.at(-1);
  assert.equal(command?.type, "conversation.style");
  if (command?.type === "conversation.style") {
    assert.equal(
      command.relationshipContext,
      "Bạn thân từ đại học, đang gặp chuyện buồn.",
    );
    assert.equal(
      command.conversationDirection,
      "Lắng nghe trước, không ép đưa lời khuyên.",
    );
    assert.equal(command.style, "");
    assert.equal(command.learnStyle, undefined);
  }
  await r.click("Nạp thêm lịch sử");
  assert.equal(r.calls.at(-1)?.type, "conversation.backfill");
});

test("explicit send-after-generation does not require manual review approval", async (t) => {
  const r = await mount(t, {
    status: "held",
    issues: ["Lời hứa cần xác nhận"],
    checkedAt: 1,
  });
  await r.click("Trợ lý AI");
  const checkbox = Array.from(r.dom.window.document.querySelectorAll("label"))
    .find((l) => l.textContent?.includes("Gửi ngay sau khi tạo nháp"))!
    .querySelector("input")!;
  await act(async () => checkbox.click());
  await r.click("Tạo nháp AI");
  assert.equal(r.input().textContent, "");
  assert.equal(r.calls.filter((c) => c.type === "draft.send").length, 1);
  assert.equal(r.calls.filter((c) => c.type === "conversation.send").length, 0);
});

test("automatic draft with review warnings never fills the selected composer and blocks its own send", async (t) => {
  const r = await mount(t);
  r.state.drafts.push({
    id: "auto",
    conversationId: "c",
    text: "Automatic reply",
    basedOnId: null,
    status: "draft",
    createdAt: 1,
    triggerIds: [],
    proactive: false,
    automatic: true,
    review: { status: "held", issues: ["Style note"], checkedAt: 1 },
  });
  await r.refresh();
  assert.equal(r.input().textContent, "");
  assert.equal(r.composition().draftId, undefined);
  assert.doesNotMatch(
    r.dom.window.document.querySelector(".chat-options")!.textContent!,
    /Tiếp tục|tạm dừng/,
  );
});

test("composer uses an editor and keeps send and AI actions in one surface", async (t) => {
  const r = await mount(t);
  assert.equal(
    r.dom.window.document.querySelector(".chat-composer textarea"),
    null,
  );
  assert.equal(r.input().getAttribute("contenteditable"), "true");
  const surface = r.dom.window.document.querySelector(".composer-surface")!;
  assert.ok(surface.contains(r.input()));
  assert.ok(surface.querySelector('.composer-toolbar [aria-label="Gửi"]'));
  assert.match(surface.textContent!, /Tạo nháp AI/);
  assert.doesNotMatch(surface.textContent!, /Model|Suy luận/);
});

test("assistant is opt-in and a linked draft is not duplicated in the sidebar", async (t) => {
  const r = await mount(t, {
    status: "unavailable",
    issues: ["HTTP 429"],
    checkedAt: 1,
  });
  assert.equal(r.dom.window.document.querySelector(".assistant-sidebar"), null);
  await r.click("Tạo nháp AI");
  await r.click("Trợ lý AI · 1");
  assert.equal(r.dom.window.document.querySelector(".assistant-drafts"), null);
  assert.equal(
    r.dom.window.document.querySelectorAll(".reply-review").length,
    1,
  );
  assert.equal(
    Array.from(r.dom.window.document.querySelectorAll("button")).some(
      (b) => b.textContent === "Tạo bản nháp",
    ),
    false,
  );
  await r.click("Kiểm tra lại nháp");
  assert.deepEqual(r.calls.at(-1), {
    type: "draft.review",
    draftId: "ai",
    text: "AI reply",
  });
  assert.equal(
    r.calls.some((c) => ["draft.send", "conversation.send"].includes(c.type)),
    false,
  );
});

test("manual sync is accessible and keeps the current composer text", async (t) => {
  const r = await mount(t);
  await r.type("Keep my unsent message");
  await r.click("Đồng bộ tin mới");
  assert.deepEqual(r.calls.at(-1), {
    type: "conversation.sync",
    conversationId: "c",
  });
  assert.equal(r.composition().text, "Keep my unsent message");
});

test("undo of a new message does not restore a previously sent message", async (t) => {
  const r = await mount(t);
  await r.type("Already sent");
  await r.click("Gửi");
  await r.type("New message");
  await act(async () =>
    r.input().dispatchEvent(
      new r.dom.window.KeyboardEvent("keydown", {
        key: "z",
        keyCode: 90,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal(r.composition().text, "");
  assert.equal(r.input().textContent, "");
});

test("multiline Vietnamese and literal markup remain plain text; overlong drafts cannot send", async (t) => {
  const r = await mount(t);
  await r.type("Chào bạn\n\n<em>Hẹn gặp ngày mai</em>");
  assert.equal(r.composition().text, "Chào bạn\n\n<em>Hẹn gặp ngày mai</em>");
  await r.click("Gửi");
  const sent = r.calls.at(-1);
  assert.equal(sent?.type, "conversation.send");
  if (sent?.type === "conversation.send")
    assert.equal(sent.text, "Chào bạn\n\n<em>Hẹn gặp ngày mai</em>");
  await r.type("x".repeat(5001));
  assert.equal(r.input().textContent!.length, 5001);
  assert.equal(
    r.dom.window.document.querySelector<HTMLButtonElement>(
      '[aria-label="Gửi"]',
    )!.disabled,
    true,
  );
  await act(async () =>
    r.input().dispatchEvent(
      new r.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    ),
  );
  assert.equal(r.calls.filter((c) => c.type === "conversation.send").length, 1);
});

test("uncertain disables editing without losing the current text", async (t) => {
  const r = await mount(t);
  await r.type("Chưa gửi");
  r.state.drafts.push({
    id: "uncertain",
    conversationId: "c",
    text: "Previous send",
    basedOnId: null,
    triggerIds: [],
    proactive: false,
    status: "uncertain",
    createdAt: 1,
  });
  await r.refresh();
  assert.equal(r.input().getAttribute("contenteditable"), "false");
  assert.equal(r.input().getAttribute("aria-disabled"), "true");
  assert.equal(r.input().textContent, "Chưa gửi");
});
