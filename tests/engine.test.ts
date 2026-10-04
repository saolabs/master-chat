import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../electron/engine.ts";
import { localChat } from "../electron/ai.ts";
import { emptyState, type State, type DOMProfile } from "../src/core/types.ts";
import type { Vault } from "../electron/vault.ts";
import type { Browsers } from "../electron/browser.ts";
import { SendNotAttemptedError } from "../src/core/send-status.ts";
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
test("a proven pre-send failure preserves a retryable draft instead of uncertain", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.browsers.send = async () => {
    throw new SendNotAttemptedError(new Error("Chưa sẵn sàng để gửi"));
  };
  await assert.rejects(
    r.engine.sendMessage("c", "Keep this reply", "m1"),
    /Chưa sẵn sàng/,
  );
  const draft = r.state.drafts[0];
  assert.equal(draft.status, "draft");
  assert.equal(draft.text, "Keep this reply");
  r.browsers.send = async () => {
    assert.equal(r.state.drafts[0].status, "sending");
  };
  await r.engine.send(draft.id, draft.text);
  assert.equal(r.state.drafts[0].status, "sent");
});
test("an automatic pre-send failure becomes a manual draft without background retry", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  r.state.conversations[0].autoReply = true;
  r.state.conversations[0].pendingIds = ["m1"];
  r.state.drafts.push({
    id: "auto",
    conversationId: "c",
    text: "Reply",
    basedOnId: "m1",
    triggerIds: ["m1"],
    proactive: false,
    automatic: true,
    status: "draft",
    createdAt: Date.now(),
  });
  let attempts = 0;
  r.browsers.send = async () => {
    attempts++;
    throw new SendNotAttemptedError(new Error("Preflight blocked"));
  };
  r.browsers.scanInbox = async () => ({
    threads: [],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 0,
  });
  await assert.rejects(
    r.engine.send("auto", "Reply", true),
    /Preflight blocked/,
  );
  assert.equal(r.state.drafts[0].status, "draft");
  assert.equal(r.state.drafts[0].automatic, false);
  await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.equal(attempts, 1);
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
test("explicit manual send tolerates incoming during composition and pre-send sync without pausing AI globally", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.browsers.readConversation = async () => [
    {
      id: "new-incoming",
      text: "Another question",
      direction: "incoming",
      timestamp: Date.now(),
      observedAt: Date.now(),
    },
  ];
  r.browsers.send = async (_c, _p, text, _latest, allowed, contextBound) => {
    assert.equal(text, "Human approved text");
    assert.equal(contextBound, false);
    assert.equal(allowed(), true);
    assert.equal(r.state.drafts.at(-1)?.status, "sending");
  };
  r.engine.setComposing("c", true);
  await r.engine.sendMessage("c", "Human approved text", "old-renderer-id");
  assert.equal(r.state.drafts.at(-1)?.status, "sent");
  assert.equal(r.engine.paused, false);
});
test("configuration update restores running state but preserves explicit pause and failures", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  let resumes = 0;
  r.engine.resume = async () => {
    resumes++;
    r.engine.paused = false;
  };
  r.engine.paused = false;
  await r.engine.configure(async () => {});
  assert.equal(resumes, 1);
  assert.equal(r.engine.paused, false);
  await r.engine.configure(async () => r.engine.pause("User pause"));
  assert.equal(resumes, 1);
  assert.equal(r.engine.pauseReason, "User pause");
  await r.engine.configure(async () => {});
  assert.equal(r.engine.paused, true);
  r.engine.paused = false;
  await assert.rejects(
    r.engine.configure(async () => {
      throw new Error("Invalid settings");
    }),
    /Invalid settings/,
  );
  assert.equal(r.engine.paused, true);
  assert.equal(resumes, 1);
});
test("conversation auto toggle preserves engine state and other scheduled replies", async (t) => {
  const r = scheduledRig();
  t.after(() => r.engine.shutdown());
  const other = {
    ...structuredClone(r.state.conversations[0]),
    id: "other",
    platformId: "999",
  };
  r.state.conversations.push(other);
  await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.ok(r.state.drafts[0].sendAfter);
  await r.engine.setConversationAuto("other", false);
  assert.equal(r.engine.paused, false);
  assert.equal(r.state.conversations[0].autoReply, true);
  assert.ok(r.state.drafts[0].sendAfter);
  r.engine.pause("User pause");
  await r.engine.setConversationAuto("other", true);
  assert.equal(r.engine.paused, true);
  assert.equal(r.engine.pauseReason, "User pause");
});

test("disable and re-enable during automatic generation invalidates only that conversation result", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  r.engine.paused = false;
  r.state.conversations[0].autoReply = true;
  let start!: () => void, finish!: (response: Response) => void;
  const ready = new Promise<void>((resolve) => {
    start = resolve;
  });
  globalThis.fetch = (() => {
    start();
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  }) as typeof fetch;
  const work = r.engine.generate("c", undefined, true);
  await ready;
  await r.engine.setConversationAuto("c", false);
  await r.engine.setConversationAuto("c", true);
  finish(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "Late reply" } }] }),
    ),
  );
  await assert.rejects(work, /đổi|dừng/);
  assert.equal(r.state.drafts.length, 0);
  assert.equal(r.engine.paused, false);
  assert.equal(r.sent(), 0);
});

