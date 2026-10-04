import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Vault, type SecretStorage } from "../electron/vault.ts";
import { seal, unseal } from "../src/core/crypto.ts";
import { emptyState, publicState } from "../src/core/types.ts";
const osKey = randomBytes(32);
const secrets: SecretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => seal(value, osKey),
  decryptString: (value) => unseal(value, osKey),
};
async function directory(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "master-chat-vault-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test("vault roundtrip and parallel mutations preserve all data encrypted", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await Promise.all(
    Array.from({ length: 8 }, (_, n) =>
      v.mutate((s) => {
        s.knowledge.push({
          id: String(n),
          title: "Test",
          text: "secret-text-unique",
          accountId: null,
        });
      }),
    ),
  );
  assert.equal(v.read().knowledge.length, 8);
  const bytes = await readFile(path.join(dir, "data.vault"));
  assert.equal(bytes.includes(Buffer.from("secret-text-unique")), false);
  const reopened = new Vault(dir, secrets);
  await reopened.open();
  assert.equal(reopened.read().knowledge.length, 8);
});
test("corrupted vault is preserved and never silently reset", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  const target = path.join(dir, "data.vault"),
    bytes = await readFile(target);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(target, bytes);
  await assert.rejects(new Vault(dir, secrets).open());
  assert.deepEqual(await readFile(target), bytes);
});
test("missing key with existing vault cannot regenerate a new key", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await rm(path.join(dir, "key.secure"));
  await assert.rejects(new Vault(dir, secrets).open(), /thiếu khóa/);
});
test("no OS encryption means no plaintext fallback", async (t) => {
  const dir = await directory(t);
  await assert.rejects(
    new Vault(dir, { ...secrets, isEncryptionAvailable: () => false }).open(),
    /plaintext/,
  );
});
test("restart moves unfinished sending to uncertain", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await v.mutate((s) => {
    s.drafts.push({
      id: "d",
      conversationId: "c",
      text: "Test",
      basedOnId: null,
      triggerIds: [],
      proactive: true,
      status: "sending",
      createdAt: Date.now(),
    });
  });
  const reopened = new Vault(dir, secrets);
  await reopened.open();
  assert.equal(reopened.read().drafts[0].status, "uncertain");
});
test("public state excludes credentials and cookies", () => {
  const state = emptyState();
  state.accounts.push({
    id: "a",
    name: "A",
    username: "user",
    password: "unique-password",
    platform: "messenger-personal",
    cookies: [{ value: "cookie-secret" }],
  });
  const publicData = publicState(state);
  const json = JSON.stringify(publicData);
  assert.equal(json.includes("unique-password"), false);
  assert.equal(json.includes("cookie-secret"), false);
  assert.equal("password" in publicData.accounts[0], false);
  assert.equal("cookies" in publicData.accounts[0], false);
});

test("vault reopening migrates legacy AI config and retains encrypted credentials", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await v.mutate((s) => {
    s.ai = {
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "old-model",
      models: { summary: "summary-model", knowledge: "", reply: "" },
    } as any;
    s.accounts.push({
      id: "a",
      name: "A",
      platform: "messenger-personal",
      username: "u",
      password: "stored-password",
      cookies: [],
    });
  });
  const reopened = new Vault(dir, secrets);
  await reopened.open();
  assert.equal(reopened.read().accounts[0].password, "stored-password");
  assert.equal(reopened.read().ai.tasks.summary?.modelId, "summary-model");
  assert.equal(reopened.read().ai.default?.modelId, "old-model");
  assert.equal(reopened.read().ai.providers[0].allowRemote, false);
});

