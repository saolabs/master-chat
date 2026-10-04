import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  localChat,
  providerChat,
  discoverModels,
  analyzeMedia,
} from "../electron/ai.ts";
import { rememberProviderKey } from "../electron/provider-keys.ts";
import { Vault } from "../electron/vault.ts";
import { seal, unseal } from "../src/core/crypto.ts";
import { saveProvider } from "../src/core/settings.ts";
import { emptyState, publicState, type AIProvider } from "../src/core/types.ts";

function config(type: AIProvider["type"] = "openai_compatible") {
  const ai = emptyState().ai;
  ai.providers = [
    {
      id: "p",
      name: "Test",
      type,
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: "a",
      apiKeys: ["a", "b", "c"],
      enabled: true,
      allowRemote: false,
      models: ["special", "common", "whisper"],
      availableModels: [],
    },
  ];
  ai.default = { providerId: "p", modelId: "common" };
  ai.tasks.reply = { providerId: "p", modelId: "special" };
  return ai;
}
const messages = [{ role: "user" as const, content: "Hello" }];
const ok = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));

function mockFetch(t: TestContext, fn: typeof fetch) {
  const before = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = before;
  });
}

test("empty model output falls back directly to the shared model with its parameters", async (t) => {
  const ai = config();
  ai.default!.maxOutputTokens = 42;
  const calls: string[] = [];
  mockFetch(t, async (_url, options) => {
    const body = JSON.parse(options?.body as string);
    calls.push(`${body.model}:${(options?.headers as any).Authorization}`);
    if (body.model === "special")
      return new Response(JSON.stringify({ choices: [] }));
    assert.equal(body.max_tokens, 42);
    return ok();
  });
  assert.equal(await localChat(ai, "reply", messages), "OK");
  assert.deepEqual(calls, ["special:Bearer a", "common:Bearer a"]);
});

test("key rotation wraps, remembers success, reuses it and advances again on the next task", async (t) => {
  const ai = config();
  ai.providers[0].activeApiKeyIndex = 1;
  const calls: string[] = [];
  let valid = "a";
  mockFetch(t, async (_url, options) => {
    const key = (options?.headers as any).Authorization.replace("Bearer ", "");
    calls.push(key);
    return key === valid
      ? ok()
      : new Response("credit exhausted", { status: 402 });
  });
  assert.equal(await localChat(ai, "reply", messages), "OK");
  assert.deepEqual(calls, ["b", "c", "a"]);
  assert.equal(ai.providers[0].activeApiKeyIndex, 0);
  calls.length = 0;
  await localChat(ai, "reply", messages);
  assert.deepEqual(calls, ["a"]);
  valid = "b";
  calls.length = 0;
  await localChat(ai, "reply", messages);
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(ai.providers[0].activeApiKeyIndex, 1);
});

test("exhausted keys are tried once per task even with a fallback on the same provider", async (t) => {
  const ai = config();
  ai.providers[0].activeApiKeyIndex = 2;
  const calls: string[] = [];
  mockFetch(t, async (_url, options) => {
    calls.push((options?.headers as any).Authorization);
    return new Response("a b c private history", { status: 429 });
  });
  await assert.rejects(localChat(ai, "reply", messages), /HTTP 429.*Dự phòng/);
  assert.deepEqual(calls, ["Bearer c", "Bearer a", "Bearer b"]);
  assert.equal(ai.providers[0].activeApiKeyIndex, 2);
  calls.length = 0;
  await assert.rejects(localChat(ai, "reply", messages));
  assert.deepEqual(calls, ["Bearer c", "Bearer a", "Bearer b"]);
});

test("model HTTP errors use a different fallback provider and only report after fallback fails", async (t) => {
  const ai = config();
  ai.providers.push({
    ...ai.providers[0],
    id: "q",
    apiKey: "q-secret",
    apiKeys: ["q-secret"],
    baseUrl: "http://127.0.0.1:9000/v1",
  });
  ai.default!.providerId = "q";
  const calls: string[] = [];
  mockFetch(t, async (url, options) => {
    calls.push(`${url}:${(options?.headers as any).Authorization}`);
    return new Response("q-secret private-history", { status: 404 });
  });
  await assert.rejects(localChat(ai, "reply", messages), (error) => {
    assert.match(
      String(error),
      /special.*HTTP 404.*Dự phòng: common.*HTTP 404/,
    );
    assert.ok(!String(error).includes("q-secret"));
    assert.ok(!String(error).includes("private-history"));
    return true;
  });
  assert.equal(calls.length, 2);
});