test("pause blocks automatic sending before browser work", async (t) => {
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
  await assert.rejects(r.engine.send("d", "Reply", true), /resume/);
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
test("pause during inbox discovery permits sync but prevents generation and sending", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  let resolve!: (scan: Awaited<ReturnType<Browsers["scanInbox"]>>) => void;
  r.browsers.scanInbox = () => new Promise((res) => (resolve = res));
  let reads = 0;
  r.browsers.readConversation = async () => {
    reads++;
    return r.state.conversations[0].messages;
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
  assert.equal(reads, 1);
  assert.equal(r.state.drafts.length, 0);
  assert.equal(r.sent(), 0);
});

test("background sync after reopening rotates through read-on-phone threads while paused, without AI", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  let aiCalls = 0;
  globalThis.fetch = (async () => {
    aiCalls++;
    throw new Error("No AI during sync");
  }) as typeof fetch;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  const base = structuredClone(r.state.conversations[0]);
  r.state.conversations = Array.from({ length: 8 }, (_, index) => ({
    ...structuredClone(base),
    id: `c${index}`,
    platformId: String(1000 + index),
    url: `https://www.facebook.com/messages/t/${1000 + index}/`,
    lastInboxSignature: "already-read",
    autoReply: true,
  }));
  r.browsers.scanInbox = async () => ({
    threads: r.state.conversations.map((c) => ({
      platformId: c.platformId,
      name: c.name,
      url: c.url,
      unread: false,
      signature: "already-read",
    })),
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 1,
  });
  const reads: string[] = [];
  r.browsers.readConversation = async (c) => {
    reads.push(c.id);
    return [
      ...c.messages,
      {
        id: `offline-${c.id}`,
        text: "Arrived while app was closed",
        direction: "incoming",
        timestamp: Date.now() - 60_000,
        observedAt: Date.now(),
      },
    ];
  };
  for (let pass = 0; pass < 8; pass++) await r.engine.refreshSync();
  assert.equal(new Set(reads).size, 8);
  for (const c of r.state.conversations) {
    assert.ok(c.messages.some((m) => m.id === `offline-${c.id}`));
    assert.ok(c.pendingIds.includes(`offline-${c.id}`));
  }
  assert.equal(r.engine.paused, true);
  assert.equal(aiCalls, 0);
  assert.equal(r.sent(), 0);
});

test("a slow AI task does not prevent background synchronization of other conversations", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  const c = r.state.conversations[0];
  c.autoReply = true;
  c.pendingIds = ["m1"];
  c.messages[0].baseline = false;
  r.state.conversations.push({
    ...structuredClone(c),
    id: "other",
    platformId: "999",
    url: "https://www.facebook.com/messages/t/999/",
    autoReply: false,
    pendingIds: [],
  });
  r.browsers.scanInbox = async () => ({
    threads: [],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 0,
  });
  r.browsers.readConversation = async (c) => c.messages;
  let resolve!: (response: Response) => void;
  const started = new Promise<void>((ready) => {
    globalThis.fetch = (() =>
      new Promise<Response>((res) => {
        resolve = res;
        ready();
      })) as typeof fetch;
  });
  r.engine.paused = false;
  const ticking = (r.engine as unknown as { tick(): Promise<void> }).tick();
  await started;
  r.browsers.readConversation = async (c) => [
    ...c.messages,
    {
      id: "during-ai",
      text: "Read on phone",
      direction: "incoming",
      timestamp: Date.now(),
      observedAt: Date.now(),
    },
  ];
  await r.engine.refreshSync();
  assert.equal(r.state.conversations[1].messages.at(-1)?.id, "during-ai");
  assert.equal(r.sent(), 0);
  r.engine.pause();
  resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "Late answer" } }] }),
    ),
  );
  await ticking;
  assert.equal(r.sent(), 0);
});

test("manual sync reads messages without invoking style learning or AI", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  let aiCalls = 0;
  globalThis.fetch = (async () => {
    aiCalls++;
    throw new Error("Sync must not run AI");
  }) as typeof fetch;
  await r.engine.syncConversation("c");
  assert.equal(aiCalls, 0);
  assert.equal(r.sent(), 0);
});

test("pending replies from background sync dispatch without a fresh scan or selected conversation", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  const base = structuredClone(r.state.conversations[0]);
  r.state.conversations = Array.from({ length: 6 }, (_, index) => ({
    ...structuredClone(base),
    id: `background-${index}`,
    autoReply: true,
    pendingIds: ["m1"],
  }));
  const reads: string[] = [],
    dispatched: string[] = [];
  r.browsers.readConversation = async (c) => {
    reads.push(c.id);
    return c.messages;
  };
  const internal = r.engine as unknown as {
    syncBatch(): Promise<string[]>;
    scheduleReply(id: string): Promise<void>;
    tick(): Promise<void>;
  };
  // The sync timer has already ingested these; its next pass is still busy.
  internal.syncBatch = async () => [];
  r.engine.generate = async (id, _goal, automatic) => {
    assert.equal(automatic, true);
    assert.ok(reads.includes(id));
    return id;
  };
  internal.scheduleReply = async (id) => {
    dispatched.push(id);
    r.state.conversations.find((c) => c.id === id)!.pendingIds = [];
  };
  for (let n = 0; n < 3; n++) await internal.tick();
  assert.equal(dispatched.length, 6);
  assert.equal(r.engine.live.conversationId, null);
  assert.deepEqual(new Set(dispatched), new Set(reads));
});

test("new background incoming replies while the selected conversation's model is still running", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  const slow = r.state.conversations[0];
  slow.autoReply = true;
  slow.pendingIds = ["m1"];
  slow.messages[0].text = "Slow question";
  r.state.conversations.push({
    ...structuredClone(slow),
    id: "background",
    platformId: "999",
    pendingIds: [],
    messages: [],
  });
  r.engine.live.conversationId = slow.id;
  r.browsers.readConversation = async (c) => c.messages;
  r.browsers.scanInbox = async () => ({
    threads: [],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 0,
  });
  let release!: (response: Response) => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = (async (_url, options) => {
    if (String(options?.body).includes("Slow question")) {
      started();
      return await new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Fast background answer" } }],
      }),
    );
  }) as typeof fetch;
  const sent: string[] = [];
  r.browsers.send = async (c) => {
    sent.push(c.id);
  };
  const internal = r.engine as unknown as { tick(): Promise<void> };
  const first = internal.tick();
  await waiting;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(r.engine.replying, ["c"]);
  const background = r.state.conversations[1];
  background.messages.push({
    ...slow.messages[0],
    id: "new-background",
    text: "Fast question",
    timestamp: Date.now(),
    baseline: false,
  });
  background.pendingIds = ["new-background"];
  await internal.tick();
  assert.deepEqual(sent, ["background"]);
  assert.equal(r.engine.live.conversationId, "c");
  assert.deepEqual(r.engine.replying, ["c"]);
  assert.deepEqual(background.pendingIds, []);
  r.engine.pause();
  release(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "Late answer" } }] }),
    ),
  );
  await first;
  assert.deepEqual(sent, ["background"]);
  assert.deepEqual(r.engine.replying, []);
});

