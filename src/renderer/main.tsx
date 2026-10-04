import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Bridge,
  Command,
  DOMProfile,
  Platform,
  Snapshot,
} from "../core/types.ts";
import "./styles.css";
import { AISettings } from "./ai-settings.tsx";
import { AccountSettings } from "./account-settings.tsx";
import { KnowledgeSettings } from "./knowledge-settings.tsx";
import { InboxControls, InboxRows } from "./inbox-controls.tsx";
import {
  ConversationPanel,
  type ComposerState,
} from "./conversation-panel.tsx";
declare global {
  interface Window {
    masterChat: Bridge;
  }
}
const PROFILE: DOMProfile = {
  version: 1,
  platform: "messenger-personal",
  verified: false,
  threadSelector: "[data-thread-id]",
  threadIdAttribute: "data-thread-id",
  messageSelector: "[data-message-id]",
  messageIdAttribute: "data-message-id",
  textSelector: ".message-text",
  directionAttribute: "data-direction",
  incomingValue: "incoming",
  outgoingValue: "outgoing",
  timestampAttribute: "data-timestamp",
  composerSelector: '[contenteditable="true"]',
  sendSelector: "[data-send]",
  listSelector: "[data-inbox]",
  linkSelector: "a[href]",
};
const MENU = [
  ["inbox", "Hội thoại", "↗"],
  ["browser", "Trình duyệt", "▣"],
  ["accounts", "Tài khoản", "◎"],
  ["ai", "Cấu hình AI", "✦"],
  ["knowledge", "Tri thức", "◇"],
  ["profile", "Bộ đọc trình duyệt", "⌘"],
] as const;
function App() {
  const [composers, setComposers] = useState<Record<string, ComposerState>>({});
  const composerCache = useRef<Record<string, ComposerState>>({});
  function updateComposer(id: string, value: ComposerState) {
    const previous = composerCache.current[id];
    composerCache.current[id] = value;
    setComposers({ ...composerCache.current });
    const active = Boolean(value.text.trim() || value.generating);
    if (active !== Boolean(previous?.text.trim() || previous?.generating))
      void window.masterChat
        .command({ type: "conversation.composing", conversationId: id, active })
        .catch((e) => {
          setError(String(e.message));
          void window.masterChat.command({ type: "automation.pause" });
        });
  }
  useEffect(
    () => () => {
      for (const [id, value] of Object.entries(composerCache.current))
        if (value.text.trim() || value.generating)
          void window.masterChat
            .command({
              type: "conversation.composing",
              conversationId: id,
              active: false,
            })
            .catch(() => {});
    },
    [],
  );
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [page, setPage] = useState<string>("inbox"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [activityOpen, setActivityOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [activeTab, setActiveTab] = useState("");
  const browserArea = useRef<HTMLDivElement>(null);
  const watchedId =
    page === "inbox"
      ? (snapshot?.data.conversations.find((c) => c.id === selected)?.id ??
        snapshot?.data.conversations[0]?.id ??
        null)
      : null;
  useEffect(() => {
    void window.masterChat
      .command({ type: "conversation.watch", conversationId: watchedId })
      .catch((e) => setError(String(e.message)));
    return () => {
      void window.masterChat
        .command({ type: "conversation.watch", conversationId: null })
        .catch(() => {});
    };
  }, [watchedId]);
  const load = () =>
    window.masterChat
      .snapshot()
      .then(setSnapshot)
      .catch((e) => setError(String(e.message)));
  useEffect(() => {
    void load();
    return window.masterChat.onChange(() => void load());
  }, []);
  useEffect(() => {
    if (
      snapshot?.tabs.length &&
      !snapshot.tabs.some((t) => t.id === activeTab)
    ) {
      const next = snapshot.tabs.find((t) => !t.detached) || snapshot.tabs[0];
      setActiveTab(next.id);
      if (!next.detached)
        void window.masterChat
          .command({ type: "browser.select", tabId: next.id })
          .catch(() => {});
    }
  }, [snapshot?.tabs, activeTab]);
  useEffect(() => {
    const update = () => {
      const rect = browserArea.current?.getBoundingClientRect();
      void window.masterChat.bounds(
        page === "browser" && rect
          ? {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.max(0, Math.floor(rect.width)),
              height: Math.max(0, Math.floor(rect.height)),
            }
          : null,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (browserArea.current) observer.observe(browserArea.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [page, snapshot?.tabs.length]);
  async function run(command: Command) {
    setBusy(true);
    setError("");
    try {
      const s = await window.masterChat.command(command);
      setSnapshot(s);
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (!snapshot)
    return (
      <div className="boot">
        <b>Master Chat</b>
        <p>{error || "Đang mở dữ liệu được bảo vệ…"}</p>
      </div>
    );
  const { data } = snapshot,
    conversation =
      data.conversations.find((c) => c.id === selected) ||
      data.conversations[0];
  const opens = async (accountId: string, url?: string) => {
    setPage("browser");
    const s = await run({ type: "browser.open", accountId, url });
    if (s) {
      setActiveTab(s.tabs.at(-1)?.id || "");
      setPage("browser");
    }
  };
  return (
    <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <span>M</span>
            <div>Master Chat</div>
          </div>
          <button
            className="sidebar-toggle"
            title={sidebarCollapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
            aria-label={
              sidebarCollapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"
            }
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M9 4v16" />
              <path d={sidebarCollapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"} />
            </svg>
          </button>
        </div>
        <nav>
          {MENU.map(([key, label, icon]) => (
            <button
              className={page === key ? "nav active" : "nav"}
              key={key}
              title={label}
              aria-label={label}
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
            >
              <span>{icon}</span>
              <span className="nav-label">{label}</span>
              {key === "inbox" && <i>{data.conversations.length}</i>}
            </button>
          ))}
        </nav>
        <div
          className="privacy"
          title="Dữ liệu lưu trên thiết bị, vault mã hóa, không đồng bộ cloud"
        >
          <span>◉</span>
          <div>
            <b>Dữ liệu trên thiết bị</b>
            <small>
              {data.accounts.length} tài khoản ·{" "}
              {data.conversations.reduce((n, c) => n + c.messages.length, 0)}{" "}
              tin đã lưu
            </small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <div className="app-toolbar">
          <InboxControls snapshot={snapshot} busy={busy} run={run} />
        </div>
        <div className="activity-bar">
          <button
            className="activity-toggle"
            aria-expanded={activityOpen}
            onClick={() => setActivityOpen(!activityOpen)}
            title={snapshot.notice || "Hoạt động gần đây"}
          >
            <span>{snapshot.notice || "Hoạt động gần đây"}</span>
            <span aria-hidden="true">{activityOpen ? "⌃" : "⌄"}</span>
          </button>
        </div>
        {activityOpen && (
          <div className="activity-panel" role="status">
            <p>{snapshot.notice}</p>
            <small>
              {data.enabledAt
                ? `Mốc bắt đầu: ${new Date(data.enabledAt).toLocaleString("vi-VN")}`
                : "Chưa thiết lập mốc bắt đầu"}
            </small>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        <main
          className={
            page === "inbox" || page === "browser"
              ? "content-main"
              : "settings-main"
          }
        >
          {page === "inbox" && (
            <>
              <details
                className="inbox-management"
                open={data.accounts.length === 0 ? true : undefined}
              >
                <summary>
                  Quản lý inbox{" "}
                  <small>
                    {data.accounts.length} tài khoản
                    {snapshot.monitors?.some((m) => m.error)
                      ? " · Có lỗi cần kiểm tra"
                      : ""}
                  </small>
                </summary>
                <div className="monitor-content">
                  <button onClick={() => setPage("accounts")}>
                    + Thêm tài khoản
                  </button>
                  <h3>Theo dõi inbox Messenger</h3>
                  <p>
                    Mở inbox và đăng nhập trong ứng dụng, rồi quét để tìm hội
                    thoại. Khi Tiếp tục, hệ thống tự quét định kỳ; chưa đọc chỉ
                    dùng để ưu tiên kiểm tra.
                  </p>
                  {data.accounts.map((a) => {
                    const m = snapshot.monitors?.find(
                      (m) => m.accountId === a.id,
                    );
                    return (
                      <div key={a.id}>
                        <div className="inline">
                          <b>{a.name}</b>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run({ type: "inbox.sync", accountId: a.id })
                            }
                          >
                            Quét inbox
                          </button>
                        </div>
                        <small>
                          {m
                            ? `${m.status} · ${m.threadCount} hội thoại · ${m.scannedAt ? new Date(m.scannedAt).toLocaleTimeString("vi-VN") : "chưa hoàn tất"} · ${m.coverage === "partial" ? "Còn danh sách chưa quét" : "Đã quét phần danh sách tải được"}`
                            : "Chưa quét"}
                        </small>
                        {m?.error && <p role="status">{m.error}</p>}
                        {a.monitorStartedAt && (
                          <p className="footnote">
                            Mốc theo dõi tài khoản:{" "}
                            {new Date(a.monitorStartedAt).toLocaleString(
                              "vi-VN",
                            )}
                            . Tin trước mốc này không tự trả lời.
                          </p>
                        )}
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(a.autoDiscoverReply)}
                            disabled={busy}
                            onChange={(e) =>
                              void run({
                                type: "account.discovery",
                                accountId: a.id,
                                enabled: e.target.checked,
                              })
                            }
                          />
                          Cho phép tự trả lời các hội thoại được phát hiện từ
                          lần quét tiếp theo
                        </label>
                        <div className="inline account-auto-actions">
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run({
                                type: "account.auto",
                                accountId: a.id,
                                enabled: true,
                              })
                            }
                          >
                            Bật và chạy tài khoản
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run({
                                type: "account.auto",
                                accountId: a.id,
                                enabled: false,
                              })
                            }
                          >
                            Tắt toàn bộ
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <small>
                    Quét có giới hạn; yêu cầu tin nhắn, spam và kho lưu trữ chưa
                    được bao phủ. Nếu bật quyền ở trên, các hội thoại mới tìm
                    thấy được bật auto; hội thoại đang có giữ lựa chọn riêng.
                  </small>
                </div>
              </details>
              <div className="inbox-layout">
                <section className="conversation-list">
                  <div className="list-label">
                    HỘI THOẠI ĐÃ ĐĂNG KÝ{" "}
                    <span>{data.conversations.length}</span>
                  </div>
                  <div className="conversation-items">
                    {data.conversations.length ? (
                      <InboxRows
                        snapshot={snapshot}
                        selected={conversation?.id}
                        select={setSelected}
                      />
                    ) : (
                      <div className="empty compact">
                        Chưa có hội thoại.
                        <p>
                          Mở inbox tài khoản rồi chọn Quét inbox, hoặc thêm URL
                          cuộc trò chuyện.
                        </p>
                      </div>
                    )}
                  </div>
                  <ConversationForm
                    accounts={data.accounts}
                    busy={busy}
                    run={run}
                  />
                </section>
                {conversation ? (
                  <ConversationPanel
                    key={conversation.id}
                    c={conversation}
                    snapshot={snapshot}
                    busy={busy}
                    run={run}
                    composer={composers[conversation.id] || { text: "" }}
                    onComposerChange={(value) =>
                      updateComposer(conversation.id, value)
                    }
                    open={() =>
                      void opens(conversation.accountId, conversation.url)
                    }
                  />
                ) : (
                  <section className="empty large">
                    <div className="empty-icon">✦</div>
                    <h2>Sẵn sàng trò chuyện, theo cách của bạn</h2>
                    <p>
                      Kết nối Messenger cá nhân.
                      <br />
                      Hội thoại mới mặc định chỉ theo dõi.
                    </p>
                    <button
                      className="primary"
                      onClick={() => setPage("accounts")}
                    >
                      Thiết lập tài khoản đầu tiên
                    </button>
                    <div className="features">
                      <span>◎ Trình duyệt thật</span>
                      <span>◇ Ngữ cảnh local</span>
                      <span>Ⅱ Dừng bất cứ lúc nào</span>
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
          {page === "browser" && (
            <div className="browser-workspace">
              <div className="browser-toolbar">
                <div className="tabs">
                  {snapshot.tabs.map((t) => (
                    <button
                      key={t.id}
                      className={t.id === activeTab ? "tab active" : "tab"}
                      onClick={() => {
                        setActiveTab(t.id);
                        void run({ type: "browser.select", tabId: t.id });
                      }}
                    >
                      {t.detached ? "↗ " : "▣ "}
                      {t.title}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          void run({ type: "browser.close", tabId: t.id });
                        }}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Mở inbox tài khoản"
                  value=""
                  onChange={(e) => void opens(e.target.value)}
                >
                  <option value="">+ Mở inbox</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              {snapshot.tabs.length ? (
                <>
                  <div className="address">
                    <span>⌁</span>
                    <code>
                      {snapshot.tabs.find((t) => t.id === activeTab)?.url ||
                        "Chọn một tab"}
                    </code>
                    {(
                      [
                        "browser.reload",
                        "browser.login",
                        "browser.inspect",
                        "browser.detach",
                      ] as const
                    ).map((type, i) => (
                      <button
                        disabled={!activeTab || busy}
                        key={type}
                        onClick={() => void run({ type, tabId: activeTab })}
                      >
                        {
                          [
                            "Tải lại",
                            "Đăng nhập lại",
                            "Đọc thử",
                            "Tách cửa sổ",
                          ][i]
                        }
                      </button>
                    ))}
                  </div>
                  <div className="browser-login-status">
                    {snapshot.tabs.find((t) => t.id === activeTab)?.status}
                  </div>
                  <div ref={browserArea} className="browser-area" />
                  <p className="footnote">
                    Thao tác bàn phím trong trình duyệt sẽ tạm dừng tự động.
                    Kiểm tra đúng hội thoại và cấu hình model trước khi bật tự
                    trả lời.
                  </p>
                </>
              ) : (
                <div className="empty large">
                  <div className="empty-icon">▣</div>
                  <h2>Mở một inbox để bắt đầu</h2>
                  <p>
                    Chọn tài khoản ở phía trên. Phiên đăng nhập được giữ trong
                    bộ nhớ và cookies được mã hóa trong vault.
                  </p>
                </div>
              )}
            </div>
          )}
          {page === "accounts" && (
            <AccountSettings
              accounts={data.accounts}
              tabs={snapshot.tabs}
              busy={busy}
              run={run}
              open={(id) => void opens(id)}
            />
          )}
          {page === "ai" && (
            <AISettings
              config={data.ai}
              response={data.response}
              busy={busy}
              run={run}
            />
          )}
          {page === "knowledge" && (
            <KnowledgeSettings
              sources={data.knowledge}
              accounts={data.accounts}
              busy={busy}
              run={run}
              importDocuments={window.masterChat.importDocuments}
            />
          )}
          {page === "profile" && (
            <section className="card narrow">
              <h2>Bộ đọc Messenger</h2>
              <p>
                Bộ đọc tích hợp dùng nhãn tin nhắn, ô soạn và nút gửi trên
                Messenger tiếng Việt/Anh. Không cần nhập selector. Tin thiếu
                ngày giờ rõ ràng chỉ lưu làm ngữ cảnh; thời gian đến phút sẽ bỏ
                qua phút chứa mốc bắt đầu. Tin trùng hoàn toàn trong cùng phút
                sẽ chặn hội thoại để tránh nhầm.
              </p>
              <p>
                Đang dùng:{" "}
                {data.profiles["messenger-personal"]
                  ? "Profile tùy chỉnh"
                  : "Messenger tích hợp"}
                .
              </p>
              <button
                disabled={busy}
                onClick={() => void run({ type: "profile.reset" })}
              >
                Dùng bộ đọc Messenger tích hợp
              </button>
              <details>
                <summary>Profile DOM nâng cao</summary>
                <p>
                  Mẫu dưới đây dành cho fixture; chỉ thay bộ đọc tích hợp khi
                  bạn đã kiểm chứng cấu trúc khác.
                </p>
                <ProfileForm busy={busy} run={run} />
              </details>
              <div className="hint">
                Đặt verified=false để đọc thử. Chỉ đặt true sau khi kiểm chứng
                ID, hướng tin, timestamp và nút gửi trên đúng tab. Ứng dụng kiểm
                tra dữ liệu trước khi chấp nhận.
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
type Runner = (command: Command) => Promise<Snapshot | null>;

function ConversationForm({
  accounts,
  busy,
  run,
}: {
  accounts: Snapshot["data"]["accounts"];
  busy: boolean;
  run: Runner;
}) {
  const [accountId, setAccountId] = useState(""),
    [name, setName] = useState(""),
    [url, setUrl] = useState("");
  return (
    <details className="add-conversation">
      <summary>+ Đăng ký hội thoại</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ type: "conversation.add", accountId, name, url })) {
            setName("");
            setUrl("");
          }
        }}
      >
        <select
          required
          aria-label="Tài khoản hội thoại"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Chọn tài khoản</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input
          required
          aria-label="Tên đối tượng"
          placeholder="Tên đối tượng"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          required
          type="url"
          aria-label="URL hội thoại"
          placeholder="URL thread đầy đủ"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button disabled={busy}>Thêm hội thoại</button>
      </form>
    </details>
  );
}
function ProfileForm({ busy, run }: { busy: boolean; run: Runner }) {
  const [text, setText] = useState(JSON.stringify(PROFILE, null, 2)),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const profile = JSON.parse(text);
          setError("");
          void run({ type: "profile.save", profile });
        } catch {
          setError("JSON chưa hợp lệ.");
        }
      }}
    >
      <label>
        Profile JSON
        <textarea
          rows={20}
          className="code"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        Lưu và kiểm tra profile
      </button>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
