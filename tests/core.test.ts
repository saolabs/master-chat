import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  commitSummary,
  history,
  ingest,
  searchKnowledge,
  summaryBatch,
} from "../src/core/conversation.ts";
import { seal, unseal } from "../src/core/crypto.ts";
import { inboxUrl, localAIUrl, threadIdentity } from "../src/core/urls.ts";
import type { Conversation, Message } from "../src/core/types.ts";
function conversation(): Conversation {
  return {
    id: "c",
    accountId: "a",
    platformId: "123",
    name: "Demo",
    url: "https://www.facebook.com/messages/t/123/",
    messages: [],
    initialized: false,
    autoReply: false,
    pendingIds: [],
    summary: { text: "", coveredIds: [], revision: 0 },
  };
}
function message(
  n: number,
  direction: Message["direction"] = "incoming",
  timestamp: number | null = 1000 + n,
): Omit<Message, "baseline"> {
  return {
    id: String(n),
    text: `Tin ${n}`,
    direction,
    timestamp,
    observedAt: 10000,
  };
}
test("first observation is baseline even when unread/newer than cutoff", () => {
  const c = conversation();
  assert.deepEqual(ingest(c, [message(1)], 0), []);
  assert.equal(c.messages[0].baseline, true);
});
test("old unread, missing timestamp and future timestamp never enqueue", () => {
  const c = conversation();
  ingest(c, [message(1)], 2000);
  ingest(
    c,
    [message(2), message(3, "incoming", null), message(4, "incoming", 1000000)],
    2000,
  );
  assert.deepEqual(c.pendingIds, []);
  assert.equal(c.messages.length, 4);
});
test("new burst deduplicates and ID replay cannot enqueue again", () => {
  const c = conversation();
  ingest(c, [message(1)], 1000);
  ingest(c, [message(2), message(3), message(3)], 1000);
  assert.deepEqual(c.pendingIds, ["2", "3"]);
  c.pendingIds = [];
  assert.deepEqual(ingest(c, [message(2), message(3)], 1000), []);
});
test("outgoing clears older pending but later incoming remains eligible", () => {
  const c = conversation();
  ingest(c, [message(1)], 0);
  ingest(c, [message(2)], 0);
  ingest(c, [message(3, "outgoing"), message(4)], 0);
  assert.deepEqual(c.pendingIds, ["4"]);
});
test("nine messages need no summary; rank ten is covered exactly once", () => {
  const c = conversation();
  ingest(
    c,
    Array.from({ length: 9 }, (_, n) => message(n + 1)),
    0,
  );
  assert.equal(summaryBatch(c).length, 0);
  ingest(c, [message(10)], 0);
  const batch = summaryBatch(c);
  assert.deepEqual(
    batch.map((m) => m.id),
    ["1"],
  );
  c.summary = commitSummary(c.summary, batch, "Ngữ cảnh");
  assert.equal(summaryBatch(c).length, 0);
  ingest(c, [message(11)], 0);
  assert.deepEqual(
    summaryBatch(c).map((m) => m.id),
    ["2"],
  );
  assert.equal(history(c).length, 10);
});
test("initial context uses 50 older + nine recent, raw is retained", () => {
  const c = conversation();
  ingest(
    c,
    Array.from({ length: 59 }, (_, n) => message(n + 1)),
    0,
  );
  const batch = summaryBatch(c);
  assert.equal(batch.length, 50);
  c.summary = commitSummary(c.summary, batch, "Tóm tắt");
  assert.equal(history(c).length, 9);
  assert.equal(c.messages.length, 59);
});
test("summary failure never advances coverage or discards history", () => {
  const c = conversation();
  ingest(
    c,
    Array.from({ length: 12 }, (_, n) => message(n + 1)),
    0,
  );
  assert.throws(() => commitSummary(c.summary, summaryBatch(c), " "));
  assert.equal(c.summary.revision, 0);
  assert.equal(history(c).length, 12);
});
test("summary backlog drains in bounded batches without dropping messages", () => {
  const c = conversation();
  ingest(
    c,
    Array.from({ length: 125 }, (_, n) => message(n + 1)),
    0,
  );
  const batches = [];
  while (summaryBatch(c).length) {
    const batch = summaryBatch(c);
    batches.push(batch.length);
    c.summary = commitSummary(c.summary, batch, "Tóm tắt");
  }
  assert.deepEqual(batches, [50, 50, 16]);
  assert.equal(history(c).length, 9);
});
test("vault authenticates bytes and rejects tampering/wrong key", () => {
  const key = randomBytes(32),
    raw = '{"password":"private","message":"Tin riêng"}',
    bytes = seal(raw, key);
  assert.equal(unseal(bytes, key), raw);
  assert.equal(bytes.includes(Buffer.from("private")), false);
  assert.throws(() => unseal(bytes, randomBytes(32)));
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] ^= 1;
  assert.throws(() => unseal(changed, key));
});
test("AI allows only fixed loopback IP and rejects remote/credentials/query", () => {
  for (const u of ["http://127.0.0.1:11434/v1", "http://[::1]:1234/v1/"])
    assert.ok(localAIUrl(u));
  for (const u of [
    "https://api.openai.com/v1",
    "http://localhost:11434/v1",
    "http://127.0.0.1.evil.com/v1",
    "http://user:pass@127.0.0.1/v1",
    "http://127.0.0.1/v1?proxy=remote",
    "file:///v1",
  ])
    assert.throws(() => localAIUrl(u));
});
test("personal supports both encrypted and classic thread URLs", () => {
  assert.equal(
    threadIdentity(
      "https://www.facebook.com/messages/e2ee/t/123/#",
      "messenger-personal",
    ),
    "123",
  );
  assert.equal(
    threadIdentity(
      "https://www.facebook.com/messages/t/123/",
      "messenger-personal",
    ),
    "123",
  );
  assert.equal(
    threadIdentity("https://www.facebook.com/messages/", "messenger-personal"),
    null,
  );
  assert.throws(() =>
    threadIdentity(
      "https://facebook.com.evil.com/messages/t/123",
      "messenger-personal",
    ),
  );
});
test("knowledge retrieval respects account scope", () => {
  const items = [
    { title: "Giờ mở cửa", text: "Mở từ 8h", accountId: "a" },
    { title: "Giờ mở cửa", text: "Mở từ 9h", accountId: "b" },
    { title: "Chung", text: "Giờ nghỉ", accountId: null },
  ];
  assert.deepEqual(
    searchKnowledge(items, "giờ", "a").map((i) => i.accountId),
    ["a", null],
  );
});