test("fallback checks its own cloud permission and does not retry an identical shared model", async (t) => {
  const ai = config();
  const fallback = {
    ...ai.providers[0],
    id: "cloud",
    baseUrl: "https://example.com/v1",
  };
  ai.providers.push(fallback);
  ai.default!.providerId = fallback.id;
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    return new Response("{}", { status: 404 });
  });
  await assert.rejects(localChat(ai, "reply", messages), /riêng tư/);
  assert.equal(calls, 1);
  ai.tasks.reply = null;
  ai.default = { providerId: "p", modelId: "common" };
  calls = 0;
  await assert.rejects(localChat(ai, "reply", messages), /HTTP 404/);
  assert.equal(calls, 1);
});

test("cancelling a failed request stops both key rotation and model fallback", async (t) => {
  const ai = config();
  const controller = new AbortController();
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    controller.abort();
    throw new DOMException("Cancelled", "AbortError");
  });
  await assert.rejects(
    localChat(ai, "reply", messages, controller.signal),
    /Cancelled/,
  );
  assert.equal(calls, 1);
  assert.equal(ai.providers[0].activeApiKeyIndex, undefined);
});

test("task output validation also invokes fallback and reports the model actually used", async (t) => {
  const ai = config();
  mockFetch(t, async (_url, options) => {
    const model = JSON.parse(options?.body as string).model;
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: model === "special" ? "too long" : "OK" } },
        ],
      }),
    );
  });
  let used = "";
  assert.equal(
    await localChat(ai, "reply", messages, undefined, {
      maxContentLength: 3,
      onModelUsed: (selection) => {
        used = selection.modelId;
      },
    }),
    "OK",
  );
  assert.equal(used, "common");
});

test("Google and Anthropic key rotation uses the correct native headers", async (t) => {
  for (const type of ["google", "anthropic"] as const) {
    await t.test(type, async (t) => {
      const ai = config(type);
      const calls: string[] = [];
      mockFetch(t, async (_url, options) => {
        const headers = options?.headers as Record<string, string>;
        const key = headers[type === "google" ? "x-goog-api-key" : "x-api-key"];
        calls.push(key);
        if (key === "a") return new Response("invalid key", { status: 401 });
        return new Response(
          JSON.stringify(
            type === "google"
              ? { candidates: [{ content: { parts: [{ text: "OK" }] } }] }
              : { content: [{ type: "text", text: "OK" }] },
          ),
        );
      });
      assert.equal(
        await providerChat(ai.providers[0], ai.default!, messages),
        "OK",
      );
      assert.deepEqual(calls, ["a", "b"]);
    });
  }
});

test("model discovery and provider transcription share key rotation", async (t) => {
  const ai = config();
  const calls: string[] = [];
  mockFetch(t, async (url, options) => {
    const key = (options?.headers as any).Authorization;
    calls.push(key);
    if (key === "Bearer a") return new Response("exhausted", { status: 429 });
    if (String(url).endsWith("/models"))
      return new Response(JSON.stringify({ data: [{ id: "whisper" }] }));
    assert.ok(options?.body instanceof FormData);
    return new Response(JSON.stringify({ text: "Bản phiên âm" }));
  });
  assert.deepEqual(await discoverModels(ai.providers[0]), ["whisper"]);
  assert.equal(ai.providers[0].activeApiKeyIndex, 1);
  assert.equal(
    await analyzeMedia(
      ai,
      {
        kind: "audio",
        mimeType: "audio/wav",
        data: Buffer.from("audio").toString("base64"),
      },
      { providerId: "p", modelId: "whisper" },
    ),
    "Bản phiên âm",
  );
  assert.deepEqual(calls, ["Bearer a", "Bearer b", "Bearer b"]);
});

test("saved keys append, deduplicate, remove individually and remain absent from public state", () => {
  const state = emptyState();
  state.ai = config();
  state.ai.providers[0].activeApiKeyIndex = 1;
  saveProvider(
    state.ai,
    { ...state.ai.providers[0], apiKey: "", apiKeys: [" d ", "b"] },
    false,
    [0],
  );
  const provider = state.ai.providers[0];
  assert.deepEqual(provider.apiKeys, ["b", "c", "d"]);
  assert.equal(provider.activeApiKeyIndex, 0);
  const published = publicState(state).ai.providers[0];
  assert.equal(published.apiKeyCount, 3);
  assert.equal("apiKeys" in published, false);
  assert.equal("apiKey" in published, false);
  saveProvider(state.ai, { ...provider, apiKey: "", apiKeys: [] }, true);
  assert.deepEqual(state.ai.providers[0].apiKeys, []);
  assert.equal(state.ai.providers[0].apiKey, "");
});

