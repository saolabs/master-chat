import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Bridge,
  Command,
  Conversation,
  DOMProfile,
  Platform,
  Snapshot,
} from "../core/types.ts";
import "./styles.css";
import { AISettings } from "./ai-settings.tsx";
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
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [page, setPage] = useState<string>("inbox"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [activityOpen, setActivityOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [activeTab, setActiveTab] = useState(""),
    [editingAccount, setEditingAccount] = useState<string | null>(null);
  const browserArea = useRef<HTMLDivElement>(null);
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
          {sidebarCollapsed ? "›" : "‹"}
        </button>
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
          <button
            className="activity-toggle"
            aria-expanded={activityOpen}
            onClick={() => setActivityOpen(!activityOpen)}
            title={snapshot.notice || "Hoạt động gần đây"}
          >
            <span>{snapshot.notice || "Hoạt động gần đây"}</span>
            <span aria-hidden="true">{activityOpen ? "⌃" : "⌄"}</span>
          </button>
          <div className="controls">
            <span
              className={`status ${snapshot.paused ? "paused" : "running"}`}
            >
              <i />
              {snapshot.paused ? "Đã tạm dừng" : "Đang theo dõi"}
            </span>
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
              {snapshot.paused
                ? busy
                  ? "■ Dừng xử lý"
                  : "▶ Tiếp tục"
                : "Ⅱ Tạm dừng"}
            </button>
          </div>
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
                      data.conversations.map((c) => (
                        <button
                          key={c.id}
                          className={
                            conversation?.id === c.id
                              ? "conversation selected"
                              : "conversation"
                          }
                          onClick={() => setSelected(c.id)}
                        >
                          <span className="avatar">{c.name.slice(0, 1)}</span>
                          <div>
                            <b>{c.name}</b>
                            <small>
                              {c.messages.at(-1)?.text || "Chưa nạp lịch sử"}
                            </small>
                          </div>
                          <i className={c.autoReply ? "dot green" : "dot"} />
                        </button>
                      ))
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
            <div className="settings-grid">
              <section className="card">
                <h2>
                  {editingAccount
                    ? "Sửa thông tin đăng nhập"
                    : "Kết nối tài khoản"}
                </h2>
                <p>
                  Mở Facebook trong Chromium của ứng dụng. Khi cần xác minh, bạn
                  hoàn tất trực tiếp trên trình duyệt.
                </p>
                <AccountForm
                  key={editingAccount ?? "new"}
                  account={data.accounts.find((a) => a.id === editingAccount)}
                  run={run}
                  busy={busy}
                  done={() => setEditingAccount(null)}
                />
                {editingAccount && (
                  <button onClick={() => setEditingAccount(null)}>
                    Hủy chỉnh sửa
                  </button>
                )}
              </section>
              <section>
                <h2>Tài khoản của bạn</h2>
                {data.accounts.length ? (
                  data.accounts.map((a) => (
                    <div className="card account" key={a.id}>
                      <span className="avatar">{a.name.slice(0, 1)}</span>
                      <div>
                        <h3>{a.name}</h3>
                        <p>Messenger cá nhân</p>
                        <small>
                          {a.username || "Đăng nhập thủ công"} ·{" "}
                          {a.hasPassword
                            ? "Đã lưu mật khẩu"
                            : "Chưa lưu mật khẩu"}
                        </small>
                        <p>
                          {a.hasRecoveryPin
                            ? `Đã lưu PIN · ${a.autoRestorePin ? "Tự nhập bật" : "Tự nhập tắt"}`
                            : "Chưa lưu PIN"}
                        </p>
                        <p>
                          {
                            snapshot.tabs.find((t) => t.accountId === a.id)
                              ?.status
                          }
                        </p>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => setEditingAccount(a.id)}
                      >
                        Sửa
                      </button>
                      <button disabled={busy} onClick={() => void opens(a.id)}>
                        Mở inbox ↗
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty compact">
                    Chưa có tài khoản được lưu.
                  </div>
                )}
              </section>
            </div>
          )}
          {page === "ai" && (
            <AISettings config={data.ai} busy={busy} run={run} />
          )}
          {page === "knowledge" && (
            <div className="settings-grid">
              <section className="card">
                <h2>Thêm tri thức riêng</h2>
                <p>
                  Nguồn local giúp AI trả lời dựa trên thông tin của bạn. Bản
                  đầu truy xuất từ khóa theo phạm vi tài khoản.
                </p>
                <KnowledgeForm accounts={data.accounts} busy={busy} run={run} />
              </section>
              <section>
                <h2>Kho tri thức</h2>
                {data.knowledge.map((k) => (
                  <article className="card" key={k.id}>
                    <h3>{k.title}</h3>
                    <p className="pre">{k.text.slice(0, 600)}</p>
                    <small>
                      {data.accounts.find((a) => a.id === k.accountId)?.name ||
                        "Dùng chung"}
                    </small>
                  </article>
                ))}
                {!data.knowledge.length && (
                  <div className="empty compact">Chưa có nguồn tri thức.</div>
                )}
              </section>
            </div>
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
function AccountForm({
  run,
  busy,
  account,
  done,
}: {
  run: Runner;
  busy: boolean;
  account?: Snapshot["data"]["accounts"][number];
  done: () => void;
}) {
  const [name, setName] = useState(account?.name ?? ""),
    [username, setUsername] = useState(account?.username ?? ""),
    [password, setPassword] = useState(""),
    [recoveryPin, setRecoveryPin] = useState(""),
    [clearRecoveryPin, setClearRecoveryPin] = useState(false),
    [autoRestorePin, setAutoRestorePin] = useState(
      Boolean(account?.autoRestorePin),
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await run({
            type: "account.save",
            ...(account ? { id: account.id } : {}),
            name,
            platform: "messenger-personal",
            username,
            password,
            recoveryPin,
            clearRecoveryPin,
            autoRestorePin,
          })
        ) {
          setName("");
          setUsername("");
          setPassword("");
          setRecoveryPin("");
          setClearRecoveryPin(false);
          setAutoRestorePin(false);
          done();
        }
      }}
    >
      <label>
        Tên tài khoản
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tài khoản cá nhân của tôi"
        />
      </label>
      <label>
        Nền tảng
        <input disabled value="Messenger cá nhân" />
      </label>
      <label>
        Email hoặc số điện thoại
        <input
          value={username}
          autoComplete="off"
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Để trống để đăng nhập thủ công"
        />
      </label>
      <label>
        Mật khẩu
        <input
          type="password"
          value={password}
          placeholder={
            account?.hasPassword
              ? "Để trống để giữ mật khẩu đã lưu"
              : "Mật khẩu để đăng nhập tự động"
          }
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        PIN khôi phục Messenger
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="new-password"
          value={recoveryPin}
          disabled={clearRecoveryPin}
          placeholder={
            account?.hasRecoveryPin
              ? "Để trống để giữ PIN đã lưu"
              : "PIN 6 chữ số (không bắt buộc)"
          }
          onChange={(e) => setRecoveryPin(e.target.value)}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={autoRestorePin}
          disabled={
            clearRecoveryPin || (!account?.hasRecoveryPin && !recoveryPin)
          }
          onChange={(e) => setAutoRestorePin(e.target.checked)}
        />
        Tự nhập PIN khi Messenger yêu cầu khôi phục lịch sử
      </label>
      {account?.hasRecoveryPin && (
        <label className="check">
          <input
            type="checkbox"
            checked={clearRecoveryPin}
            onChange={(e) => {
              setClearRecoveryPin(e.target.checked);
              if (e.target.checked) {
                setRecoveryPin("");
                setAutoRestorePin(false);
              }
            }}
          />
          Xóa PIN đã lưu
        </label>
      )}
      {account?.pinAutoFillBlocked && (
        <p role="status" className="footnote">
          Lần thử PIN trước chưa được xác nhận thành công. Kiểm tra Messenger
          hoặc nhập lại PIN và lưu để thử lại.
        </p>
      )}
      <p className="footnote">
        PIN được mã hóa trong vault trên máy. Chỉ cung cấp cho hộp thoại khôi
        phục của Messenger khi bạn bật tự nhập; không gửi cho AI hay dịch vụ
        khác.
      </p>
      <button className="primary" disabled={busy}>
        {account ? "Cập nhật tài khoản" : "Lưu tài khoản"}
      </button>
      <p className="footnote">
        Thông tin đăng nhập chỉ dùng cho form Facebook. Không gửi tới AI.
      </p>
    </form>
  );
}
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
function ConversationPanel({
  c,
  snapshot,
  busy,
  run,
  open,
}: {
  c: Conversation;
  snapshot: Snapshot;
  busy: boolean;
  run: Runner;
  open: () => void;
}) {
  const [goal, setGoal] = useState("");
  return (
    <section className="conversation-panel">
      <div className="chat-header">
        <span className="avatar">{c.name.slice(0, 1)}</span>
        <div>
          <h2>{c.name}</h2>
          <small>
            {snapshot.data.accounts.find((a) => a.id === c.accountId)?.name} ·{" "}
            {c.messages.length} tin local
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
        {c.diagnostics && (
          <details className="chat-diagnostics">
            <summary>Chi tiết bộ đọc</summary>
            <p role="status">{c.diagnostics}</p>
          </details>
        )}
      </div>
      <div className="history">
        {c.summary.text && (
          <details className="summary">
            <summary>
              ◇ Ngữ cảnh đã tóm tắt · {c.summary.coveredIds.length} tin
            </summary>
            <p className="pre">{c.summary.text}</p>
          </details>
        )}
        {c.messages.slice(-50).map((m) => (
          <div key={m.id} className={`message ${m.direction}`}>
            <div className="bubble">{m.text}</div>
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
      <div className="draft-area">
        <div className="inline">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Mục tiêu chủ động bắt chuyện (không bắt buộc)"
          />
          <button
            disabled={busy}
            onClick={() =>
              void run({
                type: "draft.generate",
                conversationId: c.id,
                ...(goal.trim() ? { goal: goal.trim() } : {}),
              })
            }
          >
            {busy
              ? "Đang xử lý…"
              : goal.trim()
                ? "Tạo lời mở đầu"
                : "Tạo bản nháp"}
          </button>
        </div>
        {snapshot.data.drafts
          .filter((d) => d.conversationId === c.id)
          .slice(-5)
          .reverse()
          .map((d) => (
            <DraftEditor key={d.id} draft={d} run={run} disabled={busy} />
          ))}
      </div>
    </section>
  );
}
function DraftEditor({
  draft,
  run,
  disabled,
}: {
  draft: Snapshot["data"]["drafts"][number];
  run: Runner;
  disabled: boolean;
}) {
  const [text, setText] = useState(draft.text);
  return (
    <div className="draft">
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
      {draft.status === "draft" ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="primary"
            disabled={disabled || !text.trim()}
            onClick={() =>
              void run({ type: "draft.send", draftId: draft.id, text })
            }
          >
            Gửi bản nháp này
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
function KnowledgeForm({
  accounts,
  busy,
  run,
}: {
  accounts: Snapshot["data"]["accounts"];
  busy: boolean;
  run: Runner;
}) {
  const [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [accountId, setAccountId] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await run({
            type: "knowledge.add",
            title,
            text,
            accountId: accountId || null,
          })
        ) {
          setTitle("");
          setText("");
        }
      }}
    >
      <label>
        Tên nguồn
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Phạm vi
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Dùng chung các tài khoản</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nội dung
        <textarea
          required
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Thông tin, tài liệu và cách trả lời bạn muốn AI tham khảo…"
        />
      </label>
      <button className="primary" disabled={busy}>
        Lưu tri thức
      </button>
    </form>
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
