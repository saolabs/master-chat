import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { AISettings } from "../src/renderer/ai-settings.tsx";
import { emptyState, publicState, type Command } from "../src/core/types.ts";
async function mount(t: TestContext, state = emptyState()) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.test/" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const calls: Command[] = [];
  const run = async (c: Command) => {
    calls.push(c);
    return { data: publicState(state), tabs: [], paused: true, notice: "" };
  };
  await act(async () =>
    root.render(
      <AISettings config={publicState(state).ai} busy={false} run={run} />,
    ),
  );
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });
  const click = async (text: string) => {
    const button = Array.from(
      dom.window.document.querySelectorAll("button"),
    ).find((b) => b.textContent === text);
    assert.ok(button, text);
    await act(async () => button.click());
  };
  return { dom, calls, click };
}
test("provider editor exposes catalog, explicit cloud permission, safe empty key and model discovery", async (t) => {
  const { dom, click } = await mount(t);
  await click("+ Thêm provider");
  assert.ok(dom.window.document.querySelector('input[type="password"]'));
  const providerType = dom.window.document.querySelector("select")!;
  assert.equal(providerType.options.length, 8);
  await act(async () => {
    providerType.value = "google";
    providerType.dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
  });
  const cloudLabel = Array.from(
    dom.window.document.querySelectorAll("label"),
  ).find((l) => l.textContent?.includes("Cho phép AI cloud"))!;
  const cloud = cloudLabel.querySelector("input")!;
  assert.equal(cloud.checked, false);
  assert.equal(
    (dom.window.document.querySelector('input[type="url"]') as HTMLInputElement)
      .value,
    "https://generativelanguage.googleapis.com/v1beta",
  );
  await act(async () => cloud.click());
  assert.match(
    dom.window.document.body.textContent!,
    /lịch sử tin nhắn, tóm tắt và tri thức liên quan/,
  );
  assert.ok(
    Array.from(dom.window.document.querySelectorAll("button")).find(
      (b) => b.textContent === "Lưu & tải danh sách model",
    ),
  );
});
test("task selectors group provider-model pairs, show effective inheritance and save an override", async (t) => {
  const state = emptyState();
  state.ai.providers.push({
    id: "p",
    name: "Provider A",
    type: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "secret-ui-key",
    enabled: true,
    allowRemote: false,
    models: ["one", "two"],
    availableModels: [],
  });
  state.ai.default = { providerId: "p", modelId: "one" };
  const { dom, calls, click } = await mount(t, state);
  await click("Model theo tác vụ");
  assert.equal(
    dom.window.document.body.textContent!.includes("secret-ui-key"),
    false,
  );
  assert.match(
    dom.window.document.body.textContent!,
    /Kế thừa: Provider A · one/,
  );
  const select = dom.window.document.querySelector<HTMLSelectElement>(
    'select[aria-label="Model Tóm tắt ngữ cảnh"]',
  )!;
  assert.equal(select.querySelector("optgroup")?.label, "Provider A");
  await act(async () => {
    select.value = JSON.stringify(["p", "two"]);
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await click("Lưu model theo tác vụ");
  const cmd = calls.at(-1);
  assert.equal(cmd?.type, "ai.save");
  if (cmd?.type === "ai.save")
    assert.deepEqual(cmd.config.tasks.summary, {
      providerId: "p",
      modelId: "two",
    });
});

test("provider catalogs are selectable before any API call and switch with the provider", async (t) => {
  const { dom, calls, click } = await mount(t);
  await click("+ Thêm provider");
  const doc = dom.window.document;
  const select = doc.querySelector("select")!;
  const changeProvider = async (type: string) => {
    await act(async () => {
      select.value = type;
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  };
  const modelNames = () =>
    Array.from(
      doc.querySelectorAll(".model-option strong"),
      (el) => el.textContent,
    );
  for (const [type, model] of [
    ["openai", "gpt-4o-mini"],
    ["anthropic", "claude-sonnet-4-6"],
    ["google", "gemini-2.5-flash"],
    ["deepseek", "deepseek-v4-flash"],
  ]) {
    await changeProvider(type);
    assert.ok(modelNames().includes(model), type);
    assert.equal(
      modelNames().some((id) => id?.includes("-image")),
      false,
    );
  }
  await changeProvider("nvidia");
  assert.deepEqual(modelNames(), []);
  assert.equal(calls.length, 0);
  await changeProvider("openai");
  const option = Array.from(doc.querySelectorAll(".model-option")).find(
    (el) => el.querySelector("strong")?.textContent === "gpt-4o-mini",
  )!;
  assert.ok(option.querySelector("small")?.textContent);
  await act(async () =>
    (option.querySelector("input") as HTMLInputElement).click(),
  );
  await click("Lưu provider");
  const saved = calls.at(-1);
  assert.equal(saved?.type, "provider.save");
  if (saved?.type === "provider.save") {
    assert.equal(saved.provider.type, "openai");
    assert.deepEqual(saved.provider.models, ["gpt-4o-mini"]);
  }
});

test("saved models outside the provider catalog remain visible and removable", async (t) => {
  const state = emptyState();
  state.ai.providers.push({
    id: "cloud",
    name: "Claude",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "",
    enabled: true,
    allowRemote: true,
    models: ["legacy-claude"],
    availableModels: ["account-model"],
  });
  const { dom, calls, click } = await mount(t, state);
  await click("Chỉnh sửa");
  const options = Array.from(
    dom.window.document.querySelectorAll(".model-option"),
  );
  assert.ok(
    options.some(
      (el) => el.querySelector("strong")?.textContent === "claude-sonnet-4-6",
    ),
  );
  assert.ok(
    options.some(
      (el) => el.querySelector("strong")?.textContent === "account-model",
    ),
  );
  const stale = options.find(
    (el) => el.querySelector("strong")?.textContent === "legacy-claude",
  )!;
  const input = stale.querySelector("input") as HTMLInputElement;
  assert.equal(input.checked, true);
  await act(async () => input.click());
  await click("Lưu provider");
  const saved = calls.at(-1);
  if (saved?.type === "provider.save")
    assert.deepEqual(saved.provider.models, []);
  else assert.fail("Expected provider.save");
});
