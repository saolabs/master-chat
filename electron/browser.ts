import {
  BrowserWindow,
  WebContentsView,
  session,
  Notification,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import type {
  Account,
  BrowserTab,
  Conversation,
  DOMProfile,
  Message,
  InboxScan,
  InboxThread,
} from "../src/core/types.ts";
import { facebookUrl, inboxUrl, threadIdentity } from "../src/core/urls.ts";
import { readScript, sendCheck } from "../src/core/dom.ts";
import { loginScript, type LoginProbe } from "../src/core/login.ts";
import {
  messengerPinScript,
  type PinProbe,
} from "../src/core/messenger-pin.ts";
import {
  messengerScript,
  type MessengerRead,
  type NativeOptions,
} from "../src/core/messenger.ts";
import type { Vault } from "./vault.ts";
import { waitForMessengerRead } from "../src/core/messenger-readiness.ts";
type Entry = {
  meta: BrowserTab;
  view: WebContentsView;
  window?: BrowserWindow;
  worker?: boolean;
};
export class Browsers {
  private entries = new Map<string, Entry>();
  private sessions = new Map<string, Promise<Electron.Session>>();
  private monitors = new Map<string, WebContentsView>();
  private inboxOffsets = new Map<string, number>();
  private inboxSignatures = new Map<string, Map<string, string>>();
  private workers = new Map<string, WebContentsView>();
  private accountQueues = new Map<string, Promise<unknown>>();
  private selected: string | null = null;
  private bounds: Electron.Rectangle | null = null;
  private loginAttempts = new Map<string, { wcId: number; at: number }>();
  private loginBusy = new Set<number>();
  private loginTimers = new Map<number, ReturnType<typeof setInterval>>();
  private challenges = new Set<number>();
  private pinRestores = new Map<
    number,
    Promise<"absent" | "restored" | "blocked">
  >();
  constructor(
    private host: BrowserWindow,
    private vault: Vault,
    private changed: () => void,
    private pause: () => void,
  ) {}
  list() {
    return Array.from(this.entries.values()).map((e) => ({ ...e.meta }));
  }
  account(id: string) {
    const a = this.vault.read().accounts.find((a) => a.id === id);
    if (!a) throw new Error("Tài khoản không tồn tại.");
    return a;
  }
  private async accountSession(a: Account) {
    let existing = this.sessions.get(a.id);
    if (!existing) {
      existing = (async () => {
        const s = session.fromPartition(`master-chat-${a.id}`, {
          cache: false,
        });
        s.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
        s.setPermissionCheckHandler(() => false);
        s.on("will-download", (event) => event.preventDefault());
        // Only restore cookies protected by the application vault; Chromium never persists this partition.
        for (const raw of a.cookies) {
          const c = raw as Electron.Cookie;
          if (
            !c.domain ||
            !/(^|\.)facebook\.com$/.test(c.domain.replace(/^\./, ""))
          )
            continue;
          await s.cookies
            .set({
              url: `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path || "/"}`,
              name: c.name,
              value: c.value,
              domain: c.hostOnly ? undefined : c.domain,
              path: c.path,
              secure: c.secure,
              httpOnly: c.httpOnly,
              sameSite: c.sameSite,
              expirationDate: c.expirationDate,
            })
            .catch(() => undefined);
        }
        s.cookies.on("changed", () => {
          void s.cookies
            .get({})
            .then((cookies) =>
              this.vault.mutate((state) => {
                const saved = state.accounts.find((x) => x.id === a.id);
                if (saved)
                  saved.cookies = cookies.filter((c) =>
                    /(^|\.)facebook\.com$/.test(
                      (c.domain || "").replace(/^\./, ""),
                    ),
                  );
              }),
            )
            .catch(() => this.changed());
        });
        return s;
      })();
      this.sessions.set(a.id, existing);
    }
    return existing;
  }
  private protect(wc: WebContents, a: Account, update?: () => void) {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    const navigationGuard = (e: Electron.Event, url: string) => {
      try {
        facebookUrl(url);
      } catch {
        e.preventDefault();
      }
    };
    wc.on("will-navigate", navigationGuard);
    wc.on("will-redirect", navigationGuard);
    wc.on("did-navigate", () => {
      update?.();
      void this.login(wc, a);
    });
    wc.on("did-navigate-in-page", () => {
      update?.();
      void this.login(wc, a);
    });
    wc.on("did-finish-load", () => {
      update?.();
      void this.login(wc, a);
    });
    wc.on("dom-ready", () => void this.login(wc, a));
    const timer = setInterval(() => void this.login(wc, a), 1500);
    this.loginTimers.set(wc.id, timer);
    wc.once("destroyed", () => {
      clearInterval(timer);
      this.loginTimers.delete(wc.id);
      this.loginBusy.delete(wc.id);
    });
    wc.on("render-process-gone", () => this.pause());
    wc.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown") this.pause();
    });
  }
  private loginStatus(wc: WebContents, status: string) {
    const entry = [...this.entries.values()].find(
      (e) => e.view.webContents.id === wc.id,
    );
    if (entry && entry.meta.status !== status) {
      entry.meta.status = status;
      this.changed();
    }
  }
  private restorePin(wc: WebContents, original: Account) {
    const existing = this.pinRestores.get(wc.id);
    if (existing) return existing;
    const task = this.restorePinOnce(wc, original).finally(() =>
      this.pinRestores.delete(wc.id),
    );
    this.pinRestores.set(wc.id, task);
    return task;
  }
  private async restorePinOnce(
    wc: WebContents,
    original: Account,
  ): Promise<"absent" | "restored" | "blocked"> {
    // All failures are fixed messages: execution errors must never echo source code containing the secret.
    let reserved = false;
    try {
      facebookUrl(wc.getURL());
      const probe = (await wc.executeJavaScript(
        messengerPinScript("probe"),
      )) as PinProbe;
      if (probe === "absent") return "absent";
      const a = this.account(original.id);
      if (
        probe !== "ready" ||
        !a.recoveryPin ||
        !a.autoRestorePin ||
        a.pinAutoFillBlocked
      ) {
        this.loginStatus(
          wc,
          a.pinAutoFillBlocked
            ? "PIN chưa được xác nhận · kiểm tra Messenger hoặc lưu lại PIN"
            : "Cần PIN khôi phục · nhập thủ công hoặc cấu hình trong Tài khoản",
        );
        return "blocked";
      }
      // A matching Facebook identity is required before supplying the secret.
      await this.assertSession(wc, a);
      reserved = await this.vault.mutate((state) => {
        const current = state.accounts.find((x) => x.id === a.id);
        if (
          !current ||
          !current.autoRestorePin ||
          current.pinAutoFillBlocked ||
          current.recoveryPin !== a.recoveryPin
        )
          return false;
        // Persist BEFORE filling: a wrong PIN or an interrupted process cannot cause repeated automatic attempts.
        current.pinAutoFillBlocked = true;
        return true;
      });
      if (!reserved) return "blocked";
      this.changed();
      this.loginStatus(wc, "Đang khôi phục lịch sử bằng PIN đã lưu trên máy…");
      const result = await wc.executeJavaScript(
        messengerPinScript("fill", a.recoveryPin),
      );
      if (result !== "submitted") return "blocked";
      for (let n = 0; n < 24; n++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (wc.isDestroyed()) return "blocked";
        const next = (await wc.executeJavaScript(
          messengerPinScript("probe"),
        )) as PinProbe;
        if (next === "rejected") break;
        if (next !== "absent") continue;
        const read = (await this.native(wc, "read")) as MessengerRead;
        const inboxReady =
          /^\/messages\/?$/.test(new URL(wc.getURL()).pathname) &&
          (await wc.executeJavaScript(
            `Boolean(document.querySelector('[role="grid"] a[href*="/messages/"]'))`,
          ));
        if (read.blocked || (!read.composerPresent && !inboxReady)) continue;
        await this.assertSession(wc, a);
        await this.vault.mutate((state) => {
          const current = state.accounts.find((x) => x.id === a.id);
          if (current && current.recoveryPin === a.recoveryPin)
            current.pinAutoFillBlocked = false;
        });
        this.loginStatus(wc, "Đã khôi phục lịch sử bằng PIN local");
        this.changed();
        return "restored";
      }
    } catch {
      // Intentionally omit exception details and PIN values from notices, logs and snapshots.
    } finally {
      if (reserved && this.account(original.id).pinAutoFillBlocked)
        this.loginStatus(
          wc,
          "Chưa khôi phục được · đã dừng tự thử PIN; kiểm tra Messenger",
        );
    }
    return "blocked";
  }
  private async login(wc: WebContents, original: Account) {
    if (wc.isDestroyed() || this.loginBusy.has(wc.id)) return;
    this.loginBusy.add(wc.id);
    try {
      const url = facebookUrl(wc.getURL());
      const a = this.account(original.id); // Credentials may have been edited after the tab was opened.
      if ((await this.restorePin(wc, a)) !== "absent") return;
      const probe = (await wc.executeJavaScript(
        loginScript("probe"),
      )) as LoginProbe;
      if (probe === "verification") {
        this.pause();
        this.loginStatus(wc, "Cần xác minh · hoàn tất trên trình duyệt");
        if (!this.challenges.has(wc.id)) {
          this.challenges.add(wc.id);
          if (Notification.isSupported()) {
            const n = new Notification({
              title: "Master Chat cần xác minh",
              body: "Mở trình duyệt tài khoản để hoàn tất xác minh Facebook.",
            });
            n.on("click", () => this.host.show());
            n.show();
          }
        }
        return;
      }
      const authenticated =
        (
          await wc.session.cookies.get({
            name: "c_user",
            domain: ".facebook.com",
          })
        ).length > 0;
      if (authenticated && probe !== "ready" && probe !== "rejected") {
        this.loginAttempts.delete(a.id);
        this.challenges.delete(wc.id);
        this.loginStatus(wc, "Đã đăng nhập");
        if (
          (url.pathname === "/" || /login/.test(url.pathname)) &&
          !wc.isLoading()
        )
          await wc.loadURL(inboxUrl(a));
        return;
      }
      if (probe === "rejected") {
        this.loginStatus(
          wc,
          "Đăng nhập thất bại · kiểm tra tài khoản/mật khẩu",
        );
        this.pause();
        return;
      }
      if (probe !== "ready") return;
      if (!a.username || !a.password) {
        this.loginStatus(
          wc,
          "Chưa lưu thông tin đăng nhập · sửa tài khoản hoặc đăng nhập thủ công",
        );
        return;
      }
      const previous = this.loginAttempts.get(a.id);
      if (previous) {
        this.loginStatus(
          wc,
          Date.now() - previous.at > 30_000
            ? "Chưa đăng nhập được · kiểm tra trình duyệt hoặc thử lại"
            : "Đang đăng nhập tự động…",
        );
        return;
      }
      // Reserve per account before awaiting, so a visible tab and worker cannot submit concurrently.
      this.loginAttempts.set(a.id, { wcId: wc.id, at: Date.now() });
      const result = await wc.executeJavaScript(
        loginScript("submit", a.username, a.password),
      );
      if (result !== "submitted") {
        this.loginAttempts.delete(a.id);
        this.loginStatus(wc, "Form chưa sẵn sàng hoặc đang được nhập thủ công");
        return;
      }
      this.loginStatus(wc, "Đang đăng nhập tự động…");
    } catch {
      // Navigation can invalidate the execution context. The readiness timer will recheck the new page.
    } finally {
      this.loginBusy.delete(wc.id);
    }
  }
  retryLogin(id: string) {
    const e = this.get(id);
    this.loginAttempts.delete(e.meta.accountId);
    this.challenges.delete(e.view.webContents.id);
    e.meta.status = "Đang kiểm tra đăng nhập…";
    e.view.webContents.reload();
    this.changed();
  }
  credentialsChanged(accountId: string) {
    this.loginAttempts.delete(accountId);
    for (const e of this.entries.values())
      if (e.meta.accountId === accountId) this.retryLogin(e.meta.id);
  }
  async open(
    accountId: string,
    url?: string,
    detached = false,
  ): Promise<string> {
    const a = this.account(accountId),
      target = facebookUrl(url || inboxUrl(a)).toString();
    const view = new WebContentsView({
      webPreferences: {
        session: await this.accountSession(a),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const id = randomUUID();
    const entry: Entry = {
      meta: {
        id,
        accountId,
        title: a.name,
        url: target,
        detached,
        status: "Đang tải",
      },
      view,
    };
    this.entries.set(id, entry);
    const update = () => {
      entry.meta.url = view.webContents.getURL();
      if (
        entry.meta.status === "Đang tải" ||
        entry.meta.status === "Không tải được trang"
      )
        entry.meta.status = "Đang kiểm tra phiên đăng nhập…";
      this.changed();
    };
    this.protect(view.webContents, a, update);
    if (detached) this.detach(id);
    else this.select(id);
    try {
      await view.webContents.loadURL(target);
    } catch {
      entry.meta.status = "Không tải được trang";
    }
    this.changed();
    return id;
  }
  private get(id: string) {
    const e = this.entries.get(id);
    if (!e) throw new Error("Tab không tồn tại.");
    return e;
  }
  select(id: string) {
    const e = this.get(id);
    if (e.window) {
      e.window.show();
      return;
    }
    for (const other of this.entries.values())
      if (!other.window) other.view.setVisible(false);
    this.host.contentView.addChildView(e.view);
    this.selected = id;
    this.layout();
    this.changed();
  }
  setBounds(bounds: Electron.Rectangle | null) {
    this.bounds = bounds;
    this.layout();
  }
  private layout() {
    if (!this.selected) return;
    const e = this.entries.get(this.selected);
    if (!e || e.window) return;
    e.view.setVisible(Boolean(this.bounds));
    if (this.bounds) e.view.setBounds(this.bounds);
  }
  detach(id: string) {
    const e = this.get(id);
    if (e.window) {
      e.window.show();
      return;
    }
    this.host.contentView.removeChildView(e.view);
    if (this.selected === id) this.selected = null;
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      title: `${e.meta.title} — Master Chat`,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    e.window = win;
    e.meta.detached = true;
    win.contentView.addChildView(e.view);
    e.view.setVisible(true);
    const resize = () => {
      const { width, height } = win.getContentBounds();
      e.view.setBounds({ x: 0, y: 0, width, height });
    };
    resize();
    win.on("resize", resize);
    win.on("close", () => {
      if (e.worker && !e.view.webContents.isDestroyed())
        win.contentView.removeChildView(e.view);
    });
    win.on("closed", () => {
      if (!e.view.webContents.isDestroyed()) {
        if (e.worker) e.view.setVisible(false);
        else e.view.webContents.close();
      }
      this.entries.delete(id);
      this.changed();
    });
    this.changed();
  }
  close(id: string) {
    const e = this.get(id);
    if (e.window) e.window.close();
    else {
      this.host.contentView.removeChildView(e.view);
      e.view.webContents.close();
      this.entries.delete(id);
    }
    if (this.selected === id) this.selected = null;
    this.changed();
  }
  reload(id: string) {
    this.get(id).view.webContents.reload();
  }
  async inspect(id: string, profile?: DOMProfile) {
    const e = this.get(id),
      a = this.account(e.meta.accountId);
    await this.assertSession(e.view.webContents, a);
    return {
      accountId: a.id,
      url: e.view.webContents.getURL(),
      ...(profile
        ? await e.view.webContents.executeJavaScript(readScript(profile))
        : await this.native(e.view.webContents, "read")),
    };
  }
  private async native(
    wc: WebContents,
    action: Parameters<typeof messengerScript>[0],
    options: NativeOptions = {},
  ) {
    // Electron otherwise replaces script exceptions with an opaque execution error.
    const result = await wc.executeJavaScript(
      `(() => {try {return {ok:true,data:${messengerScript(action, options)}};} catch(error) {return {ok:false,error: error instanceof Error ? error.message : "Không đọc được Messenger."};}})()`,
    );
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
  private async assertSession(wc: WebContents, account: Account) {
    const cookies = await wc.session.cookies.get({
      name: "c_user",
      domain: ".facebook.com",
    });
    const userId = cookies[0]?.value;
    if (!userId)
      throw new Error("Tài khoản chưa đăng nhập Facebook trong ứng dụng.");
    const current = this.account(account.id);
    if (current.facebookUserId && current.facebookUserId !== userId)
      throw new Error(
        "Phiên Facebook không khớp tài khoản đã kết nối. Đã chặn đọc/gửi.",
      );
    if (!current.facebookUserId)
      await this.vault.mutate((s) => {
        const saved = s.accounts.find((a) => a.id === account.id)!;
        saved.facebookUserId = userId;
      });
  }
  async scanInbox(accountId: string): Promise<InboxScan> {
    return this.serialized(accountId, async () => {
      const a = this.account(accountId);
      let view = this.monitors.get(accountId);
      if (!view) {
        view = new WebContentsView({
          webPreferences: {
            session: await this.accountSession(a),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        });
        view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
        this.protect(view.webContents, a);
        this.monitors.set(accountId, view);
      }
      const wc = view.webContents;
      await this.assertSession(wc, a);
      if (!wc.getURL().includes("/messages/")) await wc.loadURL(inboxUrl(a));
      let first:
        { threads: InboxThread[]; revision: number; more: boolean } | undefined;
      for (let n = 0; n < 12; n++) {
        try {
          first = await this.native(wc, "inbox");
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      if (!first)
        throw new Error(
          "Chưa đọc được inbox. Mở tab tài khoản để hoàn tất đăng nhập/PIN.",
        );
      await this.native(wc, "reset-inbox");
      await new Promise((r) => setTimeout(r, 150));
      const map = new Map<string, InboxThread>();
      const top = await this.native(wc, "inbox");
      for (const thread of top.threads as InboxThread[])
        map.set(thread.platformId, thread);
      const offset = this.inboxOffsets.get(accountId) ?? 0;
      if (offset && top.more) {
        await this.native(wc, "seek-inbox", { scrollTop: offset });
        await new Promise((r) => setTimeout(r, 250));
      }
      let more = true,
        nextOffset = 0,
        revision = first.revision;
      for (let page = 0; page < 8; page++) {
        const result = await this.native(wc, "inbox");
        for (const thread of result.threads as InboxThread[])
          map.set(thread.platformId, thread);
        revision = result.revision;
        more = result.more;
        nextOffset = result.nextOffset;
        if (!more || page === 7) break;
        if (!(await this.native(wc, "scroll-inbox"))) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      this.inboxOffsets.set(accountId, more ? nextOffset : 0);
      await this.native(wc, "reset-inbox");
      const old =
        this.inboxSignatures.get(accountId) ?? new Map<string, string>();
      const threads = [...map.values()];
      threads.sort(
        (a, b) =>
          Number(b.unread || old.get(b.platformId) !== b.signature) -
          Number(a.unread || old.get(a.platformId) !== a.signature),
      );
      this.inboxSignatures.set(
        accountId,
        new Map(threads.map((t) => [t.platformId, t.signature])),
      );
      return {
        threads,
        scannedAt: Date.now(),
        coverage: more ? "partial" : "visible",
        revision,
      };
    });
  }
  private async worker(a: Account) {
    let worker = this.workers.get(a.id);
    if (worker?.webContents.isDestroyed()) {
      this.workers.delete(a.id);
      worker = undefined;
    }
    if (!worker) {
      worker = new WebContentsView({
        webPreferences: {
          session: await this.accountSession(a),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      worker.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
      this.protect(worker.webContents, a);
      this.workers.set(a.id, worker);
    }
    return worker.webContents;
  }
  private serialized<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const task = (this.accountQueues.get(accountId) || Promise.resolve()).then(
      operation,
    );
    this.accountQueues.set(
      accountId,
      task.catch(() => undefined),
    );
    return task;
  }
  async readConversation(
    c: Conversation,
    profile?: DOMProfile,
  ): Promise<Omit<Message, "baseline">[]> {
    return this.serialized(c.accountId, () => this.readUnlocked(c, profile));
  }
  private async readUnlocked(
    c: Conversation,
    profile?: DOMProfile,
  ): Promise<Omit<Message, "baseline">[]> {
    const a = this.account(c.accountId),
      wc = await this.worker(a);
    if (
      [...this.entries.values()].some(
        (e) => e.worker && e.view.webContents === wc,
      )
    )
      throw new Error(
        "Hoàn tất xác minh trong cửa sổ Messenger rồi đóng cửa sổ đó để nạp lại lịch sử.",
      );
    await this.assertSession(wc, a);
    let currentId: string | null = null;
    try {
      currentId = threadIdentity(wc.getURL(), a.platform);
    } catch {
      // A new worker starts at about:blank.
    }
    if (currentId !== c.platformId) await wc.loadURL(c.url);
    if (!profile) return this.readNative(wc, c);
    // React may commit after did-finish-load. Poll bounded identity readiness without assuming a delay is success.
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await wc.executeJavaScript(readScript(profile));
      if (threadIdentity(wc.getURL(), a.platform) !== c.platformId)
        throw new Error("URL không khớp thread.");
      if (
        result.threadId === c.platformId &&
        result.messages.length &&
        result.invalid === 0
      )
        return result.messages.map(
          (m: Omit<Message, "baseline" | "observedAt">) => ({
            ...m,
            observedAt: Date.now(),
          }),
        );
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error("Profile chưa đọc được ID, hướng hoặc timestamp đầy đủ.");
  }
  private async readNative(
    wc: WebContents,
    c: Conversation,
  ): Promise<Omit<Message, "baseline">[]> {
    const capture = async () => {
      let read = (await this.native(wc, "read")) as MessengerRead;
      if (threadIdentity(wc.getURL()) !== c.platformId)
        throw new Error("Facebook chuyển sang hội thoại khác; đã chặn đọc.");
      if (
        read.blocked &&
        (await this.restorePin(wc, this.account(c.accountId))) === "restored"
      )
        read = (await this.native(wc, "read")) as MessengerRead;
      if (read.blocked) {
        this.pause();
        this.showWorker(c.accountId);
        throw new Error(
          `${read.blockedReason ?? "Messenger cần xác minh."} Hoàn tất trong cửa sổ Messenger vừa mở, đóng cửa sổ rồi nạp lại lịch sử.`,
        );
      }
      return read;
    };
    const result = await waitForMessengerRead(
      async () => {
        await this.native(wc, "scroll-latest");
        return capture();
      },
      c,
      "Mở hội thoại",
    );
    const collected = new Map(result.messages.map((m) => [m.id, m]));
    // Bounded history backfill in the worker only; the person's visible browser never scrolls.
    if (!c.messages.length && collected.size < 59)
      for (let n = 0; n < 8 && collected.size < 59; n++) {
        if (!(await this.native(wc, "scroll-history"))) break;
        await new Promise((r) => setTimeout(r, 250));
        const older = await waitForMessengerRead(capture, c, "Tải lịch sử");
        const before = collected.size;
        const combined = new Map(older.messages.map((m) => [m.id, m]));
        for (const [id, m] of collected) combined.set(id, m);
        collected.clear();
        for (const [id, m] of combined) collected.set(id, m);
        if (collected.size === before) break;
      }
    await this.native(wc, "scroll-latest");
    await new Promise((r) => setTimeout(r, 250));
    const latest = await waitForMessengerRead(
      capture,
      c,
      "Hoàn tất tải lịch sử",
    );
    for (const m of latest.messages) collected.set(m.id, m);
    // Retain DOM chronology when no absolute timestamp is available.
    return [...collected.values()]
      .slice(-59)
      .map((m) => ({ ...m, observedAt: Date.now() }));
  }
  private showWorker(accountId: string) {
    const view = this.workers.get(accountId);
    if (!view || view.webContents.isDestroyed()) return;
    const existing = [...this.entries.values()].find((e) => e.view === view);
    if (existing) {
      existing.window?.show();
      return;
    }
    const id = randomUUID();
    this.entries.set(id, {
      view,
      worker: true,
      meta: {
        id,
        accountId,
        title: `${this.account(accountId).name} · Messenger cần kiểm tra`,
        url: view.webContents.getURL(),
        detached: true,
        status: "Cần xử lý hộp thoại trong cửa sổ này",
      },
    });
    this.detach(id);
  }
  private async sendNative(
    wc: WebContents,
    c: Conversation,
    text: string,
    basedOn: string | null,
    allowed: () => boolean,
  ) {
    await this.assertSession(wc, this.account(c.accountId));
    if (!allowed() || threadIdentity(wc.getURL()) !== c.platformId)
      throw new Error("Đã dừng hoặc sai hội thoại.");
    for (const e of this.entries.values()) {
      if (e.meta.accountId !== c.accountId || e.view.webContents.isDestroyed())
        continue;
      if (
        e.view.webContents
          .getURL()
          .match(
            /^https:\/\/(?:www\.)?facebook\.com\/messages\/(?:e2ee\/)?t\/(\d+)\/?(?:[?#].*)?$/,
          )?.[1] === c.platformId
      ) {
        await this.native(e.view.webContents, "preflight", {
          threadId: c.platformId,
          recipient: c.name,
          latest: basedOn,
        });
      }
    }
    const options = {
      threadId: c.platformId,
      recipient: c.name,
      latest: basedOn,
      text,
    };
    await this.native(wc, "preflight", options);
    const before = (await this.native(wc, "read")) as MessengerRead;
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    await this.native(wc, "focus", options);
    if (!allowed()) throw new Error("Đã dừng trước khi nhập tin.");
    await wc.debugger.sendCommand("Input.insertText", { text });
    await this.assertSession(wc, this.account(c.accountId));
    if (!allowed() || threadIdentity(wc.getURL()) !== c.platformId)
      throw new Error("Đã dừng trước khi gửi; nội dung còn trong composer.");
    await this.native(wc, "click", options);
    const ids = new Set(before.messages.map((m) => m.id));
    for (let n = 0; n < 12; n++) {
      await new Promise((r) => setTimeout(r, 350));
      const echo = (await this.native(wc, "read")) as MessengerRead;
      if (
        echo.threadId !== c.platformId ||
        echo.selectedThreadId !== c.platformId ||
        echo.blocked
      )
        throw new Error("Không xác nhận được đúng hội thoại sau gửi.");
      if (
        echo.messages.some(
          (m) =>
            m.direction === "outgoing" && m.text === text && !ids.has(m.id),
        )
      )
        return;
    }
    throw new Error(
      "Chưa xác nhận tin đã gửi. Kiểm tra Messenger; không tự gửi lại.",
    );
  }
  async send(
    c: Conversation,
    profile: DOMProfile | undefined,
    text: string,
    basedOn: string | null,
    allowed: () => boolean,
  ): Promise<void> {
    return this.serialized(c.accountId, () =>
      this.sendUnlocked(c, profile, text, basedOn, allowed),
    );
  }
  private async sendUnlocked(
    c: Conversation,
    profile: DOMProfile | undefined,
    text: string,
    basedOn: string | null,
    allowed: () => boolean,
  ): Promise<void> {
    const a = this.account(c.accountId),
      wc = await this.worker(a);
    if (
      [...this.entries.values()].some(
        (e) => e.worker && e.view.webContents === wc,
      )
    )
      throw new Error(
        "Cửa sổ xác minh Messenger đang mở; đã chặn gửi tự động.",
      );
    if (!profile) return this.sendNative(wc, c, text, basedOn, allowed);
    await this.assertSession(wc, a);
    if (
      !profile.verified ||
      !allowed() ||
      threadIdentity(wc.getURL(), a.platform) !== c.platformId
    )
      throw new Error("Đã dừng hoặc sai hội thoại.");
    await wc.executeJavaScript(
      `(${sendCheck.toString()})(${JSON.stringify(profile)},${JSON.stringify(c.platformId)},${JSON.stringify(basedOn)},${JSON.stringify(text)})`,
    );
    if (!allowed()) throw new Error("Đã tạm dừng.");
    // CDP input follows Chromium's own editing path; Facebook receives real input events.
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    await wc.executeJavaScript(
      `document.querySelector(${JSON.stringify(profile.composerSelector)}).focus()`,
    );
    await wc.debugger.sendCommand("Input.insertText", { text });
    if (!allowed() || threadIdentity(wc.getURL(), a.platform) !== c.platformId)
      throw new Error("Đã dừng trước khi gửi; nội dung còn trong composer.");
    const clicked = await wc.executeJavaScript(`(() => {
      const p=${JSON.stringify(profile)}; const root=document.querySelector(p.threadSelector);
      if(root?.getAttribute(p.threadIdAttribute)!==${JSON.stringify(c.platformId)}) return false;
      const last=Array.from(root.querySelectorAll(p.messageSelector)).at(-1)?.getAttribute(p.messageIdAttribute)??null;
      if(last!==${JSON.stringify(basedOn)}) return false;
      const button=document.querySelector(p.sendSelector); if(!button || button.disabled || button.getAttribute('aria-disabled')==='true') return false;
      button.click(); return true;
    })()`);
    if (!clicked) throw new Error("Không gửi vì trạng thái đã thay đổi.");
    // A click is not delivery: require a new outgoing echo. Uncertainty is handled by durable outbox.
    for (let i = 0; i < 8; i++) {
      const result = await wc.executeJavaScript(readScript(profile));
      if (
        result.threadId === c.platformId &&
        result.messages.some(
          (m: Message) =>
            m.direction === "outgoing" &&
            m.text === text &&
            !c.messages.some((old) => old.id === m.id),
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      "Chưa xác nhận echo gửi thành công. Kiểm tra trực tiếp, không gửi lại tự động.",
    );
  }
  shutdown() {
    for (const timer of this.loginTimers.values()) clearInterval(timer);
    this.loginTimers.clear();
    for (const w of [...this.workers.values(), ...this.monitors.values()])
      if (!w.webContents.isDestroyed()) w.webContents.close();
    for (const e of [...this.entries.values()]) this.close(e.meta.id);
  }
}
