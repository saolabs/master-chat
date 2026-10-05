import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { AppFeedback } from "../src/renderer/app-feedback.tsx";
import { InboxControls } from "../src/renderer/inbox-controls.tsx";
import { emptyState, publicState, type Snapshot } from "../src/core/types.ts";

const reason =
  "Facebook tạm thời chặn tính năng do thao tác quá nhanh. Đồng bộ tài khoản đã dừng.";
function render(
  pauseReason: string,
  notice: string,
  error: string,
  paused = true,
) {
  const snapshot: Snapshot = {
    data: publicState(emptyState()),
    tabs: [],
    paused,
    pauseReason,
    notice,
  };
  return new JSDOM(
    renderToStaticMarkup(
      <>
        <InboxControls
          snapshot={snapshot}
          busy={false}
          run={async () => snapshot}
        />
        <AppFeedback
          snapshot={snapshot}
          error={error}
          dismissError={() => {}}
        />
      </>,
    ),
  );
}

test("the same pause warning appears once as a toast without inline blocks", () => {
  for (const notice of [reason, `Tự trả lời tạm dừng · ${reason}`]) {
    const dom = render(
      reason,
      notice,
      `Error invoking remote method 'app:command': Error: ${reason}`,
    );
    try {
      const doc = dom.window.document;
      assert.equal(doc.querySelector(".pause-reason"), null);
      assert.match(
        doc.querySelector(".app-toast.warning")!.textContent!,
        /Facebook tạm thời chặn/,
      );
      assert.equal(doc.querySelectorAll(".app-toast").length, 1);
      assert.equal(doc.querySelector(".activity-bar"), null);
      assert.equal(doc.querySelector('[role="alert"]'), null);
      assert.doesNotMatch(doc.body.textContent!, /app:command/);
      assert.equal(doc.body.textContent!.split(reason).length - 1, 1);
    } finally {
      dom.window.close();
    }
  }
});
test("a distinct command failure is still shown without Electron transport prefixes", () => {
  const dom = render(
    reason,
    reason,
    "Error invoking remote method 'app:command': Error: Không lưu được thiết lập.",
  );
  try {
    assert.match(
      dom.window.document.querySelector('[role="alert"]')!.textContent!,
      /Không lưu được thiết lập/,
    );
    assert.doesNotMatch(
      dom.window.document.body.textContent!,
      /app:command|Error:/,
    );
    assert.equal(dom.window.document.querySelector(".activity-bar"), null);
  } finally {
    dom.window.close();
  }
});
test("new activity remains visible and an inactive pause reason cannot hide errors", () => {
  const dom = render(reason, "Đã đồng bộ tin mới.", `Error: ${reason}`, false);
  try {
    assert.equal(dom.window.document.querySelector(".pause-reason"), null);
    assert.match(
      dom.window.document.querySelector(".app-toast.info")!.textContent!,
      /Đã đồng bộ tin mới/,
    );
    assert.match(
      dom.window.document.querySelector('[role="alert"]')!.textContent!,
      /Facebook tạm thời chặn/,
    );
  } finally {
    dom.window.close();
  }
});

test("toasts expire without reopening on snapshot polling, while errors wait for dismissal", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.test/" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const snapshot: Snapshot = {
    data: publicState(emptyState()),
    tabs: [],
    paused: true,
    pauseReason: reason,
    notice: "Đã đồng bộ tin mới.",
  };
  let closed = 0;
  const rerender = async () => {
    await act(async () =>
      root.render(
        <AppFeedback
          snapshot={{ ...snapshot }}
          error="Error: Không lưu được thiết lập."
          dismissError={() => closed++}
        />,
      ),
    );
  };
  try {
    await rerender();
    assert.equal(dom.window.document.querySelectorAll(".app-toast").length, 3);
    await act(async () => t.mock.timers.tick(6_000));
    assert.equal(dom.window.document.querySelector(".app-toast.info"), null);
    assert.ok(dom.window.document.querySelector(".app-toast.warning"));
    await act(async () => t.mock.timers.tick(4_000));
    assert.equal(dom.window.document.querySelector(".app-toast.warning"), null);
    assert.ok(dom.window.document.querySelector('[role="alert"]'));
    await rerender();
    assert.equal(dom.window.document.querySelectorAll(".app-toast").length, 1);
    await act(async () =>
      (
        dom.window.document.querySelector(
          ".app-toast.error button",
        ) as HTMLButtonElement
      ).click(),
    );
    assert.equal(closed, 1);
    await rerender();
    assert.equal(dom.window.document.querySelectorAll(".app-toast").length, 0);
    snapshot.notice = "Đã lưu thiết lập.";
    await rerender();
    assert.match(
      dom.window.document.querySelector(".app-toast.info")!.textContent!,
      /Đã lưu thiết lập/,
    );
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset();
    dom.window.close();
  }
});
