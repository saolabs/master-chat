import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../electron/engine.ts";
import { localChat } from "../electron/ai.ts";
import { emptyState, type State, type DOMProfile } from "../src/core/types.ts";
import type { Vault } from "../electron/vault.ts";
import type { Browsers } from "../electron/browser.ts";
function aiConfig(model: string) {
  const ai = emptyState().ai;
  ai.providers.push({
    id: "p",
    name: "Test",
    type: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    enabled: true,
    allowRemote: false,
    models: [model],
    availableModels: [],
  });
  ai.default = { providerId: "p", modelId: model };
  return ai;
}
function rig() {
  const state = emptyState();
  state.ai = aiConfig("local-test");
  state.accounts.push({
    id: "a",
    name: "Test",
    platform: "messenger-personal",
    username: "",
    password: "",
    cookies: [],
  });
  state.conversations.push({
    id: "c",
    accountId: "a",
    platformId: "123",
    name: "Test",
    url: "https://www.facebook.com/messages/t/123/",
    messages: [
      {
        id: "m1",
        text: "Hello",
        direction: "incoming",
        timestamp: Date.now() - 100,
        observedAt: Date.now(),
        baseline: true,
      },
    ],
    initialized: true,
    autoReply: false,
    pendingIds: [],
    summary: { text: "", coveredIds: [], revision: 0 },
  });
  state.profiles["messenger-personal"] = { verified: true } as DOMProfile;
  const vault = {
    read: () => structuredClone(state),
    mutate: async (fn: (s: State) => unknown) => fn(state),
  } as unknown as Vault;
  let sent = 0;
  const browsers = {
    readConversation: async () => state.conversations[0].messages,
    send: async () => {
      sent++;
    },
  } as unknown as Browsers;
  const engine = new Engine(vault, browsers, () => {});
  return { state, engine, browsers, sent: () => sent };
}
test("AI transport sets redirect=error and uses chosen role model", async (t) => {
  const fetchBefore = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchBefore;
  });
  let body: { model: string } | undefined;
  globalThis.fetch = (async (_url, options) => {
    assert.equal(options?.redirect, "error");
    body = JSON.parse(options?.body as string);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
    );
  }) as typeof fetch;
  const config = aiConfig("default");
  config.providers[0].models.push("summary-special");
  config.tasks.summary = { providerId: "p", modelId: "summary-special" };
  assert.equal(
    await localChat(config, "summary", [{ role: "user", content: "Hi" }]),
    "OK",
  );
  assert.equal(body?.model, "summary-special");
});
test("pause while local AI is running cannot save/send a late result", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  let resolve!: (r: Response) => void;
  globalThis.fetch = (() =>
    new Promise<Response>((res) => {
      resolve = res;
    })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  const generating = r.engine.generate("c");
  await new Promise((res) => setImmediate(res));
  r.engine.pause();
  resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "Late reply" } }] }),
    ),
  );
  await assert.rejects(generating, /dừng/);
  assert.equal(r.state.drafts.length, 0);
  assert.equal(r.sent(), 0);
});
test("uncertain send is durable and subsequent sending is blocked", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.drafts.push({
    id: "d",
    conversationId: "c",
    text: "Reply",
    basedOnId: "m1",
    triggerIds: [],
    proactive: false,
    status: "draft",
    createdAt: Date.now(),
  });
  r.browsers.send = async () => {
    throw new Error("echo timeout");
  };
  await assert.rejects(r.engine.send("d", "Reply"), /echo timeout/);
  assert.equal(r.state.drafts[0].status, "uncertain");
  r.state.drafts.push({ ...r.state.drafts[0], id: "d2", status: "draft" });
  await assert.rejects(r.engine.send("d2", "Reply"), /chưa rõ kết quả/);
});
test("new message between draft and send invalidates draft without clicking send", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.drafts.push({
    id: "d",
    conversationId: "c",
    text: "Reply",
    basedOnId: "m1",
    triggerIds: [],
    proactive: false,
    status: "draft",
    createdAt: Date.now(),
  });
  r.browsers.readConversation = async () => [
    {
      id: "m2",
      text: "New question",
      direction: "incoming",
      timestamp: Date.now(),
      observedAt: Date.now(),
    },
  ];
  await assert.rejects(r.engine.send("d", "Reply"), /hết hiệu lực/);
  assert.equal(r.sent(), 0);
  assert.equal(r.state.drafts[0].status, "stale");
});
test("pause blocks sending before browser work", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.state.drafts.push({
    id: "d",
    conversationId: "c",
    text: "Reply",
    basedOnId: "m1",
    triggerIds: [],
    proactive: false,
    status: "draft",
    createdAt: Date.now(),
  });
  await assert.rejects(r.engine.send("d", "Reply"), /resume/);
  assert.equal(r.sent(), 0);
});
test("summary is reused and only the next rank-ten message is summarized", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  r.state.ai.providers[0].models.push("summarizer", "responder");
  r.state.ai.tasks.summary = { providerId: "p", modelId: "summarizer" };
  r.state.ai.tasks.reply = { providerId: "p", modelId: "responder" };
  const base = Date.now() - 10000;
  r.state.conversations[0].messages = Array.from({ length: 10 }, (_, n) => ({
    id: `m${n + 1}`,
    text: `Message ${n + 1}`,
    direction: "incoming" as const,
    timestamp: base + n,
    observedAt: Date.now(),
    baseline: true,
  }));
  const coveredBatches: string[][] = [];
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(options?.body as string);
    if (body.model === "summarizer")
      coveredBatches.push(
        JSON.parse(body.messages[1].content).messages.map(
          (m: { id: string }) => m.id,
        ),
      );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: body.model === "summarizer" ? "Summary" : "Reply",
            },
          },
        ],
      }),
    );
  }) as typeof fetch;
  await r.engine.generate("c");
  await r.engine.generate("c");
  assert.deepEqual(coveredBatches, [["m1"]]);
  r.state.conversations[0].messages.push({
    id: "m11",
    text: "Next",
    direction: "incoming",
    timestamp: Date.now(),
    observedAt: Date.now(),
    baseline: false,
  });
  await r.engine.generate("c");
  assert.deepEqual(coveredBatches, [["m1"], ["m2"]]);
  assert.equal(r.state.conversations[0].messages.length, 11);
});

