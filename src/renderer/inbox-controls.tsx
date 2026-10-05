import React from "react";
import {
  CircleAlert,
  Pause,
  Play,
  Power,
  RefreshCw,
  Square,
} from "lucide-react";
import type { Command, Snapshot } from "../core/types.ts";
import { isAutoReplyEnabled } from "../core/auto-reply.ts";

export function InboxControls({
  snapshot,
  busy,
  run,
}: {
  snapshot: Snapshot;
  busy: boolean;
  run: (command: Command) => Promise<Snapshot | null>;
}) {
  const { accounts, conversations } = snapshot.data;
  const enabled = conversations.filter((c) =>
    isAutoReplyEnabled(c, accounts),
  ).length;
  const allEnabled =
    accounts.length > 0 && accounts.every((a) => a.autoDiscoverReply);
  return (
    <div
      className="inbox-controls"
      role="toolbar"
      aria-label="Tự trả lời toàn ứng dụng"
    >
      <div className="automation-summary">
        <div className="inbox-automation-state">
          <i className={!snapshot.paused && enabled ? "dot green" : "dot"} />
          <b>
            {snapshot.paused
              ? "Tự trả lời đang dừng"
              : enabled
                ? "Tự trả lời đang chạy"
                : "Chỉ đồng bộ"}
          </b>
          <span>
            {enabled}/{conversations.length} hội thoại ·{" "}
            {accounts.filter((a) => a.autoDiscoverReply).length}/
            {accounts.length} tài khoản bật mặc định
          </span>
        </div>
        {snapshot.paused && snapshot.pauseReason && (
          <small className="pause-reason">{snapshot.pauseReason}</small>
        )}
      </div>
      <div className="inbox-control-actions">
        <button
          className="primary"
          onClick={() =>
            void run({
              type:
                snapshot.paused && !busy
                  ? "automation.resume"
                  : "automation.pause",
            })
          }
        >
          {snapshot.paused ? (
            busy ? (
              <Square size={15} />
            ) : (
              <Play size={15} />
            )
          ) : (
            <Pause size={15} />
          )}
          {snapshot.paused ? (busy ? "Dừng xử lý" : "Tiếp tục") : "Tạm dừng"}
        </button>
        <button
          className="primary"
          disabled={
            busy || !accounts.length || (allEnabled && !snapshot.paused)
          }
          onClick={() => void run({ type: "automation.all", enabled: true })}
        >
          <Play size={15} /> Bật hệ thống
        </button>
        <button
          disabled={busy || !accounts.some((a) => a.autoDiscoverReply)}
          onClick={() => void run({ type: "automation.all", enabled: false })}
        >
          <Power size={15} /> Tắt hệ thống
        </button>
      </div>
    </div>
  );
}

export function InboxRows({
  snapshot,
  selected,
  select,
}: {
  snapshot: Snapshot;
  selected?: string;
  select: (id: string) => void;
}) {
  const { accounts, conversations, drafts } = snapshot.data;
  const rank = new Map(
    accounts.flatMap((a, index) =>
      (a.inboxOrder ?? []).map(
        (id, position) =>
          [`${a.id}:${id}`, index * 1_000_000 + position] as const,
      ),
    ),
  );
  const ordered = [...conversations].sort(
    (a, b) =>
      (rank.get(`${a.accountId}:${a.platformId}`) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(`${b.accountId}:${b.platformId}`) ?? Number.MAX_SAFE_INTEGER),
  );
  return (
    <>
      {ordered.map((c) => {
        const autoReply = isAutoReplyEnabled(c, accounts);
        const draft = drafts.find(
          (d) =>
            d.conversationId === c.id &&
            ["sending", "uncertain", "draft"].includes(d.status),
        );
        const held =
          draft?.status === "uncertain" ||
          (!draft?.automatic &&
            (draft?.review?.status === "held" ||
              draft?.review?.status === "unavailable"));
        const pending = autoReply && c.pendingIds.length > 0;
        const status =
          draft?.status === "uncertain"
            ? "Chưa rõ kết quả gửi · Cần kiểm tra"
            : held
              ? "Cần kiểm tra"
              : draft?.status === "sending"
                ? "Đang gửi"
                : pending && snapshot.paused
                  ? "Đang tạm dừng"
                  : pending && draft?.automatic && draft.sendAfter
                    ? `Chờ gửi ${new Date(draft.sendAfter).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                    : snapshot.replying?.includes(c.id)
                      ? "Đang soạn phản hồi"
                      : pending
                        ? "Chờ trả lời"
                        : autoReply
                          ? "Tự trả lời"
                          : "Chỉ theo dõi";
        return (
          <button
            key={c.id}
            className={`conversation${selected === c.id ? " selected" : ""}${c.inboxUnread ? " unread" : ""}`}
            onClick={() => select(c.id)}
          >
            <span className="avatar">{c.name.slice(0, 1)}</span>
            <div>
              <b>{c.name}</b>
              <small>
                {c.inboxPreview ||
                  c.messages.at(-1)?.text ||
                  "Chưa nạp lịch sử"}
              </small>
              {(held || pending || draft?.status === "sending") && (
                <span
                  className={
                    held ? "inbox-reply-status warning" : "inbox-reply-status"
                  }
                >
                  {status}
                </span>
              )}
            </div>
            <span
              className="inbox-row-status"
              title={status}
              aria-label={status}
            >
              {held ? (
                <CircleAlert size={14} />
              ) : pending || draft?.status === "sending" ? (
                <RefreshCw size={13} />
              ) : (
                <i className={autoReply ? "dot green" : "dot"} />
              )}
            </span>
          </button>
        );
      })}
    </>
  );
}
