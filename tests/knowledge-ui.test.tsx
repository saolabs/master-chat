import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import { JSDOM } from "jsdom";
import { randomUUID } from "node:crypto";
import { KnowledgeSettings } from "../src/renderer/knowledge-settings.tsx";
import { applyKnowledgeCommand } from "../src/core/knowledge.ts";
import {
  emptyState,
  publicState,
  type Command,
  type DocumentImport,
  type DocumentUpload,
} from "../src/core/types.ts";

async function mount(t: TestContext, imports: DocumentImport[] = []) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.test/" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const state = emptyState(),
    accountId = randomUUID(),
    calls: Command[] = [],
    uploaded: (DocumentUpload[] | undefined)[] = [];
  state.accounts.push({
    id: accountId,
    name: "Personal",
    platform: "messenger-personal",
    username: "",
    password: "",
    cookies: [],
  });
  let failed = false,
    refresh!: () => void;
  const snapshot = () => ({
    data: publicState(state),
    tabs: [],
    paused: true,
    notice: "",
  });
  const run = async (command: Command) => {
    calls.push(command);
    if (failed) return null;
    if (
      command.type === "knowledge.import" ||
      command.type === "knowledge.add" ||
      command.type === "knowledge.update" ||
      command.type === "knowledge.remove"
    )
      applyKnowledgeCommand(state, command);
    refresh();
    return snapshot();
  };
  function Harness() {
    const [, setVersion] = useState(0);
    refresh = () => setVersion((v) => v + 1);
    return (
      <KnowledgeSettings
        sources={state.knowledge}
        accounts={publicState(state).accounts}
        busy={false}
        run={run}
        importDocuments={async (files) => {
          uploaded.push(files);
          return imports;
        }}
      />
    );
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(<Harness />));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });
  const doc = dom.window.document;
  const click = async (name: string) => {
    const button = Array.from(doc.querySelectorAll("button")).find(
      (b) => b.textContent === name || b.getAttribute("aria-label") === name,
    );
    assert.ok(button, name);
    await act(async () => button.click());
  };
  const edit = async (
    field: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        field.tagName === "TEXTAREA"
          ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, value);
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  return {
    dom,
    doc,
    state,
    accountId,
    calls,
    uploaded,
    click,
    edit,
    fail: () => {
      failed = true;
    },
  };
}

test("knowledge starts with a list, opens forms on demand, cancels without saving", async (t) => {
  const r = await mount(t);
  assert.equal(r.doc.querySelector("form"), null);
  assert.match(r.doc.body.textContent!, /Chưa có nguồn tri thức/);
  await r.click("Thêm nội dung");
  assert.ok(r.doc.querySelector('form[aria-label="Thêm tri thức"]'));
  assert.equal(r.doc.querySelector(".settings-grid"), null);
  await r.click("Hủy");
  assert.equal(r.doc.querySelector("form"), null);
  assert.equal(r.calls.length, 0);
  await r.click("Nhập tài liệu");
  assert.equal(r.doc.querySelector("form"), null);
});

test("batch preview retains good files and errors; editing and scope are saved atomically", async (t) => {
  const r = await mount(t, [
    { fileName: "policy.pdf", title: "Policy", text: "Delivery three days" },
    { fileName: "notes.docx", title: "Notes", text: "Some notes" },
    { fileName: "scan.pdf", error: "PDF cần OCR" },
  ]);
  await r.click("Nhập tài liệu");
  assert.equal(r.state.knowledge.length, 0);
  assert.equal(r.doc.querySelectorAll(".document-preview").length, 2);
  assert.match(
    r.doc.querySelector('[role="alert"]')!.textContent!,
    /PDF cần OCR/,
  );
  await r.edit(
    r.doc.querySelector(".document-preview input")!,
    "Delivery policy",
  );
  await r.edit(
    r.doc.querySelector(".document-preview textarea")!,
    "Delivery next day",
  );
  const scope = r.doc.querySelector("select")!;
  await act(async () => {
    scope.value = r.accountId;
    scope.dispatchEvent(new r.dom.window.Event("change", { bubbles: true }));
  });
  await r.click("Lưu 2 nguồn tri thức");
  assert.equal(r.calls.at(-1)?.type, "knowledge.import");
  assert.equal(r.state.knowledge.length, 2);
  assert.equal(r.state.knowledge[0].title, "Delivery policy");
  assert.equal(r.state.knowledge[0].text, "Delivery next day");
  assert.equal(r.state.knowledge[0].accountId, r.accountId);
  assert.equal(r.doc.querySelector("form"), null);
  await r.click("Chỉnh sửa Delivery policy");
  assert.ok(
    r.doc.querySelector('article[aria-label="Nguồn Delivery policy"] form'),
  );
  await r.edit(
    r.doc.querySelector(".knowledge-editor textarea")!,
    "Updated delivery",
  );
  await r.click("Lưu thay đổi");
  assert.equal(r.state.knowledge[0].text, "Updated delivery");
  await r.click("Xóa Delivery policy");
  assert.equal(r.state.knowledge.length, 2);
  await r.click("Xác nhận xóa");
  assert.equal(r.state.knowledge.length, 1);
});

test("failed save keeps imported content and retry controls", async (t) => {
  const r = await mount(t, [
    { fileName: "source.md", title: "Source", text: "My text" },
  ]);
  await r.click("Nhập tài liệu");
  r.fail();
  await r.click("Lưu 1 nguồn tri thức");
  assert.equal(
    r.doc.querySelector<HTMLTextAreaElement>("textarea")!.value,
    "My text",
  );
  assert.ok(r.doc.querySelector('form[aria-label="Nhập tài liệu"]'));
  assert.equal(r.state.knowledge.length, 0);
});

test("file drop passes local bytes to the document bridge and opens preview", async (t) => {
  const r = await mount(t, [
    { fileName: "drop.txt", title: "Drop", text: "Dropped content" },
  ]);
  const event = new r.dom.window.Event("drop", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [
        {
          name: "drop.txt",
          size: 4,
          arrayBuffer: async () => new Uint8Array([116, 101, 120, 116]).buffer,
        },
      ],
    },
  });
  await act(async () =>
    r.doc.querySelector(".knowledge-settings")!.dispatchEvent(event),
  );
  assert.equal(r.uploaded[0]![0].name, "drop.txt");
  assert.equal(Buffer.from(r.uploaded[0]![0].data).toString(), "text");
  assert.match(r.doc.body.textContent!, /drop.txt/);
});
