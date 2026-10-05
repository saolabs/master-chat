export type PinProbe =
  | "absent"
  | "ready"
  | "manual"
  | "unsupported"
  | "rejected"
  | "filled"
  | "single"
  | "split"
  | "submitted";

// Runs only inside the account's sandboxed Facebook WebContents. Never returns a PIN or dialog text.
export function messengerPin(
  action: "probe" | "fill" | "confirm" | "focus",
  pin = "",
  index = 0,
): PinProbe {
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
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [aria-modal="true"]',
    ),
  ).filter(visible);
  // Only the existing PIN for restoring chats; never create/change/reset a PIN or enter a one-time login code.
  // Some Messenger versions render restoration as a page/form rather than a dialog.
  // Never look through message history for a PIN prompt.
  const candidates = [...dialogs];
  const composerVisible = Array.from(
    document.querySelectorAll('[contenteditable="true"][role="textbox"]'),
  ).some(visible);
  {
    for (const heading of Array.from(
      document.querySelectorAll<HTMLElement>('h1,h2,h3,[role="heading"]'),
    ).filter(visible)) {
      const title = normalized(heading.textContent || "");
      if (!/^(?:nhap (?:ma )?pin|enter (?:your )?pin)\b/.test(title)) continue;
      // Messenger can keep its composer visible behind a recovery overlay
      // without role=dialog. Require the full restoration title in that case.
      if (
        (composerVisible || dialogs.length > 0) &&
        !/^(?:nhap (?:ma )?pin de khoi phuc (?:doan chat|tin nhan|lich su)|enter (?:your )?pin to restore (?:your )?(?:chat|message))/.test(
          title,
        )
      )
        continue;
      let parent = heading.parentElement;
      while (parent && parent !== document.body) {
        if (Array.from(parent.querySelectorAll("input")).some(visible)) {
          if (
            !parent.querySelector('[contenteditable="true"]') &&
            !candidates.includes(parent)
          )
            candidates.push(parent);
          break;
        }
        parent = parent.parentElement;
      }
    }
  }
  const matching = candidates.filter((dialog) => {
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
      !/tao (?:ma )?pin|doi (?:ma )?pin|dat lai|create (?:a )?(?:new )?pin|reset|change (?:your )?pin/.test(
        text,
      ) &&
      (/^(?:nhap (?:ma )?pin|enter (?:your )?pin)\b/.test(text) ||
        (/\bpin\b/.test(text) && /khoi phuc|dong bo|restore|sync/.test(text)))
    );
  });
  const targets = matching.filter(
    (target) =>
      !matching.some((other) => other !== target && target.contains(other)),
  );
  if (!targets.length) return "absent";
  if (targets.length !== 1) return "unsupported";
  const dialog = targets[0];
  const text = normalized(dialog.innerText || dialog.textContent || "");
  if (
    /pin (?:khong chinh xac|khong dung|sai)|ma pin khong|incorrect pin|wrong pin|pin is incorrect|too many attempts|qua nhieu lan/.test(
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
      inputs[0].type === "tel" ||
      inputs[0].maxLength === 6 ||
      /pin/i.test(
        [
          inputs[0].getAttribute("aria-label") || "",
          ...(inputs[0].getAttribute("aria-labelledby") || "")
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || ""),
          ...Array.from(inputs[0].labels || []).map(
            (label) => label.textContent || "",
          ),
        ].join(" "),
      ));
  const split = inputs.length === 6 && inputs.every((e) => e.maxLength === 1);
  if (!single && !split) return "unsupported";
  if (action === "focus") {
    if (
      !/^\d{6}$/.test(pin) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= inputs.length
    )
      return "unsupported";
    if (
      inputs.some(
        (input, i) => input.value !== (split && i < index ? pin[i] : ""),
      )
    )
      return "manual";
    inputs[index].focus();
    return split ? "split" : "single";
  }
  if (action !== "confirm" && inputs.some((e) => e.value.length > 0))
    return "manual";
  if (action === "probe") return "ready";
  if (!/^\d{6}$/.test(pin)) return "unsupported";
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) return "unsupported";
  if (action === "confirm" && inputs.map((i) => i.value).join("") !== pin)
    return "manual";
  for (let i = 0; action === "fill" && i < inputs.length; i++) {
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
    .filter((b) =>
      /^(?:tiep tuc|khoi phuc|xac nhan|continue|restore|confirm|submit)$/.test(
        normalized(
          b.getAttribute("aria-label") || b.innerText || b.textContent || "",
        ),
      ),
    );
  if (buttons.length > 1) return "unsupported";
  if (buttons.length === 1) {
    if (
      buttons[0].hasAttribute("disabled") ||
      buttons[0].getAttribute("aria-disabled") === "true"
    )
      return "filled";
    buttons[0].click();
  }
  return "submitted";
}

export function messengerPinScript(
  action: "probe" | "fill" | "confirm" | "focus",
  pin = "",
  index = 0,
) {
  return `(() => {const __name=(value)=>value; return (${messengerPin.toString()})(${JSON.stringify(action)},${JSON.stringify(pin)},${JSON.stringify(index)});})()`;
}
