import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { readScript, sendCheck } from "../src/core/dom.ts";
import type { DOMProfile } from "../src/core/types.ts";
const profile: DOMProfile = {
  version: 1,
  platform: "messenger-personal",
  verified: false,
  threadSelector: "[data-thread-id]",
  threadIdAttribute: "data-thread-id",
  messageSelector: "[data-message-id]",
  messageIdAttribute: "data-message-id",
  textSelector: ".text",
  directionAttribute: "data-direction",
  incomingValue: "incoming",
  outgoingValue: "outgoing",
  timestampAttribute: "data-timestamp",
  composerSelector: "textarea",
  sendSelector: "button",
  listSelector: "[data-inbox]",
  linkSelector: "a[href]",
};
const html = `<div data-thread-id="123"><div data-message-id="m1" data-direction="incoming" data-timestamp="2026-10-03T01:00:00+07:00"><span class="text">Xin chào</span></div><div data-message-id="m2" data-direction="outgoing" data-timestamp="1790964100000"><span class="text">Chào bạn</span></div></div><textarea></textarea><button>Gửi</button>`;
function dom(source = html) {
  return new JSDOM(source, { runScripts: "outside-only" });
}
test("DOM fixture reads trusted ID, direction, text and absolute timestamps", () => {
  const d = dom(),
    result = vm.runInContext(readScript(profile), d.getInternalVMContext());
  assert.equal(result.threadId, "123");
  assert.equal(result.invalid, 0);
  assert.equal(result.messages[0].direction, "incoming");
  assert.equal(result.messages[1].direction, "outgoing");
  assert.equal(
    result.messages[0].timestamp,
    Date.parse("2026-10-03T01:00:00+07:00"),
  );
  d.window.close();
});
test("relative time cannot become trusted timestamp", () => {
  const d = dom(html.replace("2026-10-03T01:00:00+07:00", "1 giờ trước"));
  const result = vm.runInContext(readScript(profile), d.getInternalVMContext());
  assert.equal(result.messages[0].timestamp, null);
  assert.equal(result.invalid, 1);
  d.window.close();
});
test("send preflight blocks thread drift, incoming drift and manual composer", () => {
  const d = dom();
  const call = (thread: string, latest: string) =>
    vm.runInContext(
      `(${sendCheck.toString()})(${JSON.stringify(profile)},${JSON.stringify(thread)},${JSON.stringify(latest)},"Tin thử")`,
      d.getInternalVMContext(),
    );
  assert.equal(call("123", "m2"), true);
  assert.throws(() => call("999", "m2"), /Hội thoại/);
  assert.throws(() => call("123", "m1"), /tin mới/);
  d.window.document.querySelector("textarea")!.value = "Đang soạn";
  assert.throws(() => call("123", "m2"), /Người dùng/);
  d.window.close();
});