test("rotated keys survive encrypted vault reopening and late requests cannot overwrite edited providers", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "master-chat-key-retry-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => seal(value, key),
    decryptString: (value: Buffer) => unseal(value, key),
  };
  const vault = new Vault(directory, storage);
  await vault.open();
  await vault.mutate((state) => {
    state.ai = config();
    state.ai.providers[0].apiKeys = ["unique-secret-one", "unique-secret-two"];
    state.ai.providers[0].apiKey = "unique-secret-one";
  });
  mockFetch(t, async (_url, options) =>
    (options?.headers as any).Authorization === "Bearer unique-secret-one"
      ? new Response("credit", { status: 402 })
      : ok(),
  );
  const snapshot = vault.read();
  await localChat(snapshot.ai, "reply", messages, undefined, {
    onKeyChange: (provider, selected) =>
      rememberProviderKey(vault, provider, selected),
  });
  const reopened = new Vault(directory, storage);
  await reopened.open();
  assert.equal(reopened.read().ai.providers[0].activeApiKeyIndex, 1);
  assert.equal(
    (await readFile(path.join(directory, "data.vault"))).includes(
      Buffer.from("unique-secret"),
    ),
    false,
  );
  const olderRequest = reopened.read().ai.providers[0];
  await rememberProviderKey(
    reopened,
    reopened.read().ai.providers[0],
    "unique-secret-one",
  );
  await rememberProviderKey(reopened, olderRequest, "unique-secret-two");
  assert.equal(
    reopened.read().ai.providers[0].activeApiKeyIndex,
    0,
    "An older request cannot roll back the newer key cursor",
  );
  await reopened.mutate((state) => {
    state.ai.providers[0].apiKeys = ["new-key"];
    state.ai.providers[0].activeApiKeyIndex = 0;
  });
  await rememberProviderKey(
    reopened,
    snapshot.ai.providers[0],
    "unique-secret-two",
  );
  assert.equal(reopened.read().ai.providers[0].activeApiKeyIndex, 0);
});

test("network/server errors rotate keys while legacy one-key providers make one attempt", async (t) => {
  const ai = config();
  const calls: string[] = [];
  mockFetch(t, async (_url, options) => {
    const key = (options?.headers as any).Authorization;
    calls.push(key);
    if (key === "Bearer a") throw new TypeError("private-network-details");
    return key === "Bearer b"
      ? new Response("unavailable", { status: 503 })
      : ok();
  });
  assert.equal(await localChat(ai, "reply", messages), "OK");
  assert.deepEqual(calls, ["Bearer a", "Bearer b", "Bearer c"]);
  const legacy = {
    ...ai.providers[0],
    apiKey: "a",
    apiKeys: undefined,
    activeApiKeyIndex: undefined,
  };
  calls.length = 0;
  await assert.rejects(
    providerChat(legacy, ai.default!, messages),
    /Không kết nối/,
  );
  assert.deepEqual(calls, ["Bearer a"]);
});

test("HTTP 400 distinguishes invalid keys/credit from model errors without exposing response bodies", async (t) => {
  const ai = config();
  const calls: string[] = [];
  mockFetch(t, async (_url, options) => {
    const key = (options?.headers as any).Authorization;
    const model = JSON.parse(options?.body as string).model;
    calls.push(`${model}:${key}`);
    if (key === "Bearer a")
      return new Response(
        JSON.stringify({
          error: { message: "API key not valid. private-history" },
        }),
        { status: 400 },
      );
    if (key === "Bearer b")
      return new Response(
        JSON.stringify({
          error: { message: "Your credit balance is too low. secret-key" },
        }),
        { status: 400 },
      );
    return model === "special"
      ? new Response(
          JSON.stringify({ error: { message: "Model is unsupported" } }),
          { status: 400 },
        )
      : ok();
  });
  assert.equal(await localChat(ai, "reply", messages), "OK");
  assert.deepEqual(calls, [
    "special:Bearer a",
    "special:Bearer b",
    "special:Bearer c",
    "common:Bearer c",
  ]);
  assert.equal(ai.providers[0].activeApiKeyIndex, 2);
});