test("background dispatch bounds model jobs and never duplicates an active conversation", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  const base = r.state.conversations[0];
  r.state.conversations = ["one", "two", "three"].map((id) => ({
    ...structuredClone(base),
    id,
    autoReply: true,
    pendingIds: ["m1"],
  }));
  r.browsers.readConversation = async (c) => c.messages;
  const internal = r.engine as unknown as {
    tick(): Promise<void>;
    syncBatch(): Promise<string[]>;
    scheduleReply(id: string): Promise<void>;
  };
  internal.syncBatch = async () => [];
  const releases = new Map<string, (id: string) => void>();
  r.engine.generate = (id) =>
    new Promise<string>((resolve) => {
      releases.set(id, resolve);
    });
  internal.scheduleReply = async (id) => {
    r.state.conversations.find((c) => c.id === id)!.pendingIds = [];
  };
  const first = internal.tick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(releases.size, 2);
  assert.equal(r.engine.replying.length, 2);
  await internal.tick();
  assert.equal(releases.size, 2);
  const [done, waiting] = [...releases.keys()];
  releases.get(done)!(done);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const next = internal.tick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(releases.size, 3);
  assert.equal(r.engine.replying.length, 2);
  for (const [id, resolve] of releases) if (id !== done) resolve(id);
  await Promise.all([first, next]);
  assert.deepEqual(r.engine.replying, []);
  assert.equal(
    r.state.conversations.find((c) => c.id === waiting)!.pendingIds.length,
    0,
  );
});

test("background reply candidates recheck new outgoing and retain manual/uncertain guards", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  const base = structuredClone(r.state.conversations[0]);
  r.state.conversations = ["manual", "uncertain", "answered", "ready"].map(
    (id) => ({
      ...structuredClone(base),
      id,
      autoReply: true,
      pendingIds: ["m1"],
    }),
  );
  for (const status of ["draft", "uncertain"] as const)
    r.state.drafts.push({
      id: status,
      conversationId: status === "draft" ? "manual" : "uncertain",
      text: "Keep draft",
      basedOnId: "m1",
      triggerIds: ["m1"],
      proactive: false,
      status,
      createdAt: Date.now(),
      automatic: false,
    });
  const generated: string[] = [];
  r.browsers.readConversation = async (c) =>
    c.id === "answered"
      ? [
          ...c.messages,
          {
            id: "phone-outgoing",
            text: "Already answered on phone",
            direction: "outgoing",
            timestamp: Date.now(),
            observedAt: Date.now(),
          },
        ]
      : c.messages;
  const internal = r.engine as unknown as {
    syncBatch(): Promise<string[]>;
    scheduleReply(id: string): Promise<void>;
    tick(): Promise<void>;
  };
  internal.syncBatch = async () => [];
  internal.scheduleReply = async () => {};
  r.engine.generate = async (id) => {
    generated.push(id);
    return id;
  };
  await internal.tick();
  assert.deepEqual(generated, ["ready"]);
  assert.equal(r.state.drafts[0].text, "Keep draft");
  assert.equal(r.state.drafts[1].status, "uncertain");
  assert.equal(r.sent(), 0);
});

test("selected and blocked pending threads cannot starve new inbox priorities", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  const base = structuredClone(r.state.conversations[0]);
  r.state.conversations = Array.from({ length: 10 }, (_, index) => ({
    ...structuredClone(base),
    id: `thread-${index}`,
    platformId: String(2000 + index),
    url: `https://www.facebook.com/messages/t/${2000 + index}/`,
    pendingIds: index < 3 ? ["m1"] : [],
  }));
  r.engine.live.conversationId = "thread-0";
  r.browsers.scanInbox = async () => ({
    threads: r.state.conversations.slice(3).map((c) => ({
      platformId: c.platformId,
      name: c.name,
      url: c.url,
      unread: true,
      signature: "fresh",
    })),
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 1,
  });
  const reads: string[] = [];
  r.browsers.readConversation = async (c) => {
    reads.push(c.id);
    if (c.id === "thread-3") throw new Error("Persistent thread failure");
    return c.messages;
  };
  const internal = r.engine as unknown as { syncBatch(): Promise<string[]> };
  for (let pass = 0; pass < 4; pass++) await internal.syncBatch();
  for (const c of r.state.conversations.slice(4))
    assert.ok(reads.includes(c.id), c.id);
  assert.equal(r.engine.paused, true);
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

test("stored account PIN never enters summary, knowledge or reply AI requests", async (t) => {
  const r = rig(),
    old = globalThis.fetch,
    bodies: string[] = [];
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  r.state.accounts[0].recoveryPin = "098765";
  r.state.accounts[0].autoRestorePin = true;
  r.state.conversations[0].messages = Array.from({ length: 10 }, (_, n) => ({
    ...r.state.conversations[0].messages[0],
    id: `m${n}`,
    text: `Hello ${n}`,
  }));
  r.state.knowledge.push({
    id: "k",
    title: "Hello",
    text: "Hello facts",
    accountId: "a",
  });
  globalThis.fetch = (async (_url, options) => {
    bodies.push(String(options?.body));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
    );
  }) as typeof fetch;
  await r.engine.generate("c");
  assert.equal(bodies.length, 3);
  for (const body of bodies) {
    assert.equal(body.includes("098765"), false);
    assert.equal(body.includes("recoveryPin"), false);
  }
});

