import test from "node:test";
import assert from "node:assert/strict";
import { resolveModel, migrateAI, providerURL } from "../src/core/ai-config.ts";
import { emptyState, publicState, type AIProvider } from "../src/core/types.ts";
import { discoverModels, providerChat, localChat } from "../electron/ai.ts";
const provider = (type: AIProvider["type"] = "ollama"): AIProvider => ({
  id: "p",
  name: "Test",
  type,
  baseUrl:
    type === "ollama"
      ? "http://localhost:11434/v1"
      : "https://api.example.com/v1",
  apiKey: "private-key",
  enabled: true,
  allowRemote: false,
  models: ["one", "two"],
  availableModels: [],
});
test("migration preserves legacy role overrides and defaults with cloud disabled", () => {
  const ai = migrateAI({
    baseUrl: "http://127.0.0.1:1234/v1",
    defaultModel: "one",
    models: { summary: "two", knowledge: "", reply: "" },
  });
  assert.equal(resolveModel(ai, "summary").selection.modelId, "two");
  assert.equal(resolveModel(ai, "reply").selection.modelId, "one");
  assert.equal(ai.providers[0].allowRemote, false);
});
test("role resolves its provider and disabled/removed model cannot silently fallback", () => {
  const ai = emptyState().ai;
  ai.providers = [provider(), { ...provider(), id: "q", models: ["special"] }];
  ai.default = { providerId: "p", modelId: "one" };
  ai.tasks.summary = { providerId: "q", modelId: "special" };
  assert.equal(resolveModel(ai, "summary").provider.id, "q");
  assert.equal(resolveModel(ai, "reply").provider.id, "p");
  ai.providers[1].enabled = false;
  assert.throws(() => resolveModel(ai, "summary"), /tắt/);
  ai.providers[0].models = [];
  assert.throws(() => resolveModel(ai, "reply"), /chưa được bật/);
});
test("cloud denied before fetch until permission for that provider is enabled", async (t) => {
  const before = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = before;
  });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
    );
  }) as typeof fetch;
  const p = provider("openai");
  const ai = emptyState().ai;
  ai.providers = [p];
  ai.default = { providerId: "p", modelId: "one" };
  await assert.rejects(
    localChat(ai, "reply", [{ role: "user", content: "Hello" }]),
    /riêng tư/,
  );
  await assert.rejects(discoverModels(p), /riêng tư/);
  assert.equal(calls, 0);
  p.allowRemote = true;
  assert.equal(
    await localChat(ai, "reply", [{ role: "user", content: "Hello" }]),
    "OK",
  );
  assert.equal(calls, 1);
});
test("secret key is omitted from public state; localhost normalized; redirects forbidden", async (t) => {
  const state = emptyState();
  state.ai.providers = [provider()];
  assert.equal(
    JSON.stringify(publicState(state)).includes("private-key"),
    false,
  );
  assert.equal(publicState(state).ai.providers[0].hasApiKey, true);
  assert.equal(providerURL(provider()).hostname, "127.0.0.1");
  assert.throws(
    () =>
      providerURL({ ...provider(), baseUrl: "http://cloud.example/v1" }, true),
    /HTTPS/,
  );
  const before = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = before;
  });
  globalThis.fetch = (async (_url, opts) => {
    assert.equal(opts?.redirect, "error");
    assert.equal((opts?.headers as any).Authorization, "Bearer private-key");
    return new Response(
      JSON.stringify({ data: [{ id: "two" }, { id: "one" }, { id: "two" }] }),
    );
  }) as typeof fetch;
  assert.deepEqual(await discoverModels(provider()), ["one", "two"]);
});
test("Gemini discovers only generateContent models across pages and uses header key", async (t) => {
  const before = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = before;
  });
  let count = 0;
  globalThis.fetch = (async (url, opts) => {
    assert.equal((opts?.headers as any)["x-goog-api-key"], "private-key");
    assert.equal(String(url).includes("private-key"), false);
    count++;
    if (count === 1)
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "models/text",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embed",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
          nextPageToken: "next",
        }),
      );
    assert.match(String(url), /pageToken=next/);
    return new Response(
      JSON.stringify({
        models: [
          {
            name: "models/other",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
    );
  }) as typeof fetch;
  const p = provider("google");
  p.allowRemote = true;
  assert.deepEqual(await discoverModels(p), ["other", "text"]);
});
test("native Anthropic and Gemini protocols preserve structured history and generation parameters", async (t) => {
  const before = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = before;
  });
  const messages = [
    { role: "system" as const, content: "System" },
    { role: "user" as const, content: "Hi" },
    { role: "assistant" as const, content: "Hello" },
    { role: "user" as const, content: "Next" },
  ];
  globalThis.fetch = (async (url, opts) => {
    const body = JSON.parse(opts?.body as string);
    if (String(url).endsWith("/messages")) {
      assert.equal((opts?.headers as any)["x-api-key"], "private-key");
      assert.equal(body.system, "System");
      assert.equal(body.max_tokens, 123);
      assert.deepEqual(body.messages, messages.slice(1));
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "OK" }] }),
      );
    }
    assert.match(String(url), /:generateContent$/);
    assert.equal(body.contents[1].role, "model");
    assert.equal(body.generationConfig.maxOutputTokens, 123);
    assert.equal(body.systemInstruction.parts[0].text, "System");
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "internal", thought: true }, { text: "OK" }],
            },
          },
        ],
      }),
    );
  }) as typeof fetch;
  for (const type of ["anthropic", "google"] as const) {
    const p = provider(type);
    p.allowRemote = true;
    assert.equal(
      await providerChat(
        p,
        {
          providerId: "p",
          modelId: "one",
          maxOutputTokens: 123,
          temperature: 0.2,
        },
        messages,
      ),
      "OK",
    );
  }
});
test("provider errors cannot echo API keys or private content into app error", async (t) => {
  const before = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = before;
  });
  globalThis.fetch = (async () =>
    new Response("private-key secret-history", {
      status: 401,
    })) as typeof fetch;
  await assert.rejects(discoverModels(provider()), (e) => {
    assert.equal(String(e).includes("private-key"), false);
    assert.equal(String(e).includes("secret-history"), false);
    return true;
  });
});

