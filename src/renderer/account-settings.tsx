import React, { useState } from "react";
import type { Command, Snapshot } from "../core/types.ts";
type Runner = (command: Command) => Promise<Snapshot | null>;
export function AccountSettings({
  accounts,
  tabs,
  busy,
  run,
  open,
}: {
  accounts: Snapshot["data"]["accounts"];
  tabs: Snapshot["tabs"];
  busy: boolean;
  run: Runner;
  open: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(accounts.length === 0);
  return (
    <div className="account-settings">
      <div className="section-heading">
        <div>
          <h2>Tài khoản của bạn</h2>
          <p>Quản lý thông tin đăng nhập và kết nối Messenger.</p>
        </div>
        <button
          className="primary"
          disabled={busy || creating}
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          + Thêm tài khoản
        </button>
      </div>
      {creating && (
        <section className="card account-create">
          <h3>Thêm tài khoản</h3>
          <p>
            Mở Facebook trong Chromium của ứng dụng. Khi cần xác minh, bạn hoàn
            tất trực tiếp trên trình duyệt.
          </p>
          <AccountForm run={run} busy={busy} done={() => setCreating(false)} />
        </section>
      )}
      {accounts.map((a) => (
        <article
          key={a.id}
          className={`card account-card${editing === a.id ? " editing" : ""}`}
          aria-label={`Tài khoản ${a.name}`}
        >
          <div className="account">
            <span className="avatar">{a.name.slice(0, 1)}</span>
            <div>
              <h3>{a.name}</h3>
              <p>Messenger cá nhân</p>
              <small>
                {a.username || "Đăng nhập thủ công"} ·{" "}
                {a.hasPassword ? "Đã lưu mật khẩu" : "Chưa lưu mật khẩu"}
              </small>
              <p>
                {a.hasRecoveryPin
                  ? `Đã lưu PIN · ${a.autoRestorePin ? "Tự nhập bật" : "Tự nhập tắt"}`
                  : "Chưa lưu PIN"}
              </p>
              <p>{tabs.find((t) => t.accountId === a.id)?.status}</p>
            </div>
            {editing === a.id ? (
              <span className="chip edit-state">Đang chỉnh sửa</span>
            ) : (
              <button
                disabled={busy}
                onClick={() => {
                  setCreating(false);
                  setEditing(a.id);
                }}
              >
                Sửa
              </button>
            )}
            <button disabled={busy} onClick={() => open(a.id)}>
              Mở inbox ↗
            </button>
          </div>
          {editing === a.id && (
            <div className="item-editor">
              <h3>Chỉnh sửa tài khoản · {a.name}</h3>
              <AccountForm
                key={a.id}
                account={a}
                run={run}
                busy={busy}
                done={() => setEditing(null)}
              />
            </div>
          )}
        </article>
      ))}
      {!accounts.length && !creating && (
        <div className="empty compact">
          Chưa có tài khoản được lưu. Bấm Thêm tài khoản để kết nối.
        </div>
      )}
    </div>
  );
}

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
      aria-label={
        account ? `Chỉnh sửa tài khoản ${account.name}` : "Thêm tài khoản"
      }
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
          autoFocus
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
      <div className="inline form-actions">
        <button className="primary" disabled={busy}>
          {account ? "Lưu thay đổi" : "Thêm tài khoản"}
        </button>
        <button type="button" disabled={busy} onClick={done}>
          Hủy
        </button>
      </div>
      <p className="footnote">
        Thông tin đăng nhập chỉ dùng cho form Facebook. Không gửi tới AI.
      </p>
    </form>
  );
}