test("selected conversation updates while paused without AI or sending, and replay is deduplicated", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  globalThis.fetch = (async () => {
    throw new Error("Paused live update must never call AI");
  }) as typeof fetch;
  r.state.enabledAt = Date.now() - 120000;
  const c = r.state.conversations[0];
  c.autoReply = true;
  const fresh = {
    ...c.messages[0],
    id: "live-new",
    text: "Live question",
    timestamp: Date.now(),
    baseline: false,
  };
  r.browsers.readLiveConversation = async () => [...c.messages, fresh];
  r.engine.watchConversation(c.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(c.messages.at(-1)?.id, "live-new");
  assert.equal(r.engine.paused, true);
  assert.equal(r.sent(), 0);
  assert.ok(r.engine.live.updatedAt);
  await (r.engine as unknown as { refreshLive(): Promise<void> }).refreshLive();
  assert.equal(c.messages.filter((m) => m.id === "live-new").length, 1);
  assert.equal(r.state.drafts.length, 0);
});
test("live incoming updates during AI generation and invalidates the old result", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  let resolve!: (response: Response) => void;
  globalThis.fetch = (() =>
    new Promise<Response>((r) => {
      resolve = r;
    })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  const pending = r.engine.generate("c");
  await new Promise((r) => setImmediate(r));
  const c = r.state.conversations[0];
  r.browsers.readLiveConversation = async () => [
    ...c.messages,
    {
      ...c.messages[0],
      id: "live-during-ai",
      text: "Changed question",
      timestamp: Date.now(),
      baseline: false,
    },
  ];
  r.engine.watchConversation(c.id);
  await new Promise((r) => setImmediate(r));
  assert.equal(c.messages.at(-1)?.id, "live-during-ai");
  resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "Old answer" } }] }),
    ),
  );
  await assert.rejects(pending, /đổi|dừng/);
  assert.equal(r.state.drafts.length, 0);
  assert.equal(r.sent(), 0);
});
test("background scan has its own bounded budget while the selected thread uses the live reader", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  const base = r.state.conversations[0];
  r.state.conversations = Array.from({ length: 22 }, (_, n) => ({
    ...structuredClone(base),
    id: `c${n}`,
    platformId: String(1000 + n),
    url: `https://www.facebook.com/messages/t/${1000 + n}/`,
  }));
  const selected = r.state.conversations.at(-1)!;
  r.browsers.readLiveConversation = async (c) => c.messages;
  r.engine.watchConversation(selected.id);
  await new Promise((r) => setImmediate(r));
  const reads: string[] = [];
  r.browsers.readConversation = async (c) => {
    reads.push(c.id);
    return c.messages;
  };
  r.browsers.scanInbox = async () => ({
    threads: r.state.conversations.map((c) => ({
      platformId: c.platformId,
      name: c.name,
      url: c.url,
      unread: true,
      signature: "old",
    })),
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 1,
  });
  r.engine.paused = false;
  await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.equal(reads[0], "c0");
  assert.ok(r.engine.live.updatedAt);
  assert.ok(reads.length <= 4);
  assert.equal(reads.length, 4);
  for (let n = 0; n < 8; n++)
    await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.equal(new Set(reads).size, 22);
  assert.equal(r.sent(), 0);
});
test("switching selected conversation does not apply an old live status to the new thread", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  const c = r.state.conversations[0];
  r.state.conversations.push({
    ...structuredClone(c),
    id: "other",
    platformId: "999",
    url: "https://www.facebook.com/messages/t/999/",
  });
  let resolve!: (messages: typeof c.messages) => void;
  r.browsers.readLiveConversation = () =>
    new Promise((res) => {
      resolve = res;
    });
  r.engine.watchConversation("c");
  r.engine.watchConversation("other");
  resolve([
    ...c.messages,
    { ...c.messages[0], id: "old-selected", timestamp: Date.now() },
  ]);
  await new Promise((res) => setImmediate(res));
  assert.equal(r.engine.live.conversationId, "other");
  assert.equal(r.engine.live.updatedAt, null);
  assert.equal(
    r.state.conversations[1].messages.some((m) => m.id === "old-selected"),
    false,
  );
});

test("manual messages need no AI or resume, persist outbox, consume triggers and prevent duplicate clicks", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.state.ai = emptyState().ai;
  r.state.conversations[0].pendingIds = ["m1"];
  let finish!: () => void;
  r.browsers.send = async (_c, _p, text, basedOn, allowed) => {
    assert.equal(text, "Manual reply");
    assert.equal(basedOn, "m1");
    assert.equal(allowed(), true);
    assert.equal(r.state.drafts[0].status, "sending");
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const sending = r.engine.sendMessage("c", " Manual reply ", "m1");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(r.engine.sendMessage("c", "Duplicate", "m1"), /bận/);
  finish();
  await sending;
  assert.equal(r.engine.paused, true);
  assert.equal(r.state.drafts.length, 1);
  assert.equal(r.state.drafts[0].status, "sent");
  assert.deepEqual(r.state.conversations[0].pendingIds, []);
});

test("manual sending respects uncertain results, unverified profiles and validation", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  await assert.rejects(r.engine.sendMessage("c", " ", "m1"), /5000/);
  await assert.rejects(
    r.engine.sendMessage("c", "x".repeat(5001), "m1"),
    /5000/,
  );
  r.state.profiles["messenger-personal"]!.verified = false;
  await assert.rejects(r.engine.sendMessage("c", "Reply", "m1"), /kiểm chứng/);
  r.state.profiles["messenger-personal"]!.verified = true;
  r.browsers.send = async () => {
    throw new Error("timeout");
  };
  await assert.rejects(r.engine.sendMessage("c", "Reply", "m1"), /timeout/);
  assert.equal(r.state.drafts.at(-1)?.status, "uncertain");
  const count = r.state.drafts.length;
  await assert.rejects(
    r.engine.sendMessage("c", "Retry", "m1"),
    /chưa rõ kết quả/,
  );
  assert.equal(r.state.drafts.length, count);
  assert.equal(r.sent(), 0);
});

test("typing holds a conversation and blocks an automatic reply already being generated", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  r.state.accounts[0].inboxInitialized = true;
  r.state.conversations[0].autoReply = true;
  r.state.conversations[0].pendingIds = ["m1"];
  r.browsers.scanInbox = async () => ({
    threads: [],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 0,
  });
  let resolve!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return new Promise<Response>((res) => {
      resolve = res;
    });
  }) as typeof fetch;
  const tick = () => (r.engine as unknown as { tick(): Promise<void> }).tick();
  r.engine.setComposing("c", true);
  await tick();
  assert.equal(calls, 0);
  r.engine.setComposing("c", false);
  const running = tick();
  await new Promise((res) => setImmediate(res));
  assert.equal(calls, 1);
  r.engine.setComposing("c", true);
  resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "Automatic" } }] }),
    ),
  );
  await running;
  assert.equal(r.sent(), 0);
  assert.equal(r.state.drafts[0].automatic, true);
  assert.equal(r.state.drafts[0].status, "draft");
});

test("manual AI draft is retained across background ticks", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.engine.paused = false;
  r.state.conversations[0].autoReply = true;
  r.state.conversations[0].pendingIds = ["m1"];
  r.state.drafts.push({
    id: "manual",
    conversationId: "c",
    text: "Review me",
    basedOnId: "m1",
    triggerIds: ["m1"],
    proactive: false,
    status: "draft",
    createdAt: 1,
  });
  r.browsers.scanInbox = async () => ({
    threads: [],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 0,
  });
  r.engine.generate = async () => {
    throw new Error("Do not replace manual draft");
  };
  await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.equal(r.state.drafts[0].status, "draft");
  assert.equal(r.sent(), 0);
});

