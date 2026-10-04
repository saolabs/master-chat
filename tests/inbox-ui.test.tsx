import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { InboxControls, InboxRows } from "../src/renderer/inbox-controls.tsx";
import { emptyState, publicState, type Snapshot } from "../src/core/types.ts";

function fixture(): Snapshot {
  const s = emptyState();
  s.accounts.push({
    id: "a",
    name: "Me",
    platform: "messenger-personal",
    username: "",
    password: "",
    cookies: [],
    autoDiscoverReply: true,
    inboxOrder: ["2", "1"],
  });
  s.conversations = ["1", "2"].map((id) => ({
    id,
    platformId: id,
    accountId: "a",
    name: `Friend ${id}`,
    url: "",
    messages: [],
    initialized: true,
    autoReply: true,
    pendingIds: [],
    summary: { text: "", coveredIds: [], revision: 0 },
  }));
  s.conversations[1].inboxPreview = "New inbox preview";
  s.conversations[1].inboxUnread = true;
  s.drafts.push({
    id: "draft",
    conversationId: "2",
    text: "Held reply",
    status: "draft",
    basedOnId: null,
    triggerIds: [],
    proactive: false,
    createdAt: 1,
    review: { status: "unavailable", issues: [], checkedAt: 1 },
  });
  return { data: publicState(s), paused: false, notice: "", tabs: [] };
}
test("list follows current inbox order while preserving selection and showing held replies", () => {
  const d = new JSDOM(
    renderToStaticMarkup(
      <InboxRows snapshot={fixture()} selected="1" select={() => {}} />,
    ),
  );
  try {
    const rows = d.window.document.querySelectorAll("button");
    assert.match(
      rows[0].textContent!,
      /Friend 2.*New inbox preview.*Cần kiểm tra/,
    );
    assert.ok(rows[0].classList.contains("unread"));
    assert.ok(rows[1].classList.contains("selected"));
  } finally {
    d.window.close();
  }
});
test("global controls distinguish paused, running and sync-only states", () => {
  const snapshot = fixture();
  const render = () =>
    renderToStaticMarkup(
      <InboxControls
        snapshot={snapshot}
        busy={false}
        run={async () => snapshot}
      />,
    );
  assert.match(render(), /Tự trả lời đang chạy/);
  snapshot.paused = true;
  snapshot.pauseReason = "App vừa mở";
  const d = new JSDOM(render());
  try {
    assert.match(d.window.document.body.textContent!, /Tự trả lời đang dừng/);
    assert.equal(d.window.document.querySelector("button")!.disabled, false);
    assert.match(d.window.document.body.textContent!, /App vừa mở/);
    assert.equal(
      d.window.document
        .querySelector('[role="toolbar"]')
        ?.getAttribute("aria-label"),
      "Tự trả lời toàn ứng dụng",
    );
    assert.equal(d.window.document.querySelectorAll("button").length, 3);
  } finally {
    d.window.close();
  }
  snapshot.paused = false;
  snapshot.data.conversations.forEach((c) => (c.autoReply = false));
  assert.match(render(), /Chỉ đồng bộ/);
});
test("review warnings are advisory for automatic drafts, uncertain remains actionable", () => {
  const snapshot = fixture();
  snapshot.data.drafts[0].automatic = true;
  snapshot.data.conversations[1].pendingIds = ["fresh"];
  const render = () =>
    renderToStaticMarkup(<InboxRows snapshot={snapshot} select={() => {}} />);
  assert.doesNotMatch(render(), /Cần kiểm tra/);
  assert.match(render(), /Chờ trả lời/);
  snapshot.data.drafts[0].status = "uncertain";
  assert.match(render(), /Cần kiểm tra/);
});

test("background rows distinguish active generation, scheduled sending, pause and uncertain outcome", () => {
  const snapshot = fixture();
  snapshot.data.drafts[0].automatic = true;
  snapshot.data.conversations[1].pendingIds = ["fresh"];
  const render = () =>
    renderToStaticMarkup(
      <InboxRows snapshot={snapshot} selected="1" select={() => {}} />,
    );
  snapshot.replying = ["2"];
  assert.match(render(), /Đang soạn phản hồi/);
  snapshot.data.drafts[0].sendAfter = Date.now() + 30_000;
  assert.match(render(), /Chờ gửi \d{2}:\d{2}:\d{2}/);
  snapshot.paused = true;
  assert.match(render(), /Đang tạm dừng/);
  snapshot.data.drafts[0].status = "uncertain";
  assert.match(render(), /Chưa rõ kết quả gửi/);
});
