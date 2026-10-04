import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { loginScript } from "../src/core/login.ts";
function page(html: string, url = "https://www.facebook.com/login.php") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
    get(this: HTMLElement) {
      return this.textContent ?? "";
    },
  });
  dom.window.HTMLElement.prototype.getClientRects = function (
    this: HTMLElement,
  ) {
    return (this as HTMLElement).hidden ? [] : [{ width: 100, height: 20 }];
  } as any;
  dom.window.document.addEventListener("submit", (e) => e.preventDefault());
  return {
    dom,
    invoke: (
      action = "probe",
      username = "test-user",
      password = "test-pass",
    ) =>
      dom.window.eval(
        loginScript(action as "probe" | "submit", username, password),
      ),
  };
}
test("modern semantic login without legacy names auto submits and dispatches real input/change", () => {
  const { dom, invoke } = page(
    '<main><div><input type="text" aria-label="Email hoặc số di động"></div><div><input type="password"></div><div role="button">Đăng nhập</div></main>',
  );
  let clicks = 0,
    inputs = 0;
  dom.window.document
    .querySelector('[role="button"]')!
    .addEventListener("click", () => clicks++);
  dom.window.document.addEventListener("input", () => inputs++);
  assert.equal(invoke(), "ready");
  assert.equal(invoke("submit"), "submitted");
  assert.equal(clicks, 1);
  assert.equal(inputs, 2);
  assert.equal(
    (
      dom.window.document.querySelector(
        'input[type="password"]',
      ) as HTMLInputElement
    ).value,
    "test-pass",
  );
  assert.equal(invoke("submit"), "waiting");
  assert.equal(clicks, 1);
});
test("late hydrated form stays waiting and then becomes ready instead of consuming attempt", () => {
  const { dom, invoke } = page("<main></main>");
  assert.equal(invoke(), "waiting");
  dom.window.document.querySelector("main")!.innerHTML =
    '<form><input name="email"><input name="pass" type="password"><button name="login">Log in</button></form>';
  assert.equal(invoke(), "ready");
  assert.equal(invoke("submit"), "submitted");
});
test("verification and rejected credentials stop submission, including disabled/hidden forms", () => {
  const checkpoint = page('<input autocomplete="one-time-code">');
  assert.equal(checkpoint.invoke("submit"), "verification");
  assert.equal(
    page("<p>Mật khẩu không chính xác</p>").invoke("submit"),
    "rejected",
  );
  assert.equal(
    page(
      '<input name="email"><input type="password"><button disabled>Đăng nhập</button>',
    ).invoke("submit"),
    "waiting",
  );
  assert.equal(
    page(
      '<input name="email"><input type="password" hidden><button>Đăng nhập</button>',
    ).invoke("submit"),
    "waiting",
  );
});
test("respect manually entered credentials; allow matching prefilled email; do not treat message text as checkpoint", () => {
  assert.equal(
    page(
      '<input name="email" value="someone-else"><input type="password"><button>Đăng nhập</button>',
    ).invoke("submit"),
    "waiting",
  );
  assert.equal(
    page(
      '<input name="email" value="test-user"><input type="password"><button>Đăng nhập</button>',
    ).invoke("submit"),
    "submitted",
  );
  assert.equal(
    page(
      "<p>Nhập mã xác thực</p>",
      "https://www.facebook.com/messages/t/123/",
    ).invoke(),
    "authenticated",
  );
  assert.equal(
    page(
      '<input name="email"><input type="password"><button>Log in</button>',
      "https://example.com/login",
    ).invoke("submit"),
    "waiting",
  );
});