test("account-wide auto enables current and discovered conversations and starts monitoring", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.state.accounts.push({ ...r.state.accounts[0], id: "other-account" });
  r.state.conversations.push({
    ...r.state.conversations[0],
    id: "other",
    accountId: "other-account",
    autoReply: false,
  });
  r.engine.paused = false;
  await r.engine.setAccountAuto("a", true);
  assert.equal(r.engine.paused, false);
  assert.equal(r.state.accounts[0].autoDiscoverReply, true);
  assert.equal(r.state.conversations[0].autoReply, true);
  assert.equal(r.state.conversations[1].autoReply, false);
  assert.equal(r.sent(), 0);
  await r.engine.setAccountAuto("a", false);
  assert.equal(r.state.accounts[0].autoDiscoverReply, false);
  assert.equal(r.state.conversations[0].autoReply, false);
  assert.equal(r.engine.paused, false);
});

test("global activation includes every account without clearing uncertain drafts or cutoffs", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.state.accounts.push({ ...r.state.accounts[0], id: "b" });
  r.state.accounts[0].monitorStartedAt = 100;
  r.state.enabledAt = 50;
  r.state.conversations.push({
    ...r.state.conversations[0],
    id: "other",
    accountId: "b",
  });
  r.state.drafts.push({
    id: "uncertain",
    conversationId: "c",
    text: "Keep",
    basedOnId: "m1",
    triggerIds: [],
    proactive: false,
    status: "uncertain",
    createdAt: 1,
  });
  await r.engine.setAllAuto(true);
  assert.equal(r.engine.paused, false);
  assert.ok(r.state.accounts.every((a) => a.autoDiscoverReply));
  assert.ok(r.state.conversations.every((c) => c.autoReply));
  assert.equal(r.state.accounts[0].monitorStartedAt, 100);
  assert.equal(r.state.enabledAt, 50);
  assert.equal(r.state.drafts[0].status, "uncertain");
  assert.equal(r.sent(), 0);
  await r.engine.setAllAuto(false);
  assert.ok(r.state.accounts.every((a) => !a.autoDiscoverReply));
  assert.ok(r.state.conversations.every((c) => !c.autoReply));
});

test("a new explicit pause during activation is not overridden", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  const engine = r.engine as unknown as { vault: Vault };
  let writes = 0;
  engine.vault.mutate = async (fn) => {
    const result = fn(r.state);
    if (++writes === 2) r.engine.pause("User paused");
    return result;
  };
  await r.engine.setAllAuto(true);
  assert.equal(r.engine.paused, true);
  assert.equal(r.engine.pauseReason, "User paused");
});

test("activation without a reply model does not report a running engine", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.state.ai = emptyState().ai;
  await assert.rejects(r.engine.setAllAuto(true));
  assert.equal(r.engine.paused, true);
  assert.equal(r.state.conversations[0].autoReply, false);
});

test("a composed thread does not block automatic replies in unopened threads", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  r.engine.paused = false;
  r.state.enabledAt = Date.now() - 120_000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  r.state.accounts[0].inboxInitialized = true;
  r.state.conversations[0].autoReply = true;
  r.state.conversations[0].pendingIds = ["m1"];
  r.state.conversations.push({
    ...r.state.conversations[0],
    id: "unopened",
    platformId: "456",
    url: "https://www.facebook.com/messages/t/456/",
    messages: [{ ...r.state.conversations[0].messages[0], id: "u1" }],
    pendingIds: ["u1"],
  });
  r.engine.setComposing("c", true);
  r.browsers.scanInbox = async () => ({
    threads: [],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 0,
  });
  r.browsers.readConversation = async (c) =>
    r.state.conversations.find((x) => x.id === c.id)!.messages;
  const recipients: string[] = [];
  r.browsers.send = async (c, _p, _text, _basedOn, allowed) => {
    assert.equal(allowed(), true);
    recipients.push(c.id);
  };
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "Background reply" } }],
      }),
    )) as typeof fetch;
  const tick = () => (r.engine as unknown as { tick(): Promise<void> }).tick();
  await tick();
  await tick();
  assert.deepEqual(recipients, ["unopened"]);
  assert.deepEqual(r.state.conversations[0].pendingIds, ["m1"]);
  assert.equal(r.state.drafts[0].status, "sent");
});

test("media is analyzed once, persisted, and reused in the actual reply history", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  const c = r.state.conversations[0];
  c.messages[0].attachments = [{ id: "photo", kind: "image" }];
  let loads = 0,
    analyses = 0,
    replies = 0;
  r.browsers.readAttachment = async () => {
    loads++;
    return { kind: "image", mimeType: "image/png", data: "AQID" };
  };
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    if (Array.isArray(body.messages[1].content)) {
      analyses++;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Ảnh ghi lịch hẹn 10 giờ." } }],
        }),
      );
    }
    replies++;
    assert.match(JSON.stringify(body.messages), /lịch hẹn 10 giờ/);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Mình tới lúc 10 giờ nhé." } }],
      }),
    );
  }) as typeof fetch;
  await r.engine.generate("c");
  await r.engine.generate("c");
  assert.equal(loads, 1);
  assert.equal(analyses, 1);
  assert.equal(replies, 2);
  assert.equal(
    c.messages[0].attachments[0].analysis,
    "Ảnh ghi lịch hẹn 10 giờ.",
  );
  assert.equal(r.sent(), 0);
});
test("unread media blocks drafting, records an actionable error, and retries only when requested", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.state.conversations[0].messages[0].attachments = [
    { id: "voice", kind: "audio" },
  ];
  let loads = 0;
  r.browsers.readAttachment = async () => {
    loads++;
    throw new Error("File expired");
  };
  await assert.rejects(r.engine.generate("c"), /Chưa đọc được/);
  await assert.rejects(r.engine.generate("c"), /Chưa đọc được/);
  assert.equal(loads, 1);
  assert.equal(r.state.drafts.length, 0);
  await assert.rejects(r.engine.retryMedia("c"), /Chưa đọc được/);
  assert.equal(loads, 2);
  assert.equal(r.sent(), 0);
});
test("contact profile consumes all available history in batches, learns owner style and reuses results", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  const c = r.state.conversations[0];
  c.messages = Array.from({ length: 120 }, (_, n) => ({
    ...c.messages[0],
    id: `history-${n}`,
    text: n % 2 ? `Bạn đến chưa ${n}` : `Ừ mình tới rồi ${n}`,
    direction: n % 2 ? ("incoming" as const) : ("outgoing" as const),
  }));
  const batches: string[][] = [];
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    let text = "Ừ bạn nhé.";
    if (body.messages[0].content.includes("Dựng hoặc cập nhật hồ sơ")) {
      const data = JSON.parse(body.messages[1].content);
      batches.push(data.messages.map((m: { id: string }) => m.id));
      const owner = data.messages.find(
        (m: { direction: string }) => m.direction === "outgoing",
      );
      text = JSON.stringify({
        relationship: { detail: "Bạn bè", evidenceIds: [owner.id] },
        address: { detail: "mình/bạn", evidenceIds: [owner.id] },
        style: { detail: "Dùng mình/bạn, câu ngắn.", evidenceIds: [owner.id] },
        facts: [],
        cautions: [],
      });
    } else if (body.messages[0].content.includes("Tóm tắt hội thoại"))
      text = "Đang hẹn gặp nhau.";
    else assert.match(body.messages[0].content, /Dùng mình\/bạn/);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: text } }] }),
    );
  }) as typeof fetch;
  await r.engine.generate("c");
  await r.engine.generate("c");
  assert.deepEqual(
    batches.map((x) => x.length),
    [100, 20],
  );
  assert.equal(new Set(batches.flat()).size, 120);
  assert.equal(c.contactProfile?.messageCount, 120);
  assert.equal(c.contactProfile?.ownerMessageCount, 60);
  assert.equal(c.contactProfile?.style?.detail, "Dùng mình/bạn, câu ngắn.");
  for (let n = 0; n < 10; n++)
    c.messages.push({
      ...c.messages.at(-1)!,
      id: `new-${n}`,
      text: `Ừ bạn ${n}`,
      direction: "outgoing",
    });
  await r.engine.generate("c");
  assert.deepEqual(
    batches.map((x) => x.length),
    [100, 20, 10],
  );
  assert.equal(c.contactProfile?.messageCount, 130);
});

