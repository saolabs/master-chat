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
    invoke: (action: "probe" | "fill" = "probe", pin = "012345") =>
      dom.window.eval(messengerPinScript(action, pin)),
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
