import React, { useEffect, useRef, useState } from "react";
import type { Command, Conversation, Snapshot } from "../core/types.ts";
import { ContactProfilePanel } from "./contact-profile.tsx";
import { messageContent } from "../core/response-style.ts";
import { reviewBlocksAuto } from "../core/reply-quality.ts";
type Runner = (command: Command) => Promise<Snapshot | null>;
export type ComposerState = {
  text: string;
  draftId?: string;
  generating?: boolean;
};

export function ConversationPanel({
  c,
  snapshot,
  busy,
  run,
  open,
  composer,
  onComposerChange,
}: {
  c: Conversation;
  snapshot: Snapshot;
  busy: boolean;
  run: Runner;
  open: () => void;
  composer: ComposerState;
  onComposerChange: (value: ComposerState) => void;
}) {
  const [goal, setGoal] = useState("");
  const [sendAfterGenerate, setSendAfterGenerate] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyLimit, setHistoryLimit] = useState(50);
  useEffect(() => {
    setHistorySearch("");
    setHistoryLimit(50);
  }, [c.id]);
  const normalizeSearch = (text: string) =>
    text.normalize("NFC").toLocaleLowerCase("vi");
  const matches = historySearch.trim()
    ? c.messages.filter(
        (m) =>
          normalizeSearch(messageContent(m)).includes(
            normalizeSearch(historySearch.trim()),
          ) || m.id === historySearch.trim(),
      )
    : c.messages;
  const visibleMessages = matches.slice(-historyLimit);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const composerArea = useRef<HTMLFormElement>(null);
  const bodyArea = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const area = composerArea.current;
    if (!area || typeof ResizeObserver === "undefined") return;
    const update = () =>
      bodyArea.current?.style.setProperty(
        "--composer-height",
        `${area.getBoundingClientRect().height}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const [assistantOpen, setAssistantOpen] = useState(
    () => window.matchMedia("(min-width: 1101px)").matches,
  );
  const drafts = snapshot.data.drafts.filter((d) => d.conversationId === c.id);
  const activeDrafts = drafts
    .filter((d) => d.status !== "sent" && d.status !== "stale")
    .reverse();
  const archivedDrafts = drafts
    .filter((d) => d.status === "sent" || d.status === "stale")
    .reverse();
  const linkedDraft = drafts.find((d) => d.id === composer.draftId);
  const blockedSend = drafts.some(
    (d) => d.status === "sending" || d.status === "uncertain",
  );
  const staleDraft = Boolean(
    composer.draftId &&
    (!linkedDraft ||
      linkedDraft.status === "stale" ||
      linkedDraft.status === "sent"),
  );
  const readyDraft = activeDrafts.find(
    (d) => d.status === "draft" && (!d.automatic || reviewBlocksAuto(d.review)),
  );
  useEffect(() => {
    if (
      readyDraft &&
      !composer.generating &&
      (!composer.text.trim() ||
        (!composer.draftId && composer.text.trim() === readyDraft.text))
    )
      onComposerChange({ text: readyDraft.text, draftId: readyDraft.id });
  }, [readyDraft?.id, composer.text, composer.generating]);
  function useDraft(draft: Snapshot["data"]["drafts"][number]) {
    onComposerChange({ text: draft.text, draftId: draft.id });
    composerInput.current?.focus();
  }
  async function generateDraft() {
    if (busy || submitting.current || blockedSend) return;
    submitting.current = true;
    onComposerChange({ ...composer, generating: true });
    try {
      const result = await run({
        type: "draft.generate",
        conversationId: c.id,
        ...(goal.trim() ? { goal: goal.trim() } : {}),
      });
      const draft = result?.data.drafts
        .filter((d) => d.conversationId === c.id && d.status === "draft")
        .at(-1);
      if (!draft) {
        onComposerChange({ ...composer, generating: false });
        return;
      }
      useDraft(draft);
      if (sendAfterGenerate && !reviewBlocksAuto(draft.review)) {
        const sent = await run({
          type: "draft.send",
          draftId: draft.id,
          text: draft.text,
        });
        if (sent?.data.drafts.find((d) => d.id === draft.id)?.status === "sent")
          onComposerChange({ text: "" });
      }
    } finally {
      submitting.current = false;
    }
  }
  async function sendMessage() {
    if (
      busy ||
      submitting.current ||
      blockedSend ||
      staleDraft ||
      !composer.text.trim()
    )
      return;
    submitting.current = true;
    try {
      const result = await run(
        composer.draftId
          ? {
              type: "draft.send",
              draftId: composer.draftId,
              text: composer.text,
            }
          : {
              type: "conversation.send",
              conversationId: c.id,
              text: composer.text,
              basedOnId: c.messages.at(-1)?.id ?? null,
            },
      );
      if (result) {
        onComposerChange({ text: "" });
        followLatest.current = true;
      }
    } finally {
      submitting.current = false;
    }
  }
  async function clearComposer() {
    if (
      composer.draftId &&
      !(await run({ type: "draft.discard", draftId: composer.draftId }))
    )
      return;
    onComposerChange({ text: "" });
  }
  const historyArea = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const latestMessageId = c.messages.at(-1)?.id;
  useEffect(() => {
    if (followLatest.current && historyArea.current)
      historyArea.current.scrollTop = historyArea.current.scrollHeight;
  }, [latestMessageId]);
  const live =
    snapshot.live?.conversationId === c.id ? snapshot.live : undefined;
  return (
    <section className="conversation-panel">
      <div className="chat-header">
        <span className="avatar">{c.name.slice(0, 1)}</span>
        <div>
          <h2>{c.name}</h2>
          <small>
            {snapshot.data.accounts.find((a) => a.id === c.accountId)?.name} ·{" "}
            {c.messages.length} tin local
            {live && (
              <span
                className={`live-indicator${live.error ? " failed" : ""}`}
                title={
                  live.error ||
                  "Hội thoại đang xem được đồng bộ mỗi giây, kể cả khi tự trả lời tạm dừng."
                }
              >
                {live.error
                  ? " · Cập nhật bị chặn"
                  : live.updatedAt
                    ? " · Đang cập nhật"
                    : " · Đang kết nối…"}
              </span>
            )}
          </small>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void run({ type: "conversation.sync", conversationId: c.id })
          }
        >
          Nạp lịch sử
        </button>
        <button onClick={open}>Mở trình duyệt ↗</button>
        <button
          className={
            assistantOpen ? "assistant-toggle active" : "assistant-toggle"
          }
          aria-expanded={assistantOpen}
          aria-controls="conversation-assistant"
          onClick={() => setAssistantOpen(!assistantOpen)}
        >
          Trợ lý AI{activeDrafts.length > 0 ? ` · ${activeDrafts.length}` : ""}
        </button>
      </div>
      <div className="chat-options">
        <label className="toggle">
          <input
            type="checkbox"
            checked={c.autoReply}
            disabled={busy}
            onChange={(e) =>
              void run({
                type: "conversation.auto",
                conversationId: c.id,
                enabled: e.target.checked,
              })
            }
          />
          Tự động trả lời
        </label>
        {c.autoReply && snapshot.paused && (
          <button
            className="reply-state"
            title={snapshot.pauseReason}
            onClick={() => void run({ type: "automation.resume" })}
          >
            Tự trả lời tạm dừng · Tiếp tục
          </button>
        )}
        {c.autoReply &&
          !snapshot.paused &&
          !(snapshot.data.ai.tasks.reply || snapshot.data.ai.default) && (
            <span className="reply-state">Chưa chọn model trả lời</span>
          )}
        {!c.autoReply && (
          <span className="reply-state">Chỉ cập nhật, không tự trả lời</span>
        )}
        {c.diagnostics && (
          <details className="chat-diagnostics">
            <summary>Chi tiết bộ đọc</summary>
            <p role="status">{c.diagnostics}</p>
          </details>
        )}
      </div>
      <div className="conversation-body" ref={bodyArea}>
        <div className="chat-thread">
          <div className="history-tools">
            <input
              type="search"
              aria-label="Tìm trong lịch sử và bản chép âm thanh"
              placeholder="Tìm trong lịch sử và bản chép âm thanh…"
              value={historySearch}
              onChange={(e) => {
                setHistorySearch(e.target.value);
                setHistoryLimit(50);
                followLatest.current = false;
              }}
            />
            <small>
              {historySearch.trim()
                ? `${matches.length} tin khớp trong ${c.messages.length} tin đã lưu`
                : `${c.messages.length} tin đã lưu`}
            </small>
          </div>
          <div
            className="history"
            ref={historyArea}
            onScroll={() => {
              const area = historyArea.current;
              if (area)
                followLatest.current =
                  area.scrollHeight - area.scrollTop - area.clientHeight < 80;
            }}
          >
            {matches.length > historyLimit && (
              <button
                type="button"
                className="history-more"
                onClick={() => {
                  setHistoryLimit(historyLimit + 100);
                  followLatest.current = false;
                }}
              >
                Hiện thêm tin đã lưu
              </button>
            )}
            {historySearch.trim() && !matches.length && (
              <p className="empty compact">
                Không có tin khớp trong lịch sử đã lưu.
              </p>
            )}
            {visibleMessages.map((m) => (
              <div key={m.id} className={`message ${m.direction}`}>
                <div className="bubble">
                  {m.text}
                  {m.attachments?.map((a) => (
                    <div className="message-media" key={a.id}>
                      <strong>
                        {a.kind === "image"
                          ? "Nội dung ảnh"
                          : a.analysis
                            ? "Bản chép âm thanh · đã lưu"
                            : "Tin nhắn âm thanh"}
                      </strong>
                      <p>{a.analysis || a.error || "Chưa đọc nội dung tệp"}</p>
                    </div>
                  ))}
                </div>
                <small>
                  {m.direction === "outgoing"
                    ? "Bạn"
                    : m.direction === "system"
                      ? "Sự kiện"
                      : c.name}{" "}
                  ·{" "}
                  {m.timestamp
                    ? new Date(m.timestamp).toLocaleString("vi-VN")
                    : "Chưa rõ thời gian"}
                  {m.baseline ? " · lịch sử ban đầu" : ""}
                </small>
              </div>
            ))}
            {!c.messages.length && (
              <div className="empty compact">
                Chưa có lịch sử.
                <p>
                  Chọn Nạp lịch sử để lấy ngữ cảnh ban đầu. Tin lịch sử ban đầu
                  không được tự động trả lời.
                </p>
              </div>
            )}
          </div>
          <form
            className="chat-composer"
            ref={composerArea}
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
          >
            {linkedDraft?.review && (
              <ReviewNotice review={linkedDraft.review} />
            )}
            {composer.draftId && (
              <div className="composer-draft-label">
                Bản nháp · Có thể sửa trước khi gửi
              </div>
            )}
            {staleDraft && (
              <div className="composer-warning" role="status">
                Hội thoại đã đổi. Kiểm tra tin mới trước khi gửi.
                <button
                  type="button"
                  disabled={busy || blockedSend}
                  onClick={() => onComposerChange({ text: composer.text })}
                >
                  Dùng như tin nhắn mới
                </button>
              </div>
            )}
            {blockedSend && (
              <div className="composer-warning" role="status">
                Có tin đang gửi hoặc chưa rõ kết quả. Kiểm tra trong Trợ lý AI
                trước khi gửi tiếp.
                <button type="button" onClick={() => setAssistantOpen(true)}>
                  Kiểm tra kết quả
                </button>
              </div>
            )}
            <div className="composer-row">
              <textarea
                ref={composerInput}
                aria-label={`Tin nhắn cho ${c.name}`}
                placeholder={`Nhập tin nhắn cho ${c.name}…`}
                rows={3}
                maxLength={5000}
                value={composer.text}
                disabled={busy || blockedSend}
                onChange={(e) =>
                  onComposerChange({ ...composer, text: e.target.value })
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button
                className="primary"
                type="submit"
                disabled={
                  busy || blockedSend || staleDraft || !composer.text.trim()
                }
              >
                {busy ? "Đang xử lý…" : "Gửi"}
              </button>
            </div>
            <div className="composer-footer">
              <small>
                {composer.text.trim()
                  ? "Tự trả lời chờ bạn hoàn tất tin đang soạn"
                  : "Enter để gửi · Shift+Enter xuống dòng"}
              </small>
              <button
                type="button"
                disabled={
                  busy ||
                  blockedSend ||
                  Boolean(composer.text.trim() && !composer.draftId)
                }
                onClick={() => void generateDraft()}
              >
                Tạo nháp AI
              </button>
              {composer.text && (
                <button
                  type="button"
                  disabled={busy || blockedSend}
                  onClick={() => void clearComposer()}
                >
                  Xóa nội dung
                </button>
              )}
            </div>
          </form>
        </div>
        {assistantOpen && (
          <aside
            className="assistant-sidebar"
            id="conversation-assistant"
            aria-label="Trợ lý AI"
          >
            <div className="assistant-header">
              <h3>Trợ lý AI</h3>
              <button
                aria-label="Đóng sidebar trợ lý AI"
                title="Đóng sidebar trợ lý AI"
                onClick={() => setAssistantOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="assistant-content">
              <ContactProfilePanel
                key={JSON.stringify([
                  c.id,
                  c.responseStyle,
                  c.learnStyle,
                  c.relationshipContext,
                  c.conversationDirection,
                ])}
                c={c}
                snapshot={snapshot}
                busy={busy}
                run={run}
                showEvidence={(id) => {
                  setHistorySearch(id);
                  setHistoryLimit(50);
                  followLatest.current = false;
                }}
              />
              {c.messages.some((m) =>
                m.attachments?.some((a) => !a.analysis),
              ) && (
                <div className="media-review">
                  <p>
                    Ảnh/âm thanh chưa được đọc đầy đủ. Kiểm tra model trong Cấu
                    hình AI nếu cần.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({ type: "media.retry", conversationId: c.id })
                    }
                  >
                    Đọc lại tệp
                  </button>
                </div>
              )}
              <div className="assistant-compose">
                <details className="assistant-goal">
                  <summary>
                    Mục tiêu mở đầu{goal.trim() ? " · Đã đặt" : " (tùy chọn)"}
                  </summary>
                  <textarea
                    aria-label="Mục tiêu chủ động bắt chuyện"
                    rows={3}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Bạn muốn chủ động trao đổi điều gì?"
                  />
                </details>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    blockedSend ||
                    Boolean(composer.text.trim() && !composer.draftId)
                  }
                  onClick={() => void generateDraft()}
                >
                  {busy
                    ? "Đang xử lý…"
                    : goal.trim()
                      ? "Tạo lời mở đầu"
                      : "Tạo bản nháp"}
                </button>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={sendAfterGenerate}
                    disabled={busy || blockedSend}
                    onChange={(e) => setSendAfterGenerate(e.target.checked)}
                  />
                  Gửi ngay sau khi tạo nháp
                </label>
              </div>
              <div className="assistant-drafts">
                <h3>
                  Cần xử lý
                  {activeDrafts.length > 0 ? ` · ${activeDrafts.length}` : ""}
                </h3>
                {activeDrafts.length ? (
                  activeDrafts.map((d) => (
                    <DraftEditor
                      key={d.id}
                      draft={d}
                      run={run}
                      disabled={busy}
                      useDraft={() => useDraft(d)}
                    />
                  ))
                ) : (
                  <p className="assistant-empty">Chưa có bản nháp cần xử lý.</p>
                )}
              </div>
              {archivedDrafts.length > 0 && (
                <details className="assistant-archive">
                  <summary>Lịch sử AI · {archivedDrafts.length}</summary>
                  {archivedDrafts.slice(0, 5).map((d) => (
                    <DraftEditor
                      key={d.id}
                      draft={d}
                      run={run}
                      disabled={busy}
                    />
                  ))}
                  {archivedDrafts.length > 5 && (
                    <p className="footnote">Hiển thị 5 bản gần nhất.</p>
                  )}
                </details>
              )}
              {c.summary.text && (
                <details className="summary">
                  <summary>
                    Ngữ cảnh AI · {c.summary.coveredIds.length} tin
                  </summary>
                  <p className="pre">{c.summary.text}</p>
                </details>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
function DraftEditor({
  draft,
  run,
  disabled,
  useDraft,
}: {
  draft: Snapshot["data"]["drafts"][number];
  run: Runner;
  disabled: boolean;
  useDraft?: () => void;
}) {
  return (
    <div className="draft">
      {draft.review && <ReviewNotice review={draft.review} />}
      <span className="chip">
        {
          {
            draft: "Bản nháp",
            sending: "Đang gửi",
            sent: "Đã gửi",
            uncertain: "Chưa rõ kết quả — kiểm tra trình duyệt",
            stale: "Hết hiệu lực",
          }[draft.status]
        }
      </span>
      {draft.sendAfter && draft.status === "draft" && (
        <p role="status">
          Chờ gửi lúc {new Date(draft.sendAfter).toLocaleTimeString("vi-VN")}.
          Soạn tin hoặc tạm dừng để hủy thời gian chờ.
        </p>
      )}
      {draft.status === "draft" ? (
        <>
          <p className="pre">{draft.text}</p>
          <button
            className="primary"
            disabled={disabled || !useDraft}
            onClick={useDraft}
          >
            Đưa vào ô soạn
          </button>
        </>
      ) : (
        <p className="pre">{draft.text}</p>
      )}
      {draft.status === "uncertain" && (
        <>
          <p className="footnote">
            Sau khi kiểm tra hội thoại thực tế, ghi nhận kết quả dưới đây. Không
            có nút gửi lại tự động.
          </p>
          <div className="inline">
            <button
              disabled={disabled}
              onClick={() =>
                void run({
                  type: "draft.resolve",
                  draftId: draft.id,
                  outcome: "sent",
                })
              }
            >
              Tôi xác nhận đã gửi
            </button>
            <button
              disabled={disabled}
              onClick={() =>
                void run({
                  type: "draft.resolve",
                  draftId: draft.id,
                  outcome: "stale",
                })
              }
            >
              Chưa gửi, bỏ nháp
            </button>
          </div>
        </>
      )}
    </div>
  );
}
function ReviewNotice({
  review,
}: {
  review: NonNullable<Snapshot["data"]["drafts"][number]["review"]>;
}) {
  const labels = {
    approved: "Đã kiểm tra độ tự nhiên",
    revised: "Đã chỉnh và kiểm tra lại",
    held: "Cần bạn xem lại · không tự gửi",
    unavailable: "Chưa kiểm tra được · không tự gửi",
    skipped: "Chưa kiểm tra bằng model khác",
  };
  return (
    <details className={`reply-review ${review.status}`}>
      <summary>{labels[review.status]}</summary>
      {review.issues.map((issue, i) => (
        <p key={i}>{issue}</p>
      ))}
      {review.model && <small>Model kiểm tra: {review.model.modelId}</small>}
      {review.originalText && (
        <details>
          <summary>Bản nháp trước khi sửa</summary>
          <p className="pre">{review.originalText}</p>
        </details>
      )}
    </details>
  );
}
