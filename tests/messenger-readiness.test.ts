import test from "node:test";
import assert from "node:assert/strict";
import {
  messengerReadIssue,
  waitForMessengerRead,
} from "../src/core/messenger-readiness.ts";
import type { MessengerRead } from "../src/core/messenger.ts";

const expected = { platformId: "123", name: "Roy X8Gaming" };
const ready: MessengerRead = {
  threadId: "123",
  selectedThreadId: "123",
  name: "Roy X8Gaming",
  messages: [],
  composerPresent: true,
  sendPresent: true,
  invalid: 0,
  ambiguous: 0,
  blocked: false,
  revision: 0,
};
test("history completion waits through transient selected link and recipient hydration", async () => {
  const reads = [
    { ...ready, selectedThreadId: null },
    { ...ready, name: "Previous recipient" },
    ready,
  ];
  let attempts = 0,
    delays = 0;
  const result = await waitForMessengerRead(
    async () => reads[attempts++],
    expected,
    "Hoàn tất tải lịch sử",
    async () => {
      delays++;
    },
  );
  assert.equal(result, ready);
  assert.equal(attempts, 3);
  assert.equal(delays, 2);
});
test("persistent read failures identify each actual cause without accepting an unsafe read", async () => {
  for (const [change, reason] of [
    [{ blocked: true }, /PIN/],
    [{ threadId: "999" }, /URL hội thoại/],
    [{ selectedThreadId: "999" }, /Danh sách chat/],
    [{ composerPresent: false }, /Ô soạn/],
    [{ name: "Other" }, /Tên người nhận/],
    [{ ambiguous: 2 }, /2 tin trùng/],
  ] as [Partial<MessengerRead>, RegExp][]) {
    let calls = 0;
    await assert.rejects(
      waitForMessengerRead(
        async () => {
          calls++;
          return { ...ready, ...change };
        },
        expected,
        "Hoàn tất tải lịch sử",
        async () => {},
      ),
      reason,
    );
    assert.equal(calls, 12);
  }
  assert.equal(
    messengerReadIssue({ ...ready, name: " Roy X8Gaming " }, expected),
    null,
  );
});