test("editing provider retains key without returning it, explicit removal clears it and stale catalog/test status", async () => {
  const { saveProvider } = await import("../src/core/settings.ts");
  const config = emptyState().ai;
  const p = provider();
  p.availableModels = ["one"];
  p.testedAt = 123;
  p.testStatus = "ok";
  config.providers = [p];
  const input = { ...p, apiKey: "", name: "Renamed" };
  saveProvider(config, input);
  assert.equal(config.providers[0].apiKey, "private-key");
  assert.equal(config.providers[0].testStatus, "ok");
  saveProvider(config, input, true);
  assert.equal(config.providers[0].apiKey, "");
  assert.deepEqual(config.providers[0].availableModels, []);
  assert.equal(config.providers[0].testStatus, undefined);
});
test("removing a configured model clears dangling default and task assignments", async () => {
  const { saveProvider } = await import("../src/core/settings.ts");
  const config = emptyState().ai;
  const p = provider();
  config.providers = [p];
  config.default = { providerId: p.id, modelId: "one" };
  config.tasks.summary = { providerId: p.id, modelId: "two" };
  saveProvider(config, { ...p, models: ["two"] });
  assert.equal(config.default, null);
  assert.equal(config.tasks.summary?.modelId, "two");
  saveProvider(config, { ...p, enabled: false });
  assert.equal(config.tasks.summary, null);
});
test("account credential editing preserves password, cookies and identity; replacement password updates", async () => {
  const { updateAccount } = await import("../src/core/settings.ts");
  const a = {
    id: "a",
    name: "A",
    platform: "messenger-personal" as const,
    username: "u",
    password: "stored-pass",
    cookies: [{ value: "secret-cookie" }],
  };
  updateAccount(a, { ...a, name: "B", password: "" });
  assert.equal(a.password, "stored-pass");
  assert.equal(a.cookies[0].value, "secret-cookie");
  assert.equal(a.id, "a");
  updateAccount(a, { ...a, password: "new-pass" });
  assert.equal(a.password, "new-pass");
  assert.throws(
    () => updateAccount(a, { ...a, platform: "other" as any }),
    /nền tảng/,
  );
});