function scheduledRig() {
  const r = rig(),
    c = r.state.conversations[0];
  r.state.enabledAt = Date.now() - 10000;
  r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
  c.autoReply = true;
  c.messages[0].baseline = false;
  c.pendingIds = ["m1"];
  r.state.response = {
    typing: { enabled: true, thinkingMs: 0, charactersPerMinute: 1200 },
  };
  r.state.drafts.push({
    id: "delayed",
    conversationId: "c",
    text: "Ok",
    basedOnId: "m1",
    triggerIds: ["m1"],
    proactive: false,
    automatic: true,
    origin: "ai",
    status: "draft",
    createdAt: Date.now(),
  });
  r.browsers.scanInbox = async () => ({
    threads: [
      {
        platformId: c.platformId,
        name: c.name,
        url: c.url,
        unread: true,
        signature: "new",
      },
    ],
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 1,
  });
  r.engine.paused = false;
  return r;
}
test("automatic typing delay is nonblocking and sends only after the calculated waiting period", async (t) => {
  const r = scheduledRig();
  t.after(() => r.engine.shutdown());
  await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.equal(r.sent(), 0);
  assert.ok(r.state.drafts[0].sendAfter! > Date.now());
  await new Promise((res) => setTimeout(res, 180));
  assert.equal(r.sent(), 1);
  assert.equal(r.state.drafts[0].sendAfter, undefined);
});
test("pause, manual composition, and new incoming each cancel a scheduled automatic send", async (t) => {
  for (const action of ["pause", "compose", "incoming"]) {
    const r = scheduledRig();
    t.after(() => r.engine.shutdown());
    await (r.engine as unknown as { tick(): Promise<void> }).tick();
    if (action === "pause") r.engine.pause();
    if (action === "compose") r.engine.setComposing("c", true);
    if (action === "incoming") {
      const c = r.state.conversations[0];
      r.browsers.readConversation = async () => [
        ...c.messages,
        {
          ...c.messages[0],
          id: "new",
          text: "Changed",
          timestamp: Date.now(),
          observedAt: Date.now(),
        },
      ];
      await r.engine.syncConversation("c");
    }
    await new Promise((res) => setTimeout(res, 160));
    assert.equal(r.sent(), 0, action);
    assert.equal(r.state.drafts[0].sendAfter, undefined, action);
  }
});

test("waiting for one reply leaves other conversations available for background processing", async (t) => {
  const r = scheduledRig();
  t.after(() => r.engine.shutdown());
  const second = {
    ...structuredClone(r.state.conversations[0]),
    id: "other",
    platformId: "999",
    url: "https://www.facebook.com/messages/t/999/",
  };
  r.state.conversations.push(second);
  r.state.drafts[0].text = "Long reply ".repeat(30);
  r.state.drafts.push({
    ...structuredClone(r.state.drafts[0]),
    id: "other-draft",
    conversationId: second.id,
  });
  r.browsers.readConversation = async (c) => c.messages;
  r.browsers.scanInbox = async () => ({
    threads: r.state.conversations.map((c) => ({
      platformId: c.platformId,
      name: c.name,
      url: c.url,
      unread: true,
      signature: "new",
    })),
    scannedAt: Date.now(),
    coverage: "visible",
    revision: 1,
  });
  await (r.engine as unknown as { tick(): Promise<void> }).tick();
  assert.ok(r.state.drafts.every((d) => d.sendAfter! > Date.now()));
  assert.equal(r.sent(), 0);
  r.engine.pause();
});

test("a failed profile request is cached and falls back to common style without blocking a reply", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  const c = r.state.conversations[0];
  r.state.response = { personality: "Thân thiện, gọn gàng" };
  c.messages = Array.from({ length: 50 }, (_, n) => ({
    ...c.messages[0],
    id: `style-${n}`,
    text: `Tin riêng ${n}`,
    direction: "outgoing" as const,
  }));
  let attempts = 0;
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    if (body.messages[0].content.includes("Dựng hoặc cập nhật hồ sơ")) {
      attempts++;
      return new Response("private-error", { status: 503 });
    }
    if (!body.messages[0].content.includes("Tóm tắt hội thoại"))
      assert.match(body.messages[0].content, /Thân thiện, gọn gàng/);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Bạn cần trao đổi gì nhé?" } }],
      }),
    );
  }) as typeof fetch;
  await r.engine.generate("c");
  await r.engine.generate("c");
  assert.equal(attempts, 1);
  assert.equal(c.contactProfile, undefined);
  assert.match(c.profileError!, /Dựng lại hồ sơ/);
  assert.equal(r.state.drafts.at(-1)?.status, "draft");
});

