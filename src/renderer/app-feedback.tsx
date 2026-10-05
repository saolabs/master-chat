import React, { useEffect, useState } from "react";
import { CircleAlert, Info, X } from "lucide-react";
import type { Snapshot } from "../core/types.ts";

function messageText(message: string) {
  return message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
    .replace(/^(?:Error:\s*)+/i, "")
    .trim();
}

function sameMessage(left: string, right: string) {
  const normalize = (message: string) =>
    messageText(message)
      .replace(/^Tự trả lời tạm dừng\s*·\s*/u, "")
      .normalize("NFC");
  return Boolean(left && right && normalize(left) === normalize(right));
}

function Toast({
  message,
  kind,
  onClose,
}: {
  message: string;
  kind: "info" | "warning" | "error";
  onClose?: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!visible || hovered || focused || kind === "error") return;
    const timer = setTimeout(
      () => setVisible(false),
      kind === "warning" ? 10_000 : 6_000,
    );
    return () => clearTimeout(timer);
  }, [visible, hovered, focused, kind]);
  if (!visible) return null;
  return (
    <div
      className={`app-toast ${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      {kind === "info" ? <Info size={18} /> : <CircleAlert size={18} />}
      <div>
        <b>
          {kind === "error"
            ? "Có lỗi xảy ra"
            : kind === "warning"
              ? "Tự trả lời đang dừng"
              : "Thông báo"}
        </b>
        <p>{message}</p>
      </div>
      <button
        aria-label="Đóng thông báo"
        onClick={() => {
          setVisible(false);
          onClose?.();
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function AppFeedback({
  snapshot,
  error,
  dismissError,
}: {
  snapshot: Snapshot;
  error: string;
  dismissError: () => void;
}) {
  const pauseReason = snapshot.paused
    ? messageText(snapshot.pauseReason ?? "")
    : "";
  const displayError = sameMessage(error, pauseReason)
    ? ""
    : messageText(error);
  const notice = messageText(snapshot.notice);
  const showNotice =
    notice &&
    !sameMessage(notice, pauseReason) &&
    !sameMessage(notice, displayError);
  return (
    <div className="app-toasts" aria-label="Thông báo ứng dụng">
      {showNotice && (
        <Toast key={`notice:${notice}`} message={notice} kind="info" />
      )}
      {pauseReason && (
        <Toast
          key={`pause:${pauseReason}`}
          message={pauseReason}
          kind="warning"
        />
      )}
      {displayError && (
        <Toast
          key={`error:${displayError}`}
          message={displayError}
          kind="error"
          onClose={dismissError}
        />
      )}
    </div>
  );
}
