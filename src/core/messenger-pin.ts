export type PinProbe =
  "absent" | "ready" | "manual" | "unsupported" | "rejected" | "submitted";

// Runs only inside the account's sandboxed Facebook WebContents. Never returns a PIN or dialog text.
export function messengerPin(action: "probe" | "fill", pin = ""): PinProbe {
  if (
    location.protocol !== "https:" ||
    !["www.facebook.com", "facebook.com"].includes(location.hostname) ||
    location.port ||
    !/^\/messages(?:\/|$)/.test(location.pathname)
  )
    return "absent";
  const visible = (e: Element) =>
    e.getClientRects().length > 0 &&
    getComputedStyle(e).visibility !== "hidden" &&
    !e.closest('[aria-hidden="true"]');
  const normalized = (text: string) =>
    text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [aria-modal="true"]',
    ),
  ).filter(visible);
  // Only the existing PIN for restoring chats; never create/change/reset a PIN or enter a one-time login code.
  const targets = dialogs.filter((dialog) => {
    const headings = Array.from(
      dialog.querySelectorAll<HTMLElement>('h1,h2,h3,[role="heading"]'),
    )
      .filter(visible)
      .map((h) => h.innerText || h.textContent || "");
    const ids = (dialog.getAttribute("aria-labelledby") || "").split(/\s+/);
    const label = ids
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");
    const text = normalized(
      [dialog.getAttribute("aria-label") || "", label, ...headings].join(" ") ||
        dialog.innerText ||
        "",
    );
    return (
      !/tạo (?:mã )?pin|đổi (?:mã )?pin|đặt lại|create (?:a )?(?:new )?pin|reset|change (?:your )?pin/.test(
        text,
      ) &&
      (/nhập mã pin để khôi phục (?:đoạn chat|tin nhắn|lịch sử)/.test(text) ||
        /enter (?:your )?pin to restore (?:your )?(?:chat|message)/.test(text))
    );
  });
  if (!targets.length) return "absent";
  if (targets.length !== 1) return "unsupported";
  const dialog = targets[0];
  const text = normalized(dialog.innerText || dialog.textContent || "");
  if (
    /pin (?:không chính xác|không đúng|sai)|mã pin không|incorrect pin|wrong pin|pin is incorrect|too many attempts|quá nhiều lần/.test(
      text,
    )
  )
    return "rejected";
  const inputs = Array.from(
    dialog.querySelectorAll<HTMLInputElement>("input"),
  ).filter(
    (e) =>
      visible(e) &&
      !e.disabled &&
      !e.readOnly &&
      ["password", "text", "tel", "number"].includes(e.type),
  );
  const single =
    inputs.length === 1 &&
    (inputs[0].type === "password" ||
      inputs[0].inputMode === "numeric" ||
      /pin/i.test(inputs[0].getAttribute("aria-label") || ""));
  const split = inputs.length === 6 && inputs.every((e) => e.maxLength === 1);
  if (!single && !split) return "unsupported";
  if (inputs.some((e) => e.value.length > 0)) return "manual";
  if (action === "probe") return "ready";
  if (!/^\d{6}$/.test(pin)) return "unsupported";
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) return "unsupported";
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i],
      value = split ? pin[i] : pin;
    if (!input.isConnected || !visible(input)) return "submitted";
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      }),
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Some layouts submit on the sixth digit; others have a confirmation control inside this same dialog.
  const buttons = Array.from(
    dialog.querySelectorAll<HTMLElement>('button,[role="button"]'),
  )
    .filter(visible)
    .filter(
      (b) =>
        !b.hasAttribute("disabled") &&
        b.getAttribute("aria-disabled") !== "true" &&
        /^(?:tiếp tục|khôi phục|xác nhận|continue|restore|confirm|submit)$/.test(
          normalized(
            b.getAttribute("aria-label") || b.innerText || b.textContent || "",
          ),
        ),
    );
  if (buttons.length === 1) buttons[0].click();
  return "submitted";
}

export function messengerPinScript(action: "probe" | "fill", pin = "") {
  return `(${messengerPin.toString()})(${JSON.stringify(action)},${JSON.stringify(pin)})`;
}