test("paused inbox discovery imports threads and status without reading conversations or calling AI", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  delete r.state.profiles["messenger-personal"];
  r.browsers.scanInbox = async () => ({
    threads: [
      {
        platformId: "456",
        name: "New",
        url: "https://www.facebook.com/messages/t/456/",
        unread: true,
        signature: "x",
      },
    ],
    scannedAt: Date.now(),
    coverage: "partial",
    revision: 1,
  });
  r.browsers.readConversation = async () => {
    throw new Error("Should not read while manually scanning inbox");
  };
  const found = await r.engine.syncInbox("a");
  assert.equal(found.added.length, 1);
  assert.equal(r.state.conversations[1].autoReply, false);
  assert.equal(r.state.conversations[1].initialized, false);
  assert.equal(r.state.drafts.length, 0);
  assert.equal(r.engine.monitors[0].coverage, "partial");
  assert.equal(r.sent(), 0);
});
test("inbox baseline followed by a new thread routes fresh incoming into native auto reply exactly once", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  delete r.state.profiles["messenger-personal"];
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].autoDiscoverReply = true;
  let pass = 0;
  const incoming = {
    id: "new",
    text: "New question",
    direction: "incoming" as const,
    timestamp: Date.now() - 60_000,
    observedAt: Date.now(),
    precision: "minute" as const,
    identity: "fingerprint" as const,
  };
  r.browsers.scanInbox = async () => ({
    threads:
      ++pass === 1
        ? []
        : [
            {
              platformId: "456",
              name: "New",
              url: "https://www.facebook.com/messages/t/456/",
              unread: true,
              signature: "x",
            },
          ],
    scannedAt: pass === 1 ? r.state.enabledAt! : Date.now(),
    coverage: "visible",
    revision: pass,
  });
  r.browsers.readConversation = async (c) =>
    c.platformId === "456" ? [incoming] : r.state.conversations[0].messages;
  let calls = 0,
    sends = 0;
  r.browsers.send = async (c, profile, text, basedOn, allowed) => {
    assert.equal(c.platformId, "456");
    assert.equal(profile, undefined);
    assert.equal(basedOn, "new");
    assert.equal(allowed(), true);
    assert.equal(text, "Reply");
    sends++;
  };
  globalThis.fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Reply" } }] }),
    );
  }) as typeof fetch;
  r.engine.paused = false;
  const tick = () => (r.engine as unknown as { tick(): Promise<void> }).tick();
  await tick();
  assert.equal(sends, 0);
  await tick();
  assert.equal(sends, 1);
  assert.equal(calls, 1);
  assert.equal(r.state.drafts[0].status, "sent");
  assert.deepEqual(r.state.conversations[1].pendingIds, []);
  await tick();
  assert.equal(sends, 1);
  assert.equal(calls, 1);
});
test("pause during inbox discovery prevents late observation, generation and sending", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  let resolve!: (scan: Awaited<ReturnType<Browsers["scanInbox"]>>) => void;
  r.browsers.scanInbox = () => new Promise((res) => (resolve = res));
  r.browsers.readConversation = async () => {
    throw new Error("Late observation");
  };
  r.engine.paused = false;
  const ticking = (r.engine as unknown as { tick(): Promise<void> }).tick();
  await new Promise((res) => setImmediate(res));
  r.engine.pause();
  resolve({
    threads: [],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 0,
  });
  await ticking;
  assert.equal(r.state.drafts.length, 0);
  assert.equal(r.sent(), 0);
});

