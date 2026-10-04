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
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
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
    dom.window.document.querySelector<HTMLTextAreaElement>(
      ".chat-composer textarea",
    )!;
  const click = async (text: string) => {
    const button = Array.from(
      dom.window.document.querySelectorAll("button"),
    ).find((b) => b.textContent === text);
    assert.ok(button, text);
    await act(async () => button.click());
  };
  const type = async (text: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input(), text);
      input().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
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
  assert.equal(r.input().value, "My reply");
});

test("AI draft fills the chat composer, edits use the same draft, and successful send clears it", async (t) => {
  const r = await mount(t);
  await r.click("Tạo bản nháp");
  assert.equal(r.input().value, "AI reply");
  assert.equal(r.calls.filter((c) => c.type === "draft.send").length, 0);
  await r.type("Edited AI reply");
  await r.click("Gửi");
  assert.deepEqual(r.calls.at(-1), {
    type: "draft.send",
    draftId: "ai",
    text: "Edited AI reply",
  });
  assert.equal(r.input().value, "");
});

test("explicit send-after-generation sends once and discarding a draft keeps composer empty", async (t) => {
  const r = await mount(t);
  const checkbox = Array.from(r.dom.window.document.querySelectorAll("label"))
    .find((l) => l.textContent?.includes("Gửi ngay sau khi tạo nháp"))!
    .querySelector("input")!;
  await act(async () => checkbox.click());
  await r.click("Tạo bản nháp");
  assert.equal(r.calls.filter((c) => c.type === "draft.send").length, 1);
  assert.equal(r.input().value, "");
  await act(async () => checkbox.click());
  r.state.drafts = [];
  await r.click("Tạo bản nháp");
  await r.click("Xóa nội dung");
  assert.equal(r.input().value, "");
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
  assert.equal(r.input().value, "Keep this");
  await r.click("Đưa vào ô soạn");
  r.state.drafts[0].status = "stale";
  await r.refresh();
  assert.equal(
    Array.from(r.dom.window.document.querySelectorAll("button")).find(
      (b) => b.textContent === "Gửi",
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
  assert.equal(r.input().value, "Other AI");
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
  await act(async () =>
    r.input().dispatchEvent(
      new r.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    ),
  );
  assert.equal(r.calls.filter((c) => c.type === "conversation.send").length, 1);
  assert.equal(r.input().value, "");
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

test("a held review fills composer but cannot use send-after-generation", async (t) => {
  const r = await mount(t, {
    status: "held",
    issues: ["Lời hứa cần xác nhận"],
    checkedAt: 1,
  });
  const checkbox = Array.from(r.dom.window.document.querySelectorAll("label"))
    .find((l) => l.textContent?.includes("Gửi ngay sau khi tạo nháp"))!
    .querySelector("input")!;
  await act(async () => checkbox.click());
  await r.click("Tạo bản nháp");
  assert.equal(r.input().value, "AI reply");
  assert.equal(r.calls.filter((c) => c.type === "draft.send").length, 0);
  assert.match(
    r.dom.window.document.querySelector(".chat-composer")!.textContent!,
    /Cần bạn xem lại/,
  );
  await r.click("Gửi");
  assert.equal(r.calls.filter((c) => c.type === "draft.send").length, 1);
});
