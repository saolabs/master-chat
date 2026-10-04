import test from "node:test";
import assert from "node:assert/strict";
import {
  parseProfile,
  profileBatches,
  profileSamples,
  profileSourceHashes,
} from "../src/core/contact-profile.ts";
import {
  reviewSelection,
  isDifferentReviewModel,
  parseReview,
} from "../src/core/reply-quality.ts";
import { emptyState, type Conversation } from "../src/core/types.ts";
import { replyInstructions } from "../src/core/response-style.ts";
const c = (): Conversation => ({
  id: "c",
  accountId: "a",
  platformId: "123",
  name: "Friend",
  url: "https://www.facebook.com/messages/t/123/",
  messages: [],
  initialized: true,
  autoReply: false,
  pendingIds: [],
  summary: { text: "", coveredIds: [], revision: 0 },
});
test("profile uses both sides and cached voice text but excludes AI and events", () => {
  const state = emptyState(),
    contact = c();
  contact.messages = ["owner", "ai", "incoming", "voice", "system"].map(
    (id, i) => ({
      id,
      text: i === 3 ? "" : id,
      direction: i === 4 ? "system" : i < 2 ? "outgoing" : "incoming",
      timestamp: i,
      observedAt: i,
      baseline: true,
      ...(i === 3
        ? {
            attachments: [
              { id: "voice", kind: "audio" as const, analysis: "Hẹn mười giờ" },
            ],
          }
        : {}),
    }),
  );
  state.drafts.push({
    id: "draft",
    conversationId: "c",
    text: "ai",
    status: "sent",
    origin: "ai",
    basedOnId: null,
    triggerIds: [],
    proactive: false,
    createdAt: 0,
  });
  assert.deepEqual(
    profileSamples(state, contact).map((m) => m.id),
    ["owner", "incoming", "voice"],
  );
  const before = profileSourceHashes(contact.messages);
  contact.messages[3].attachments![0].analysis = "Hẹn lúc mười một giờ";
  assert.notEqual(before.voice, profileSourceHashes(contact.messages).voice);
});
test("profile requires real evidence IDs and owner evidence for style; batch limits retain every message", () => {
  const base = {
    relationship: null,
    address: null,
    style: null,
    facts: [],
    cautions: [],
  };
  assert.throws(
    () =>
      parseProfile(
        JSON.stringify({
          ...base,
          relationship: { detail: "Bạn bè", evidenceIds: ["invented"] },
        }),
        new Set(["owner", "other"]),
        new Set(["owner"]),
      ),
    /không có/,
  );
  assert.throws(
    () =>
      parseProfile(
        JSON.stringify({
          ...base,
          style: { detail: "mày/tao", evidenceIds: ["other"] },
        }),
        new Set(["owner", "other"]),
        new Set(["owner"]),
      ),
    /chủ tài khoản/,
  );
  const messages = Array.from({ length: 250 }, (_, n) => ({
    id: String(n),
    text: "x".repeat(1000),
    direction: "incoming" as const,
    timestamp: n,
    observedAt: n,
    baseline: true,
  }));
  const batches = profileBatches(messages);
  assert.equal(batches.flat().length, 250);
  assert.ok(
    batches.every(
      (batch) =>
        batch.length <= 100 &&
        batch.reduce((n, m) => n + m.text.length, 0) <= 32000,
    ),
  );
});
test("relationship facts and conversation direction remain optional and distinct; latest topic takes priority", () => {
  const contact = c();
  contact.relationshipContext = "Bạn cùng lớp, đang buồn vì chuyện gia đình.";
  contact.conversationDirection = "Lắng nghe, gợi mở nhẹ nhàng khi phù hợp.";
  const prompt = replyInstructions(undefined, contact);
  assert.match(prompt, /Ngữ cảnh quan hệ do chủ tài khoản/);
  assert.match(prompt, /Định hướng trò chuyện do chủ tài khoản/);
  assert.match(prompt, /không gán ẩn ý/);
  assert.match(prompt, /không luôn kết bằng câu hỏi/);
  assert.match(prompt, /Không tự nhận đã nghiên cứu/);
  assert.ok(prompt.includes(contact.relationshipContext));
  assert.ok(prompt.includes(contact.conversationDirection));
  assert.match(replyInstructions(undefined, c()), /ít nhất 50 tin/);
});
test("review auto selection uses a distinct chat model from the same provider and explicit selection stays explicit", () => {
  const ai = emptyState().ai;
  ai.default = { providerId: "p", modelId: "writer" };
  ai.providers = [
    {
      id: "p",
      name: "P",
      type: "ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      allowRemote: false,
      enabled: true,
      models: ["writer", "whisper", "text-embedding", "reviewer"],
      availableModels: [],
    },
    {
      id: "remote",
      name: "Remote",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      allowRemote: true,
      enabled: true,
      models: ["other"],
      availableModels: [],
    },
  ];
  assert.deepEqual(reviewSelection(ai), {
    providerId: "p",
    modelId: "reviewer",
  });
  assert.equal(reviewSelection(ai, { enabled: false }), null);
  ai.providers[0].models = ["writer"];
  assert.equal(reviewSelection(ai), null);
  assert.deepEqual(
    reviewSelection(ai, { model: { providerId: "remote", modelId: "other" } }),
    { providerId: "remote", modelId: "other" },
  );
  assert.equal(
    isDifferentReviewModel(ai.default, {
      providerId: "remote",
      modelId: "WRITER",
    }),
    false,
  );
});
test("review parser rejects free text, oversized content, empty corrections and unknown directives", () => {
  assert.throws(() => parseReview("Gửi tin này ngay"));
  assert.throws(
    () => parseReview(JSON.stringify({ verdict: "revise", issues: [] })),
    /nội dung sửa/,
  );
  assert.throws(() =>
    parseReview(JSON.stringify({ verdict: "approve", issues: [], send: true })),
  );
  assert.throws(() => parseReview("x".repeat(12001)), /quá dài/);
  assert.equal(
    parseReview('```json\n{"verdict":"hold","issues":["Cần xác nhận"]}\n```')
      .verdict,
    "hold",
  );
});