test("a later incoming with unknown time cannot authorize replying to an older pending message", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  const c = r.state.conversations[0];
  c.autoReply = true;
  r.browsers.scanInbox = async () => ({
    threads: [],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 1,
  });
  r.browsers.readConversation = async () => [
    ...c.messages,
    {
      id: "eligible",
      direction: "incoming",
      text: "Fresh",
      timestamp: Date.now() - 60_000,
      observedAt: Date.now(),
    },
    {
      id: "unknown",
      direction: "incoming",
      text: "Ambiguous",
      timestamp: null,
      observedAt: Date.now(),
    },
  ];
  r.engine.generate = async () => {
    throw new Error("Should not generate against unknown latest message");
  };
  await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.deepEqual(c.pendingIds, ["eligible"]);
  assert.equal(r.sent(), 0);
  assert.equal(r.state.drafts.length, 0);
});

test("hidden old unread discovered after account baseline cannot use another accounts older cutoff", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = Date.now() - 10_000;
  r.state.accounts[0].inboxInitialized = true;
  r.state.accounts[0].autoDiscoverReply = true;
  r.browsers.scanInbox = async () => ({
    threads: [
      {
        platformId: "456",
        name: "Old unread",
        url: "https://www.facebook.com/messages/t/456/",
        unread: true,
        signature: "x",
      },
    ],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 1,
  });
  r.browsers.readConversation = async (c) =>
    c.platformId === "456"
      ? [
          {
            id: "old-unread",
            text: "Before account monitoring",
            direction: "incoming",
            timestamp: Date.now() - 60_000,
            observedAt: Date.now(),
          },
        ]
      : r.state.conversations[0].messages;
  let generated = 0;
  r.engine.generate = async () => {
    generated++;
    return "never";
  };
  await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.equal(generated, 0);
  assert.deepEqual(r.state.conversations[1].pendingIds, []);
  assert.equal(r.state.conversations[1].autoReply, true);
  assert.equal(r.sent(), 0);
});

test("automatic send rechecks pending eligibility after refreshing account cutoff", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 10_000;
  r.state.accounts[0].monitorStartedAt = Date.now();
  const c = r.state.conversations[0];
  c.autoReply = true;
  c.pendingIds = ["m1"];
  r.state.drafts.push({
    id: "automatic",
    conversationId: "c",
    text: "Old reply",
    basedOnId: "m1",
    triggerIds: ["m1"],
    proactive: false,
    status: "draft",
    createdAt: Date.now(),
  });
  await assert.rejects(
    r.engine.send("automatic", "Old reply", true),
    /hết hiệu lực/,
  );
  assert.deepEqual(c.pendingIds, []);
  assert.equal(r.sent(), 0);
});
