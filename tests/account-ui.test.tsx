import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { AccountSettings } from "../src/renderer/account-settings.tsx";
import { emptyState, publicState, type Command } from "../src/core/types.ts";
async function mount(t: TestContext) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.test/" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const state = emptyState();
  for (const [id, name] of [
    ["a", "Account A"],
    ["b", "Account B"],
  ])
    state.accounts.push({
      id,
      name,
      platform: "messenger-personal",
      username: id + "@test",
      password: "private-password",
      recoveryPin: "012345",
      autoRestorePin: true,
      cookies: [],
    });
  const calls: Command[] = [];
  let failed = false;
  const run = async (c: Command) => {
    calls.push(c);
    return failed
      ? null
      : { data: publicState(state), tabs: [], paused: true, notice: "" };
  };
  await act(async () =>
    root.render(
      <AccountSettings
        accounts={publicState(state).accounts}
        tabs={[]}
        busy={false}
        run={run}
        open={() => {}}
      />,
    ),
  );
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });
  const click = async (
    text: string,
    container: ParentNode = dom.window.document,
  ) => {
    const b = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === text,
    );
    assert.ok(b, text);
    await act(async () => b.click());
  };
  const type = async (input: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  return {
    dom,
    calls,
    click,
    type,
    fail: (value: boolean) => (failed = value),
  };
}
test("account edit stays inside the selected card; failed save preserves values and original ID", async (t) => {
  const r = await mount(t),
    doc = r.dom.window.document,
    card = doc.querySelector('article[aria-label="Tài khoản Account B"]')!;
  await r.click("Sửa", card);
  const form = card.querySelector("form")!;
  assert.ok(form);
  assert.equal(doc.querySelector(".account-create"), null);
  assert.match(card.textContent!, /Chỉnh sửa tài khoản · Account B/);
  const name = form.querySelector("input")!;
  assert.equal(name.value, "Account B");
  assert.equal(
    form.querySelector<HTMLInputElement>("input[type=password]")!.value,
    "",
  );
  assert.ok(!doc.body.textContent!.includes("private-password"));
  await r.type(name, "Renamed B");
  r.fail(true);
  await r.click("Lưu thay đổi", form);
  const command = r.calls.at(-1);
  assert.equal(command?.type, "account.save");
  if (command?.type === "account.save") {
    assert.equal(command.id, "b");
    assert.equal(command.name, "Renamed B");
    assert.equal(command.password, "");
    assert.equal(command.recoveryPin, "");
    assert.equal(command.autoRestorePin, true);
  }
  assert.equal(name.value, "Renamed B");
  assert.ok(card.querySelector("form"));
  r.fail(false);
  await r.click("Lưu thay đổi", form);
  assert.equal(card.querySelector("form"), null);
});
test("cancel makes no request and creation is a distinct form without an existing account ID", async (t) => {
  const r = await mount(t),
    doc = r.dom.window.document;
  await r.click(
    "Sửa",
    doc.querySelector('article[aria-label="Tài khoản Account A"]')!,
  );
  await r.type(doc.querySelector("form input")!, "Unsaved");
  await r.click("Hủy");
  assert.equal(r.calls.length, 0);
  assert.equal(doc.querySelector("form"), null);
  await r.click("+ Thêm tài khoản");
  const form = doc.querySelector(".account-create form")!;
  assert.equal(doc.querySelector(".account-card form"), null);
  assert.equal(form.getAttribute("aria-label"), "Thêm tài khoản");
  await r.type(form.querySelector("input")!, "New account");
  await r.click("Thêm tài khoản", form);
  const command = r.calls.at(-1);
  assert.equal(command?.type, "account.save");
  if (command?.type === "account.save") {
    assert.equal(command.id, undefined);
    assert.equal(command.name, "New account");
  }
});
