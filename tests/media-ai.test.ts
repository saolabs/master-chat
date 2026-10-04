import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMedia,
  providerChat,
  type ChatMessage,
} from "../electron/ai.ts";
import { emptyState, type AIProvider } from "../src/core/types.ts";
const provider = (type: AIProvider["type"]): AIProvider => ({
  id: "media-test",
  name: "Media test",
  type,
  baseUrl: "https://api.example.com/v1beta",
  apiKey: "media-secret",
  enabled: true,
  allowRemote: true,
  models: ["model"],
  availableModels: [],
});
const selection = { providerId: "media-test", modelId: "model" };
const image: ChatMessage[] = [
  { role: "system", content: "Stable instructions" },
  {
    role: "user",
    content: [
      { type: "text", text: "Describe" },
      {
        type: "media",
        media: { kind: "image", mimeType: "image/png", data: "AQID" },
      },
    ],
  },
];
function mockResponse(type: AIProvider["type"]) {
  return new Response(
    JSON.stringify(
      type === "google"
        ? { candidates: [{ content: { parts: [{ text: "Read content" }] } }] }
        : type === "anthropic"
          ? { content: [{ type: "text", text: "Read content" }] }
          : { choices: [{ message: { content: "Read content" } }] },
    ),
  );
}
test("image payload uses native provider protocols and stable instruction cache hints", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  for (const type of ["openai", "anthropic", "google"] as const) {
    globalThis.fetch = (async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      assert.ok(!JSON.stringify(body).includes("facebook.com"));
      if (type === "openai") {
        assert.equal(
          body.messages[1].content[1].image_url.url,
          "data:image/png;base64,AQID",
        );
        assert.match(body.prompt_cache_key, /^[a-f0-9]{64}$/);
      }
      if (type === "anthropic") {
        assert.equal(
          body.messages[0].content[1].source.media_type,
          "image/png",
        );
        assert.equal(body.system[0].cache_control.type, "ephemeral");
      }
      if (type === "google") {
        assert.equal(
          body.contents[0].parts[1].inlineData.mimeType,
          "image/png",
        );
        assert.equal(
          body.systemInstruction.parts[0].text,
          "Stable instructions",
        );
      }
      return mockResponse(type);
    }) as typeof fetch;
    assert.equal(
      await providerChat(provider(type), selection, image, undefined, {
        cacheInstructions: true,
      }),
      "Read content",
    );
  }
});
test("chat models never receive raw voice payloads even if their API supports audio", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return mockResponse("google");
  }) as typeof fetch;
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "media",
          media: { kind: "audio", mimeType: "audio/mp4", data: "AQID" },
        },
      ],
    },
  ];
  for (const type of ["google", "openai", "anthropic"] as const)
    await assert.rejects(
      providerChat(provider(type), selection, messages),
      /phiên âm thành văn bản/,
    );
  const state = emptyState();
  state.ai.providers = [provider("google")];
  state.ai.default = selection;
  await assert.rejects(
    analyzeMedia(
      state.ai,
      { kind: "audio", mimeType: "audio/mp4", data: "AQID" },
      selection,
    ),
    /chuyên phiên âm/,
  );
  assert.equal(calls, 0);
});
test("a dedicated transcription model receives bounded multipart audio and preserves provider permission", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  const state = emptyState(),
    p = provider("openai");
  p.models.push("whisper-1");
  state.ai.providers = [p];
  state.ai.default = selection;
  let calls = 0;
  globalThis.fetch = (async (url, options) => {
    calls++;
    assert.match(String(url), /audio\/transcriptions$/);
    assert.equal(options!.redirect, "error");
    assert.equal((options!.body as FormData).get("model"), "whisper-1");
    assert.equal(((options!.body as FormData).get("file") as File).size, 3);
    return new Response(JSON.stringify({ text: "Hẹn bạn lúc 10 giờ." }));
  }) as typeof fetch;
  const voice = { kind: "audio" as const, mimeType: "audio/mp4", data: "AQID" };
  assert.equal(
    await analyzeMedia(state.ai, voice, { ...selection, modelId: "whisper-1" }),
    "Hẹn bạn lúc 10 giờ.",
  );
  p.allowRemote = false;
  await assert.rejects(
    analyzeMedia(state.ai, voice, { ...selection, modelId: "whisper-1" }),
    /riêng tư/,
  );
  assert.equal(calls, 1);
});
test("Gemini reuses instruction handles, recovers from expired cache, and refreshes when instructions change", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  const p = provider("google");
  p.id = "cache-test";
  const choose = { ...selection, providerId: p.id };
  let creates = 0,
    generations = 0,
    expire = false;
  const messages: ChatMessage[] = [
    { role: "system", content: "Instruction ".repeat(1200) },
    { role: "user", content: "Question" },
  ];
  globalThis.fetch = (async (url, options) => {
    const body = JSON.parse(options!.body as string);
    if (String(url).endsWith("/cachedContents")) {
      creates++;
      assert.equal(body.ttl, "600s");
      assert.match(body.systemInstruction.parts[0].text, /Instruction/);
      return new Response(JSON.stringify({ name: "cachedContents/cache-id" }));
    }
    generations++;
    if (expire && body.cachedContent) {
      expire = false;
      return new Response("expired", { status: 404 });
    }
    if (generations <= 2) {
      assert.equal(body.cachedContent, "cachedContents/cache-id");
      assert.equal(body.systemInstruction, undefined);
    }
    return mockResponse("google");
  }) as typeof fetch;
  for (let n = 0; n < 2; n++)
    await providerChat(p, choose, messages, undefined, {
      cacheInstructions: true,
    });
  assert.equal(creates, 1);
  expire = true;
  await providerChat(p, choose, messages, undefined, {
    cacheInstructions: true,
  });
  assert.equal(generations, 4);
  messages[0].content += "Changed";
  await providerChat(p, choose, messages, undefined, {
    cacheInstructions: true,
  });
  assert.equal(creates, 2);
});
test("cache creation failure falls back without repeating failed creation on each reply", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  const p = provider("google");
  p.id = "cache-unsupported";
  let creates = 0;
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/cachedContents")) {
      creates++;
      return new Response("not supported", { status: 400 });
    }
    const body = JSON.parse(options!.body as string);
    assert.ok(body.systemInstruction);
    return mockResponse("google");
  }) as typeof fetch;
  const messages: ChatMessage[] = [
    { role: "system", content: "Instruction ".repeat(1200) },
    { role: "user", content: "Question" },
  ];
  for (let n = 0; n < 2; n++)
    await providerChat(
      p,
      { ...selection, providerId: p.id },
      messages,
      undefined,
      { cacheInstructions: true },
    );
  assert.equal(creates, 1);
});
