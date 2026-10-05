import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { messengerPinScript } from "../src/core/messenger-pin.ts";
import { updateAccount } from "../src/core/settings.ts";
import { emptyState, publicState, type Account } from "../src/core/types.ts";
function page(html: string, url = "https://www.facebook.com/messages/t/123/") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
    get(this: HTMLElement) {
      return this.textContent ?? "";
    },
  });
  dom.window.HTMLElement.prototype.getClientRects = function (
    this: HTMLElement,
  ) {
    return this.closest('[hidden],[aria-hidden="true"]')
      ? []
      : [{ width: 100, height: 20 }];
  } as any;
  return {
    dom,
    invoke: (
      action: "probe" | "fill" | "confirm" | "focus" = "probe",
      pin = "012345",
      index = 0,
    ) => dom.window.eval(messengerPinScript(action, pin, index)),
  };
}
const heading = "<h2>Nhập mã PIN để khôi phục đoạn chat của bạn</h2>";
const fixture = (input = '<input type="password" maxlength="6">') =>
  `<div role="dialog">${heading}${input}</div>`;

test("PIN restore handles a single field and six cells with native input events, preserving leading zero", () => {
  for (const input of [
    '<input type="password" maxlength="6">',
    Array.from(
      { length: 6 },
      () => '<input type="password" maxlength="1">',
    ).join(""),
  ]) {
    const { dom, invoke } = page(fixture(input));
    let events = 0;
    dom.window.document.addEventListener("input", () => events++);
    assert.equal(invoke(), "ready");
    assert.equal(invoke("fill"), "submitted");
    assert.equal(
      Array.from(dom.window.document.querySelectorAll("input"))
        .map((i) => i.value)
        .join(""),
      "012345",
    );
    assert.equal(events, dom.window.document.querySelectorAll("input").length);
    assert.equal(invoke("fill"), "manual");
    dom.window.close();
  }
});
test("PIN restore confirms only within its own dialog; hidden, wrong-origin, OTP, reset and manually edited controls are ignored", () => {
  const { dom, invoke } = page(fixture() + "<button>Gửi</button>");
  let sends = 0;
  dom.window.document.querySelector("button")!.onclick = () => sends++;
  assert.equal(invoke("fill"), "submitted");
  assert.equal(sends, 0);
  dom.window.close();
  for (const [html, url, expected] of [
    [fixture(), "https://example.com/messages/t/123/", "absent"],
    [fixture(), "https://www.facebook.com/checkpoint/", "absent"],
    [
      '<div role="dialog"><h2>Nhập mã xác thực đăng nhập</h2><input autocomplete="one-time-code"></div>',
      undefined,
      "absent",
    ],
    [
      '<div role="dialog"><h2>Tạo mã PIN mới</h2><input type="password"></div>',
      undefined,
      "absent",
    ],
    [
      fixture().replace('role="dialog"', 'role="dialog" hidden'),
      undefined,
      "absent",
    ],
    [fixture('<input type="password" value="1">'), undefined, "manual"],
    [fixture('<input type="password" disabled>'), undefined, "unsupported"],
    [fixture() + fixture(), undefined, "unsupported"],
    [
      fixture().replace("</div>", "<p>Mã PIN không chính xác</p></div>"),
      undefined,
      "rejected",
    ],
  ] as const) {
    const p = page(html, url);
    assert.equal(p.invoke("fill"), expected);
    p.dom.window.close();
  }
});
test("English restoration title and in-dialog confirmation work without exposing PIN in result", () => {
  const p = page(
    '<div role="dialog" aria-labelledby="title"><h2 id="title">Enter your PIN to restore your chat history</h2><input inputmode="numeric"><button>Continue</button></div>',
  );
  let clicks = 0;
  p.dom.window.document.querySelector("button")!.onclick = () => clicks++;
  assert.equal(p.invoke("fill"), "submitted");
  assert.equal(clicks, 1);
  p.dom.window.close();
});
test("PIN restore recognizes short, decomposed and full-page restoration headings", () => {
  for (const html of [
    '<div role="dialog"><h2>Nhập mã PIN</h2><p>Đồng bộ lịch sử đoạn chat</p><input type="password"></div>',
    '<div role="dialog"><h2>Enter your PIN</h2><p>Sync your chat history</p><input inputmode="numeric"></div>',
    '<main><section><h1>Nhập mã PIN để truy cập đoạn chat</h1><input type="password"><button>Tiếp tục</button></section></main>',
    '<div role="dialog"><h2>Nhập mã PIN</h2><input type="password"></div>'.normalize(
      "NFD",
    ),
    '<div role="dialog"><div role="dialog"><h2>Nhập mã PIN</h2><input type="tel" maxlength="6"></div></div>',
    '<div role="dialog"><h2 id="pin-title">Nhập mã PIN</h2><input aria-labelledby="pin-title"></div>',
  ]) {
    const p = page(html);
    assert.equal(p.invoke(), "ready");
    assert.equal(p.invoke("fill"), "submitted");
    p.dom.window.close();
  }
  const chat = page(
    '<h2>Nhập mã PIN</h2><input type="password"><div contenteditable="true" role="textbox"></div>',
  );
  assert.equal(chat.invoke("fill"), "absent");
  chat.dom.window.close();
});
test("PIN confirmation waits for React readiness and never submits edited input", () => {
  const p = page(
    fixture().replace("</div>", "<button disabled>Tiếp tục</button></div>"),
  );
  let clicks = 0;
  const button = p.dom.window.document.querySelector("button")!;
  button.onclick = () => {
    clicks++;
  };
  assert.equal(p.invoke("fill"), "filled");
  assert.equal(clicks, 0);
  assert.equal(p.invoke("confirm"), "filled");
  button.disabled = false;
  p.dom.window.document.querySelector("input")!.value = "654321";
  assert.equal(p.invoke("confirm"), "manual");
  assert.equal(clicks, 0);
  p.dom.window.document.querySelector("input")!.value = "012345";
  assert.equal(p.invoke("confirm"), "submitted");
  assert.equal(clicks, 1);
  p.dom.window.close();
});
test("PIN recovery overlay without dialog role is recognized above a visible composer", () => {
  const p = page(
    '<main><div contenteditable="true" role="textbox"></div></main>' +
      '<div role="dialog"><h2>Thông tin cuộc trò chuyện</h2></div>' +
      `<section>${heading}<p>Một số tin nhắn còn thiếu.</p><input aria-label="Mã PIN" maxlength="6"></section>`,
  );
  assert.equal(p.invoke(), "ready");
  assert.equal(p.invoke("fill"), "submitted");
  assert.equal(p.dom.window.document.querySelector("input")!.value, "012345");
  p.dom.window.close();
});
test("PIN settings preserve omitted secrets, allow explicit replacement/deletion, and public state excludes the PIN", () => {
  const a: Account = {
    id: "a",
    name: "A",
    platform: "messenger-personal",
    username: "",
    password: "",
    cookies: [],
    recoveryPin: "012345",
    autoRestorePin: true,
    pinAutoFillBlocked: true,
  };
  const base = {
    name: "New name",
    platform: a.platform,
    username: "",
    password: "",
  };
  updateAccount(a, base);
  assert.equal(a.recoveryPin, "012345");
  assert.equal(a.pinAutoFillBlocked, true);
  updateAccount(a, { ...base, recoveryPin: "654321" });
  assert.equal(a.pinAutoFillBlocked, false);
  const state = emptyState();
  state.accounts.push(a);
  const data = publicState(state);
  assert.equal("recoveryPin" in data.accounts[0], false);
  assert.equal(JSON.stringify(data).includes("654321"), false);
  assert.equal(data.accounts[0].hasRecoveryPin, true);
  assert.throws(
    () => updateAccount(a, { ...base, recoveryPin: "abc" }),
    /6 chữ số/,
  );
  updateAccount(a, { ...base, clearRecoveryPin: true, autoRestorePin: true });
  assert.equal(a.recoveryPin, undefined);
  assert.equal(a.autoRestorePin, false);
});
test("native PIN focus validates labelled fields and each previously entered split digit", () => {
  const single = page(
    fixture('<label for="pin">Mã PIN</label><input id="pin" maxlength="6">'),
  );
  assert.equal(single.invoke("focus"), "single");
  assert.equal(single.dom.window.document.activeElement?.id, "pin");
  single.dom.window.document.querySelector("input")!.value = "1";
  assert.equal(single.invoke("focus"), "manual");
  single.dom.window.close();
  const split = page(
    fixture(
      Array.from(
        { length: 6 },
        () => '<input type="password" maxlength="1">',
      ).join(""),
    ),
  );
  const inputs = split.dom.window.document.querySelectorAll("input");
  assert.equal(split.invoke("focus"), "split");
  inputs[0].value = "0";
  assert.equal(split.invoke("focus", "012345", 1), "split");
  assert.equal(split.dom.window.document.activeElement, inputs[1]);
  inputs[0].value = "9";
  assert.equal(split.invoke("focus", "012345", 1), "manual");
  split.dom.window.close();
});
