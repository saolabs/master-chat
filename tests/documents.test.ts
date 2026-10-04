import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  extractDocument,
  readDocumentUploads,
  readDocumentFiles,
  MAX_DOCUMENT_BYTES,
} from "../electron/documents.ts";
import { applyKnowledgeCommand } from "../src/core/knowledge.ts";
import { emptyState } from "../src/core/types.ts";
import { searchKnowledge } from "../src/core/conversation.ts";

test("text imports preserve Vietnamese, Markdown and UTF-16 BOM", async () => {
  const content = "Điều khoản: thanh toán khi nhận hàng.\n\nGiao trong 3 ngày.";
  for (const name of ["policy.txt", "policy.MD", "policy.markdown"]) {
    const result = await extractDocument({ name, data: Buffer.from(content) });
    assert.equal(result.text, content);
    assert.equal(result.title, "policy");
  }
  const result = await extractDocument({
    name: "unicode.txt",
    data: Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(content, "utf16le"),
    ]),
  });
  assert.equal(result.text, content);
});

test("HTML imports decode entities and retain paragraphs without scripts or styles", async () => {
  const result = await extractDocument({
    name: "terms.html",
    data: Buffer.from(
      '<html><head><title>Hidden</title><style>bad css</style></head><body><h1>Điều khoản</h1><p>Giao &amp; nhận</p><script>alert("bad script")</script><p>3 ngày</p></body></html>',
    ),
  });
  assert.match(result.text!, /Giao & nhận/);
  assert.match(result.text!, /3 ngày/);
  assert.doesNotMatch(result.text!, /script|css|Hidden/);
});

for (const extension of ["doc", "docx", "pdf"])
  test(`extract actual ${extension.toUpperCase()} fixture`, async () => {
    const data = await readFile(
      new URL(`../fixtures/documents/sample.${extension}`, import.meta.url),
    );
    const result = await extractDocument({ name: `sample.${extension}`, data });
    assert.equal(result.error, undefined);
    assert.match(result.text!, /Sample knowledge document/);
    assert.match(result.text!, /Delivery takes three working days/);
    assert.match(result.text!, /Điều khoản/);
  });

test("batch imports isolate corrupt and unsupported documents", async () => {
  const result = await readDocumentUploads([
    { name: "good.txt", data: Buffer.from("Delivery policy") },
    { name: "broken.pdf", data: Buffer.from("not a PDF") },
    { name: "broken.docx", data: Buffer.from("not Word") },
    { name: "unsupported.zip", data: Buffer.from("no") },
    { name: "empty.txt", data: Buffer.from("  ") },
    { name: "legacy.txt", data: Buffer.from([0xff, 0xff]) },
  ]);
  assert.equal(result[0].text, "Delivery policy");
  assert.ok(result.slice(1).every((r) => r.error));
  assert.match(result[5].error!, /UTF-8/);
  const large = await extractDocument({
    name: "large.txt",
    data: new Uint8Array(MAX_DOCUMENT_BYTES + 1),
  });
  assert.match(large.error!, /20 MB/);
  const long = await extractDocument({
    name: "long.md",
    data: Buffer.from("x".repeat(100001)),
  });
  assert.match(long.error!, /100.000/);
  await assert.rejects(
    readDocumentUploads(
      Array.from({ length: 31 }, () => ({
        name: "file.txt",
        data: Buffer.from("a"),
      })),
    ),
    /30 file/,
  );
});

test("picker file paths are read locally and missing files remain per-file errors", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-test-"));
  try {
    await writeFile(path.join(dir, "source.md"), "# Chính sách\nGiao hàng");
    const result = await readDocumentFiles([
      path.join(dir, "source.md"),
      path.join(dir, "missing.txt"),
    ]);
    assert.equal(result[0].fileName, "source.md");
    assert.match(result[0].text!, /Giao hàng/);
    assert.ok(result[1].error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("imports are validated as a batch, scoped and available to retrieval; updates preserve filename", () => {
  const state = emptyState(),
    accountId = randomUUID();
  state.accounts.push({
    id: accountId,
    name: "Me",
    platform: "messenger-personal",
    username: "",
    password: "",
    cookies: [],
  });
  const sources = [
    {
      title: "Policy",
      text: "delivery takes three working days",
      fileName: "policy.pdf",
    },
  ];
  applyKnowledgeCommand(state, {
    type: "knowledge.import",
    sources,
    accountId,
  });
  assert.equal(
    searchKnowledge(state.knowledge, "delivery", accountId).length,
    1,
  );
  assert.equal(
    searchKnowledge(state.knowledge, "delivery", randomUUID()).length,
    0,
  );
  const id = state.knowledge[0].id;
  applyKnowledgeCommand(state, {
    type: "knowledge.update",
    knowledgeId: id,
    title: "Changed",
    text: "delivery next day",
    accountId: null,
  });
  assert.equal(state.knowledge[0].fileName, "policy.pdf");
  assert.equal(
    searchKnowledge(state.knowledge, "delivery", randomUUID()).length,
    1,
  );
  assert.throws(() =>
    applyKnowledgeCommand(state, {
      type: "knowledge.import",
      sources: [...sources, { ...sources[0], text: " " }],
      accountId: null,
    }),
  );
  assert.equal(state.knowledge.length, 1);
  assert.throws(
    () =>
      applyKnowledgeCommand(state, {
        type: "knowledge.import",
        sources,
        accountId: randomUUID(),
      }),
    /Tài khoản/,
  );
  applyKnowledgeCommand(state, { type: "knowledge.remove", knowledgeId: id });
  assert.equal(state.knowledge.length, 0);
});