test("voice transcription is cached once and the reply model receives only text", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  const c = r.state.conversations[0];
  c.messages[0].attachments = [{ id: "voice", kind: "audio" }];
  r.state.ai.providers[0].models.push("whisper-local");
  r.state.response = {
    media: {
      audioModel: { providerId: "p", modelId: "whisper-local" },
      transcription: { mode: "provider", language: "vi" },
    },
  };
  let loads = 0,
    transcriptions = 0,
    replies = 0;
  r.browsers.readAttachment = async () => {
    loads++;
    return { kind: "audio", mimeType: "audio/mp4", data: "AQID" };
  };
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/audio/transcriptions")) {
      transcriptions++;
      assert.equal((options!.body as FormData).get("model"), "whisper-local");
      return new Response(
        JSON.stringify({ text: "Hẹn bạn mười giờ sáng mai." }),
      );
    }
    const body = JSON.parse(options!.body as string);
    replies++;
    assert.ok(
      body.messages.every(
        (m: { content: unknown }) => typeof m.content === "string",
      ),
    );
    assert.match(JSON.stringify(body.messages), /Hẹn bạn mười giờ sáng mai/);
    assert.ok(!JSON.stringify(body).includes("AQID"));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Mình tới đúng giờ nhé." } }],
      }),
    );
  }) as typeof fetch;
  await r.engine.generate("c");
  await r.engine.generate("c");
  assert.equal(loads, 1);
  assert.equal(transcriptions, 1);
  assert.equal(replies, 2);
  assert.equal(
    c.messages[0].attachments[0].analysis,
    "Hẹn bạn mười giờ sáng mai.",
  );
});

test("review model corrects topic dragging and rechecks the exact final draft", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  const c = r.state.conversations[0];
  c.messages[0].text = "Tháp nghiêng trông như thế nào ấy nhỉ";
  c.summary.text = "Trước đó hai người trao đổi MCP/CLI và tốc độ browser.";
  c.relationshipContext = "Bạn làm cùng ngành lập trình.";
  c.conversationDirection = "Hỗ trợ khi có nhu cầu công việc.";
  r.state.ai.providers[0].models.push("review-test");
  r.state.response = {
    review: { model: { providerId: "p", modelId: "review-test" } },
  };
  const seen: { model: string; draft?: string }[] = [];
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(options!.body as string),
      input =
        body.model === "review-test"
          ? JSON.parse(body.messages[1].content)
          : null;
    seen.push({ model: body.model, draft: input?.draft });
    let text =
      "Nghiêng gần 4 độ. Đang debug mà ông đổi sang kiến trúc à? Có ẩn ý về code không?";
    if (input) {
      assert.match(input.latestMessages.at(-1).content, /Tháp nghiêng/);
      assert.match(body.messages[0].content, /không kéo chuyện cũ/);
      assert.match(input.ownerWriterInstructions, /Ngữ cảnh quan hệ/);
      text = JSON.stringify(
        seen.length === 2
          ? {
              verdict: "revise",
              issues: ["Kéo câu hỏi về tháp trở lại việc debug cũ."],
              text: "Nó nghiêng hẳn sang một bên, nhìn như sắp đổ ấy :))",
            }
          : { verdict: "approve", issues: [] },
      );
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: text } }] }),
    );
  }) as typeof fetch;
  const id = await r.engine.generate("c");
  const draft = r.state.drafts.find((d) => d.id === id)!;
  assert.deepEqual(
    seen.map((x) => x.model),
    ["local-test", "review-test", "review-test"],
  );
  assert.equal(seen[2].draft, draft.text);
  assert.ok(!/debug|MCP|code/i.test(draft.text));
  assert.equal(draft.review?.status, "revised");
  assert.match(draft.review!.originalText!, /debug/);
});

test("advisory reviews repair held replies and never require manual approval for automatic sending", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  for (const result of ["hold", "invalid", "failure"]) {
    const r = rig();
    t.after(() => r.engine.shutdown());
    const c = r.state.conversations[0];
    c.autoReply = true;
    c.pendingIds = ["m1"];
    r.engine.paused = false;
    r.state.enabledAt = Date.now() - 120_000;
    r.state.accounts[0].monitorStartedAt = r.state.enabledAt;
    r.state.ai.providers[0].models.push("checker");
    r.state.response = {
      review: { enabled: true, model: { providerId: "p", modelId: "checker" } },
    };
    const models: string[] = [];
    globalThis.fetch = (async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      models.push(body.model);
      if (body.model === "checker" && result === "failure")
        return new Response("private failure", { status: 503 });
      const text =
        body.model === "checker"
          ? result === "invalid"
            ? "Gửi ngay"
            : JSON.stringify({
                verdict: "hold",
                issues: ["Cần chủ tài khoản xác nhận lời hứa."],
              })
          : models.length > 1
            ? "Mình chưa đủ thông tin để hứa chắc, bạn nói rõ thêm nhé."
            : "Để mình xem lại nhé.";
      return new Response(
        JSON.stringify({ choices: [{ message: { content: text } }] }),
      );
    }) as typeof fetch;
    const id = await r.engine.generate("c", undefined, true);
    assert.equal(r.state.drafts.at(-1)?.status, "draft");
    if (result === "hold") {
      assert.deepEqual(models, [
        "local-test",
        "checker",
        "local-test",
        "checker",
      ]);
      assert.match(r.state.drafts.at(-1)!.text, /chưa đủ thông tin/);
      assert.equal(r.state.drafts.at(-1)!.review?.status, "held");
    } else assert.equal(r.state.drafts.at(-1)!.review?.status, "unavailable");
    await r.engine.send(id, r.state.drafts.at(-1)!.text, true);
    assert.equal(r.sent(), 1);
    assert.equal(r.state.drafts.at(-1)!.status, "sent");
  }
});

test("review recheck requests Google structured output, preserves draft identity and never sends", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  Object.assign(r.state.ai.providers[0], {
    type: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    allowRemote: true,
    models: ["writer", "checker"],
  });
  r.state.ai.default = { providerId: "p", modelId: "writer" };
  r.state.response = {
    review: { enabled: true, model: { providerId: "p", modelId: "checker" } },
  };
  r.state.drafts.push({
    id: "held",
    conversationId: "c",
    text: "Reply",
    basedOnId: "m1",
    triggerIds: ["m1"],
    proactive: false,
    status: "draft",
    createdAt: 1,
    automatic: false,
    review: { status: "unavailable", issues: [], checkedAt: 1 },
  });
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(
      body.generationConfig.responseJsonSchema.properties.verdict.enum,
      ["approve", "revise", "hold"],
    );
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: JSON.stringify({ verdict: "approve", issues: [] }) },
              ],
            },
          },
        ],
      }),
    );
  }) as typeof fetch;
  await r.engine.recheckDraft("held", "Edited reply");
  assert.equal(r.state.drafts[0].review?.status, "approved");
  assert.equal(r.state.drafts[0].text, "Edited reply");
  assert.equal(r.state.drafts[0].automatic, false);
  assert.equal(r.sent(), 0);
  r.state.drafts[0].status = "uncertain";
  await assert.rejects(r.engine.recheckDraft("held", "Edited reply"));
});