test("vault reopening purges legacy fanpage accounts and associated data", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await v.mutate((s) => {
    s.accounts.push({
      id: "personal-1",
      name: "Personal",
      platform: "messenger-personal",
      username: "u1",
      password: "p1",
      cookies: [],
    });
    s.accounts.push({
      id: "page-1",
      name: "Fanpage",
      platform: "messenger-page" as any,
      username: "u2",
      password: "p2",
      assetId: "12345",
      cookies: [],
    } as any);
    s.conversations.push({
      id: "conv-personal",
      accountId: "personal-1",
      platformId: "111",
      name: "Chat 1",
      url: "https://www.facebook.com/messages/t/111",
      messages: [],
      initialized: true,
      autoReply: false,
      pendingIds: [],
      summary: { text: "", coveredIds: [], revision: 0 },
    });
    s.conversations.push({
      id: "conv-page",
      accountId: "page-1",
      platformId: "222",
      name: "Chat 2",
      url: "https://business.facebook.com/latest/inbox/messenger?asset_id=12345&selected_item_id=222&thread_type=FB_MESSAGE",
      messages: [],
      initialized: true,
      autoReply: false,
      pendingIds: [],
      summary: { text: "", coveredIds: [], revision: 0 },
    });
    s.drafts.push({
      id: "draft-page",
      conversationId: "conv-page",
      text: "hello",
      basedOnId: null,
      triggerIds: [],
      proactive: false,
      status: "draft",
      createdAt: Date.now(),
    });
    s.knowledge.push({
      id: "k-page",
      title: "Page info",
      text: "info",
      accountId: "page-1",
    });
    (s.profiles as any)["messenger-page"] = { verified: true };
  });

  const reopened = new Vault(dir, secrets);
  await reopened.open();
  const state = reopened.read();

  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].id, "personal-1");
  assert.equal("assetId" in state.accounts[0], false);
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].id, "conv-personal");
  assert.equal(state.drafts.length, 0);
  assert.equal(state.knowledge.length, 0);
  assert.equal("messenger-page" in state.profiles, false);
});

test("recovery PIN stays encrypted on disk and the attempt guard survives reopening", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await v.mutate((s) =>
    s.accounts.push({
      id: "a",
      name: "A",
      platform: "messenger-personal",
      username: "",
      password: "",
      cookies: [],
      recoveryPin: "098765",
      autoRestorePin: true,
      pinAutoFillBlocked: true,
    }),
  );
  assert.equal(
    (await readFile(path.join(dir, "data.vault"))).includes(
      Buffer.from("098765"),
    ),
    false,
  );
  const reopened = new Vault(dir, secrets);
  await reopened.open();
  assert.equal(reopened.read().accounts[0].recoveryPin, "098765");
  assert.equal(reopened.read().accounts[0].pinAutoFillBlocked, true);
  assert.equal(
    JSON.stringify(publicState(reopened.read())).includes("098765"),
    false,
  );
});

test("cached transcript, contact profile and owner context survive encrypted vault reopening", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await v.mutate((s) => {
    s.conversations.push({
      id: "c",
      accountId: "a",
      platformId: "123",
      name: "Friend",
      url: "https://www.facebook.com/messages/t/123/",
      messages: Array.from({ length: 50 }, (_, n) => ({
        id: `m-${n}`,
        text: n ? `Tin ${n}` : "",
        direction: n % 2 ? "outgoing" : "incoming",
        timestamp: n,
        observedAt: n,
        baseline: true,
        ...(n === 0
          ? {
              attachments: [
                {
                  id: "voice",
                  kind: "audio" as const,
                  analysis: "cached-private-transcript-10am",
                  analyzedAt: 100,
                },
              ],
            }
          : {}),
      })),
      initialized: true,
      autoReply: false,
      pendingIds: [],
      summary: { text: "", coveredIds: [], revision: 0 },
      relationshipContext: "private-relationship-detail",
      conversationDirection: "Listen patiently",
      contactProfile: {
        version: 1,
        relationship: { detail: "Friends", evidenceIds: ["m-1"] },
        address: null,
        style: null,
        facts: [],
        cautions: [],
        messageCount: 50,
        ownerMessageCount: 25,
        sourceIds: Array.from({ length: 50 }, (_, n) => `m-${n}`),
        sourceHashes: {},
        updatedAt: 100,
      },
    });
  });
  const bytes = await readFile(path.join(dir, "data.vault"));
  assert.equal(bytes.includes(Buffer.from("cached-private-transcript")), false);
  assert.equal(
    bytes.includes(Buffer.from("private-relationship-detail")),
    false,
  );
  const reopened = new Vault(dir, secrets);
  await reopened.open();
  const c = reopened.read().conversations[0];
  assert.equal(
    c.messages[0].attachments?.[0].analysis,
    "cached-private-transcript-10am",
  );
  assert.equal(c.contactProfile?.messageCount, 50);
  assert.equal(c.relationshipContext, "private-relationship-detail");
  assert.equal(c.conversationDirection, "Listen patiently");
});
