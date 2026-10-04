import test from "node:test";
import assert from "node:assert/strict";
import {
  characterCount,
  messageContent,
  replyDelay,
  replyInstructions,
  styleSamples,
  TYPING_SAMPLE,
  typingMeasurement,
} from "../src/core/response-style.ts";
import {
  allowedMediaSource,
  boundedMedia,
  MAX_MEDIA_BYTES,
} from "../src/core/media.ts";
import {
  emptyState,
  publicState,
  type Conversation,
} from "../src/core/types.ts";
import { history, ingest } from "../src/core/conversation.ts";
const conversation = (): Conversation => ({
  id: "c",
  accountId: "a",
  platformId: "123",
  name: "Friend",
  url: "https://www.facebook.com/messages/t/123/",
  initialized: true,
  autoReply: false,
  pendingIds: [],
  messages: [],
  summary: { text: "", coveredIds: [], revision: 0 },
});
test("typing calibration counts Vietnamese graphemes and rejects partial or implausible attempts", () => {
  assert.equal(characterCount("Mình".normalize("NFD") + "👨‍👩‍👧‍👦"), 5);
  assert.deepEqual(typingMeasurement(TYPING_SAMPLE.normalize("NFD"), 60000), {
    charactersPerMinute: characterCount(TYPING_SAMPLE) - 1,
    wordsPerMinute: Math.round((characterCount(TYPING_SAMPLE) - 1) / 5),
  });
  assert.equal(typingMeasurement(TYPING_SAMPLE.slice(1), 60000), null);
  assert.equal(typingMeasurement(TYPING_SAMPLE, 100), null);
  assert.equal(typingMeasurement(TYPING_SAMPLE, 600000), null);
});
test("optional delay follows actual length and measured rate, with a ceiling", () => {
  assert.equal(replyDelay("a".repeat(100)), 0);
  assert.equal(
    replyDelay("a".repeat(100), {
      enabled: true,
      charactersPerMinute: 300,
      thinkingMs: 1000,
    }),
    21000,
  );
  assert.equal(
    replyDelay("a".repeat(200), {
      enabled: true,
      charactersPerMinute: 300,
      thinkingMs: 1000,
    }),
    41000,
  );
  assert.equal(
    replyDelay("a".repeat(5000), {
      enabled: true,
      charactersPerMinute: 60,
      maxDelayMs: 120000,
    }),
    120000,
  );
});
test("common style is optional; contact profile requires 50 messages and owner override has priority", () => {
  const c = conversation();
  c.contactProfile = {
    version: 1,
    relationship: null,
    address: null,
    style: { detail: "Học: câu ngắn", evidenceIds: ["owner"] },
    facts: [],
    cautions: [],
    sourceIds: [],
    sourceHashes: {},
    messageCount: 49,
    ownerMessageCount: 25,
    updatedAt: 0,
  };
  assert.ok(!replyInstructions(undefined, c).includes("Học: câu ngắn"));
  c.contactProfile.messageCount = 50;
  c.responseStyle = "Gọi người này là chị";
  const prompt = replyInstructions(
    { aboutMe: "Tôi là lập trình viên", personality: "Vui vẻ" },
    c,
  );
  assert.match(prompt, /Học: câu ngắn/);
  assert.match(prompt, /ưu tiên hơn/);
  assert.match(prompt, /lập trình viên/);
  c.learnStyle = false;
  assert.ok(!replyInstructions(undefined, c).includes("Học: câu ngắn"));
});
test("style learning excludes incoming, sent AI drafts, and media-only outgoing messages", () => {
  const c = conversation(),
    state = emptyState();
  c.messages = ["Manual reply", "AI reply", "Incoming", "Media"].map(
    (text, i) => ({
      id: String(i),
      text,
      direction: i === 2 ? "incoming" : "outgoing",
      timestamp: i,
      observedAt: i,
      baseline: true,
      ...(i === 3
        ? { attachments: [{ id: "a", kind: "image" as const }] }
        : {}),
    }),
  );
  state.drafts = [
    {
      id: "d",
      conversationId: "c",
      text: "AI reply",
      status: "sent",
      origin: "ai",
      basedOnId: null,
      triggerIds: [],
      proactive: false,
      createdAt: 0,
    },
  ];
  assert.deepEqual(
    styleSamples(state, c).map((m) => m.text),
    ["Manual reply"],
  );
});
test("attachment hydration retains analysis and exposes cached content without signed source URLs", () => {
  const c = conversation(),
    state = emptyState();
  c.messages = [
    {
      id: "m",
      text: "Ảnh",
      direction: "incoming",
      timestamp: 0,
      observedAt: 0,
      baseline: true,
      attachments: [
        {
          id: "photo",
          kind: "image",
          source: "https://scontent.fbcdn.net/p.jpg?secret=old",
          analysis: "Hẹn 10 giờ",
          analyzedAt: 1,
        },
      ],
    },
  ];
  ingest(
    c,
    [
      {
        ...c.messages[0],
        attachments: [
          {
            id: "photo",
            kind: "image",
            source: "https://scontent.fbcdn.net/p.jpg?secret=new",
          },
        ],
      },
    ],
    null,
  );
  assert.match(history(c)[0].content, /Hẹn 10 giờ/);
  state.conversations = [c];
  assert.ok(!JSON.stringify(publicState(state)).includes("secret="));
  assert.match(
    messageContent({
      ...c.messages[0],
      attachments: [{ id: "voice", kind: "audio" }],
    }),
    /không suy đoán/,
  );
});
test("media sources are limited to Messenger page blobs and Facebook CDN domain boundaries", () => {
  for (const url of [
    "https://scontent.fbcdn.net/photo.jpg",
    "https://cdn.fbsbx.com/voice.mp4",
    "blob:https://www.facebook.com/voice-id",
  ])
    assert.equal(allowedMediaSource(url), true);
  for (const url of [
    "http://scontent.fbcdn.net/photo",
    "https://fbcdn.net.evil.test/photo",
    "https://127.0.0.1/photo",
    "https://a:secret@facebook.com/photo",
    "blob:https://evil.test/id",
  ])
    assert.equal(allowedMediaSource(url), false);
});
test("media reader checks MIME and bounds both declared and streaming bodies", async () => {
  const valid = await boundedMedia(
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "audio/mp4; codecs=mp4a" },
    }),
    "audio",
  );
  assert.equal(valid.data, "AQID");
  await assert.rejects(
    boundedMedia(
      new Response("<html>", { headers: { "content-type": "text/html" } }),
      "image",
    ),
    /Định dạng/,
  );
  await assert.rejects(
    boundedMedia(
      new Response("", {
        headers: {
          "content-type": "image/png",
          "content-length": String(MAX_MEDIA_BYTES + 1),
        },
      }),
      "image",
    ),
    /20 MB/,
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_MEDIA_BYTES));
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  await assert.rejects(
    boundedMedia(
      new Response(stream, { headers: { "content-type": "image/png" } }),
      "image",
    ),
    /20 MB/,
  );
});
