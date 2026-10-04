export type LoginProbe =
  "ready" | "waiting" | "authenticated" | "verification" | "rejected";
// Serialized into Facebook's main world. No messages or credentials are returned to the renderer.
export function facebookLogin(
  action: "probe" | "submit",
  username = "",
  password = "",
): LoginProbe | "submitted" {
  if (
    location.protocol !== "https:" ||
    !["www.facebook.com", "facebook.com"].includes(location.hostname)
  )
    return "waiting";
  const visible = (e: Element) =>
    e.getClientRects().length > 0 &&
    getComputedStyle(e).visibility !== "hidden";
  const inbox = /\/messages(?:\/|$)/.test(location.pathname);
  const text = inbox ? "" : (document.body?.innerText ?? "").toLowerCase();
  if (
    /checkpoint|two_step|two_factor|challenge|recover|auth_platform/.test(
      location.pathname,
    ) ||
    document.querySelector(
      'input[name="approvals_code"],input[autocomplete="one-time-code"],iframe[src*="captcha"]',
    ) ||
    /enter the code|nhập mã xác|mã xác thực|check your notifications|kiểm tra thông báo/.test(
      text,
    )
  )
    return "verification";
  if (
    /incorrect password|wrong password|mật khẩu.*không (đúng|chính xác)|invalid credentials/.test(
      text,
    )
  )
    return "rejected";
  const pass = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="password"],input[name="pass"]',
    ),
  ).find(visible);
  if (!pass)
    return /\/messages(?:\/|$)/.test(location.pathname)
      ? "authenticated"
      : "waiting";
  const root = pass.closest("form") ?? document;
  const email = Array.from(
    root.querySelectorAll<HTMLInputElement>(
      'input[name="email"],input[type="email"],input[autocomplete="username"],input[type="text"],input[type="tel"]',
    ),
  ).find(visible);
  const buttons = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button,input[type="submit"],[role="button"]',
    ),
  ).filter(visible);
  const button =
    buttons.find((b) =>
      /^(log in|login|sign in|đăng nhập)$/i.test(
        (
          b.innerText ||
          b.getAttribute("aria-label") ||
          (b as HTMLInputElement).value ||
          ""
        ).trim(),
      ),
    ) ??
    buttons.find(
      (b) =>
        b.getAttribute("name") === "login" ||
        b.getAttribute("type") === "submit",
    );
  if (
    !email ||
    !button ||
    (button as HTMLButtonElement).disabled ||
    button.getAttribute("aria-disabled") === "true"
  )
    return "waiting";
  if (action === "probe") return "ready";
  // Respect a person already typing in the form.
  if (
    (email.value && email.value.toLowerCase() !== username.toLowerCase()) ||
    pass.value
  )
    return "waiting";
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  for (const [input, value] of [
    [email, username],
    [pass, password],
  ] as const) {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  button.click();
  return "submitted";
}

export function loginScript(
  action: "probe" | "submit",
  username = "",
  password = "",
) {
  // tsx/esbuild can preserve inner function names with this helper. Keep serialized execution self-contained.
  return `(() => {const __name = (value) => value; return (${facebookLogin.toString()})(${JSON.stringify(action)},${JSON.stringify(username)},${JSON.stringify(password)});})()`;
}
