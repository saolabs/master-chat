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
  await click("Tạo provider");
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
  await click("Lưu thay đổi");
  const saved = calls.at(-1);
  if (saved?.type === "provider.save")
    assert.deepEqual(saved.provider.models, []);
  else assert.fail("Expected provider.save");
});

test("optional response settings save with no profile fields and expose current-model media inheritance", async (t) => {
  const { dom, calls, click } = await mount(t);
  await click("Phong cách & nhịp trả lời");
  assert.match(
    dom.window.document.body.textContent!,
    /Mọi thiết lập đều tùy chọn/,
  );
  const textareas = dom.window.document.querySelectorAll("textarea");
  assert.equal(textareas.length, 4);
  assert.ok(Array.from(textareas).every((input) => !input.required));
  const image = dom.window.document.querySelector<HTMLSelectElement>(
    'select[aria-label="Model đọc ảnh (tùy chọn)"]',
  )!;
  assert.equal(image.value, "");
  const testArea = textareas[3];
  const pasted = new dom.window.Event("paste", {
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    testArea.dispatchEvent(pasted);
  });
  assert.equal(pasted.defaultPrevented, true);
  await click("Lưu thiết lập trả lời");
  assert.deepEqual(calls.at(-1), { type: "response.save", settings: {} });
});

test("audio defaults to local transcription and the provider selector excludes chat models", async (t) => {
  const state = emptyState();
  state.ai.providers.push({
    id: "p",
    name: "Local",
    type: "openai_compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: "",
    enabled: true,
    allowRemote: false,
    models: ["chat-one", "whisper-small"],
    availableModels: [],
  });
  const { dom, calls, click } = await mount(t, state);
  await click("Phong cách & nhịp trả lời");
  const mode = Array.from(dom.window.document.querySelectorAll("select")).find(
    (el) => el.textContent?.includes("Dịch vụ phiên âm riêng"),
  )!;
  assert.equal(mode.value, "local");
  await act(async () => {
    mode.value = "provider";
    mode.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const model = dom.window.document.querySelector<HTMLSelectElement>(
    'select[aria-label="Model phiên âm (tùy chọn)"]',
  )!;
  assert.ok(model.textContent!.includes("whisper-small"));
  assert.ok(!model.textContent!.includes("chat-one"));
  await act(async () => {
    model.value = JSON.stringify(["p", "whisper-small"]);
    model.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await click("Lưu thiết lập trả lời");
  const saved = calls.at(-1);
  assert.equal(saved?.type, "response.save");
  if (saved?.type === "response.save") {
    assert.equal(saved.settings.media?.transcription?.mode, "provider");
    assert.equal(saved.settings.media?.audioModel?.modelId, "whisper-small");
  }
});

test("provider editing belongs to its card, cancels locally and keeps the selected provider ID", async (t) => {
  const state = emptyState();
  for (const [id, name] of [
    ["a", "Provider A"],
    ["b", "Provider B"],
  ])
    state.ai.providers.push({
      id,
      name,
      type: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "secret",
      enabled: true,
      allowRemote: false,
      models: ["one"],
      availableModels: [],
    });
  const r = await mount(t, state),
    doc = r.dom.window.document,
    card = doc.querySelector('article[aria-label="Provider Provider B"]')!;
  await act(async () =>
    Array.from(card.querySelectorAll("button"))
      .find((b) => b.textContent === "Chỉnh sửa")!
      .click(),
  );
  const form = card.querySelector("form")!;
  assert.ok(form);
  assert.equal(doc.querySelectorAll(".provider-editor").length, 1);
  assert.match(card.textContent!, /Chỉnh sửa provider · Provider B/);
  assert.match(card.textContent!, /Đang chỉnh sửa/);
  await r.click("Hủy");
  assert.equal(r.calls.length, 0);
  assert.equal(card.querySelector("form"), null);
  await act(async () =>
    Array.from(card.querySelectorAll("button"))
      .find((b) => b.textContent === "Chỉnh sửa")!
      .click(),
  );
  await r.click("Lưu thay đổi");
  const command = r.calls.at(-1);
  assert.equal(command?.type, "provider.save");
  if (command?.type === "provider.save") assert.equal(command.provider.id, "b");
  await r.click("+ Thêm provider");
  assert.ok(doc.querySelector('form[aria-label="Thêm provider"]'));
  assert.equal(doc.querySelector(".provider-card form"), null);
});

test("provider editor adds multiple masked keys and can remove one saved key without exposing secrets", async (t) => {
  const state = emptyState();
  state.ai.providers.push({
    id: "p",
    name: "Provider",
    type: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "stored-secret-one",
    apiKeys: ["stored-secret-one", "stored-secret-two"],
    activeApiKeyIndex: 1,
    enabled: true,
    allowRemote: false,
    models: ["one"],
    availableModels: [],
  });
  const { dom, calls, click } = await mount(t, state);
  await click("Chỉnh sửa");
  const doc = dom.window.document;
  assert.ok(!doc.body.innerHTML.includes("stored-secret"));
  assert.match(doc.body.textContent!, /Key 2 · đã mã hóa · đang dùng/);
  await click("Xóa key 1");
  await click("+ Thêm API key");
  const inputs = doc.querySelectorAll<HTMLInputElement>(
    'input[type="password"]',
  );
  assert.equal(inputs.length, 2);
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(inputs[0], "new-secret-one");
    inputs[0].dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    setter.call(inputs[1], "new-secret-two");
    inputs[1].dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await click("Lưu thay đổi");
  const command = calls.at(-1);
  assert.equal(command?.type, "provider.save");
  if (command?.type === "provider.save") {
    assert.equal(command.provider.apiKey, "");
    assert.deepEqual(command.provider.apiKeys, [
      "new-secret-one",
      "new-secret-two",
    ]);
    assert.deepEqual(command.removeApiKeyIndexes, [0]);
  }
});