test("review recheck cannot overwrite a draft after incoming or pause during the request", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  for (const change of ["incoming", "pause"]) {
    const r = rig();
    t.after(() => r.engine.shutdown());
    r.state.ai.providers[0].models.push("checker");
    r.state.response = {
      review: { model: { providerId: "p", modelId: "checker" } },
    };
    r.state.drafts.push({
      id: "held",
      conversationId: "c",
      text: "Original",
      basedOnId: "m1",
      triggerIds: ["m1"],
      proactive: false,
      status: "draft",
      createdAt: 1,
      review: { status: "unavailable", issues: [], checkedAt: 1 },
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: (response: Response) => void;
    globalThis.fetch = (() => {
      entered();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }) as typeof fetch;
    const checking = r.engine.recheckDraft("held", "Edited");
    await ready;
    if (change === "pause") r.engine.pause();
    else
      r.state.conversations[0].messages.push({
        ...r.state.conversations[0].messages[0],
        id: "new",
        text: "New question",
      });
    finish(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ verdict: "approve", issues: [] }),
              },
            },
          ],
        }),
      ),
    );
    await assert.rejects(checking, /dừng|đổi/);
    assert.equal(r.state.drafts[0].text, "Original");
    assert.equal(r.state.drafts[0].review?.status, "unavailable");
    assert.equal(r.sent(), 0);
  }
});

test("review errors expose safe HTTP diagnostics but never provider body or malformed output", async (t) => {
  const r = rig(),
    old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
    r.engine.shutdown();
  });
  r.state.ai.providers[0].models.push("checker");
  r.state.response = {
    review: { enabled: true, model: { providerId: "p", modelId: "checker" } },
  };
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    return body.model === "checker"
      ? new Response("secret key and private history", { status: 429 })
      : new Response(
          JSON.stringify({ choices: [{ message: { content: "Reply" } }] }),
        );
  }) as typeof fetch;
  await r.engine.generate("c");
  assert.match(r.state.drafts[0].review!.issues.join(" "), /HTTP 429/);
  assert.doesNotMatch(
    JSON.stringify(r.state.drafts[0].review),
    /secret|private/,
  );
  assert.equal(r.sent(), 0);
});

test("pause or a new incoming during review cannot save a stale result", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  for (const changed of ["pause", "incoming"]) {
    const r = rig();
    t.after(() => r.engine.shutdown());
    r.state.ai.providers[0].models.push("checker");
    let ready!: () => void;
    const entered = new Promise<void>((resolve) => (ready = resolve));
    let finish!: (response: Response) => void;
    globalThis.fetch = (async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      if (body.model === "checker") {
        ready();
        return new Promise<Response>((resolve) => (finish = resolve));
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Reply" } }] }),
      );
    }) as typeof fetch;
    const work = r.engine.generate("c");
    await entered;
    if (changed === "pause") r.engine.pause();
    else
      r.state.conversations[0].messages.push({
        ...r.state.conversations[0].messages[0],
        id: "new",
        text: "Mới",
      });
    finish(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ verdict: "approve", issues: [] }),
              },
            },
          ],
        }),
      ),
    );
    await assert.rejects(work, /dừng|đổi/);
    assert.equal(r.state.drafts.length, 0);
  }
});

test("backfill imports old context without generating automatic reply triggers", async (t) => {
  const r = rig();
  t.after(() => r.engine.shutdown());
  r.state.ai.default = null;
  const c = r.state.conversations[0];
  c.pendingIds = ["m1"];
  r.browsers.readHistory = async () => [
    {
      ...c.messages[0],
      id: "old",
      text: "Lịch sử",
      timestamp: c.messages[0].timestamp! - 10000,
    },
    { ...c.messages[0] },
  ];
  await r.engine.backfillConversation("c");
  assert.deepEqual(
    c.messages.map((m) => m.id),
    ["old", "m1"],
  );
  assert.equal(c.messages[0].baseline, true);
  assert.deepEqual(c.pendingIds, ["m1"]);
  assert.equal(r.sent(), 0);
});

test("engine persists a rotated key and starts subsequent generations with it", async (t) => {
  const r = rig(),
    before = globalThis.fetch;
  r.state.ai.providers[0].apiKey = "first";
  r.state.ai.providers[0].apiKeys = ["first", "second"];
  const calls: string[] = [];
  globalThis.fetch = (async (_url, options) => {
    const key = (options?.headers as any).Authorization;
    calls.push(key);
    return key === "Bearer first"
      ? new Response("exhausted", { status: 402 })
      : new Response(
          JSON.stringify({ choices: [{ message: { content: "Xin chào" } }] }),
        );
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = before;
    r.engine.shutdown();
  });
  await r.engine.generate("c");
  assert.equal(r.state.ai.providers[0].activeApiKeyIndex, 1);
  await r.engine.generate("c");
  assert.deepEqual(calls, ["Bearer first", "Bearer second", "Bearer second"]);
});

test("a fallback writer cannot also serve as reviewer for that draft", async (t) => {
  const r = rig(),
    before = globalThis.fetch;
  r.state.ai.providers[0].models = ["special", "common"];
  r.state.ai.default = { providerId: "p", modelId: "common" };
  r.state.ai.tasks.reply = { providerId: "p", modelId: "special" };
  r.state.response = {
    review: { enabled: true, model: { providerId: "p", modelId: "common" } },
  };
  const calls: string[] = [];
  globalThis.fetch = (async (_url, options) => {
    const model = JSON.parse(options?.body as string).model;
    calls.push(model);
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: model === "special" ? "" : "Xin chào" } },
        ],
      }),
    );
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = before;
    r.engine.shutdown();
  });
  await r.engine.generate("c");
  assert.deepEqual(calls, ["special", "common"]);
  assert.equal(r.state.drafts.at(-1)?.review?.status, "unavailable");
  assert.match(
    r.state.drafts.at(-1)?.review?.issues.join(" ") ?? "",
    /khác model viết/,
  );
});
