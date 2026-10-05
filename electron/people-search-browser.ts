import {
  BrowserWindow,
  session,
  type Session,
  type WebContents,
} from "electron";
import {
  publicResearchUrl,
  canonicalResearchUrl,
} from "../src/core/people-search.ts";
import {
  researchReadScript,
  type ResearchPage,
} from "../src/core/people-search-dom.ts";
import type { ResearchTransport } from "./people-search-runner.ts";
import { ResearchPausedError } from "./people-search-runner.ts";

export class PeopleSearchBrowser implements ResearchTransport {
  private window: BrowserWindow | null = null;
  private accountId?: string;
  private stopped = false;
  private touched = false;
  private finalUrl = "";
  private epoch = 0;
  private creating: Promise<BrowserWindow> | null = null;
  constructor(private getSession: (accountId?: string) => Promise<Session>) {}
  private async ensure(accountId?: string) {
    if (
      this.window &&
      !this.window.isDestroyed() &&
      this.accountId === accountId
    )
      return this.window;
    if (this.creating && this.accountId === accountId) return this.creating;
    this.stop();
    this.stopped = false;
    this.touched = false;
    this.finalUrl = "";
    this.accountId = accountId;
    const epoch = this.epoch;
    const creation = (async () => {
      const browserSession = await this.getSession(accountId);
      if (this.stopped || epoch !== this.epoch) throw new ResearchPausedError();
      const win = new BrowserWindow({
        width: 1100,
        height: 820,
        show: false,
        title: "Tìm người — Master Chat",
        webPreferences: {
          session: browserSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      this.window = win;
      const guard = (event: Electron.Event, url: string) => {
        try {
          publicResearchUrl(url);
        } catch {
          event.preventDefault();
        }
      };
      win.webContents.on("will-navigate", (event, url) => {
        guard(event, url);
        this.touched = true;
      });
      win.webContents.on("will-redirect", guard);
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("before-input-event", (_event, input) => {
        if (input.type === "keyDown") this.touched = true;
      });
      win.on("closed", () => {
        if (this.window === win) {
          this.window = null;
          this.stopped = true;
        }
      });
      return win;
    })();
    this.creating = creation;
    try {
      return await creation;
    } finally {
      if (this.creating === creation) this.creating = null;
    }
  }
  async show(url?: string, accountId?: string) {
    const win = await this.ensure(accountId);
    win.show();
    win.focus();
    if (url) {
      this.touched = false;
      await win.loadURL(publicResearchUrl(url));
    } else if (!win.webContents.getURL())
      await win.loadURL("https://www.google.com/");
  }
  async read(
    url: string,
    search: boolean,
    resume: boolean,
    accountId?: string,
    limit = 10,
  ): Promise<ResearchPage> {
    const target = publicResearchUrl(url);
    const win = await this.ensure(accountId);
    if (this.stopped || win.isDestroyed()) throw new ResearchPausedError();
    if (resume) this.touched = false;
    const waiting = (reason: string): ResearchPage => ({
      state: "waiting",
      url: win.webContents.getURL(),
      title: "",
      text: "",
      hits: [],
      reason,
    });
    if (this.touched)
      return waiting(
        "Bạn đang thao tác trong trình duyệt. Bấm Tiếp tục khi đã sẵn sàng.",
      );
    const wc = win.webContents;
    if (!resume) {
      if (wc.getURL())
        await new Promise((resolve) => setTimeout(resolve, 1000));
      if (this.stopped || wc.isDestroyed()) throw new ResearchPausedError();
      // Bound navigation time as well as DOM readiness. stop() retires timed-out navigation.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          wc.loadURL(target),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              wc.stop();
              reject(new Error("Navigation timeout"));
            }, 20000);
          }),
        ]);
      } catch (error) {
        if (this.stopped || wc.isDestroyed()) throw new ResearchPausedError();
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
      this.finalUrl = wc.getURL();
    }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (this.stopped || win.isDestroyed() || wc.isDestroyed())
        throw new ResearchPausedError();
      if (this.touched)
        return waiting(
          "Bạn đang thao tác trong trình duyệt. Bấm Tiếp tục khi đã sẵn sàng.",
        );
      let page = await this.readPage(wc, search, limit);
      if (
        page.state === "ready" &&
        search &&
        /(?:facebook|instagram|linkedin|x|youtube|tiktok)\.com$/.test(
          new URL(target).hostname,
        ) &&
        page.hits.length < limit
      ) {
        // Read only rendered account cards; bounded scrolling exposes more direct results.
        const collected = new Map(page.hits.map((h) => [h.url, h]));
        for (let scroll = 0; scroll < 4 && collected.size < limit; scroll++) {
          if (this.touched || this.stopped || wc.isDestroyed()) break;
          await wc.executeJavaScript(
            "window.scrollBy(0, Math.max(window.innerHeight, 800))",
          );
          await new Promise((r) => setTimeout(r, 600));
          const next = await this.readPage(wc, search, limit);
          if (next.state !== "ready") {
            page = next;
            break;
          }
          next.hits.forEach((h) => collected.set(h.url, h));
        }
        if (page.state === "ready")
          page = { ...page, hits: [...collected.values()].slice(0, limit) };
      }
      if (this.touched)
        return waiting(
          "Bạn đang thao tác trong trình duyệt. Bấm Tiếp tục khi đã sẵn sàng.",
        );
      if (page.state === "waiting") return page;
      // Manual navigation cannot make a different query/page count as this task's evidence.
      const actual = new URL(publicResearchUrl(page.url)),
        expected = new URL(target);
      const sameSearch =
        actual.hostname === expected.hostname &&
        actual.pathname === expected.pathname &&
        ["q", "keywords", "search_query", "start", "first", "f", "sp"].every(
          (key) =>
            actual.searchParams.get(key) === expected.searchParams.get(key),
        );
      const sameSource = [target, this.finalUrl].some(
        (value) =>
          value &&
          canonicalResearchUrl(value) === canonicalResearchUrl(page.url),
      );
      if (search ? !sameSearch : !sameSource) {
        // Challenge recovery may leave the engine home page. Reload the original
        // query on the next explicit resume; never consume the unrelated page.
        this.finalUrl = "";
        if (resume) return this.read(target, search, false, accountId, limit);
        return waiting(
          "Trang đã chuyển sang nội dung khác. Bấm Tiếp tục để mở lại truy vấn/nguồn cần đọc.",
        );
      }
      if (page.state === "ready") return page;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return waiting(
      "Trang chưa có nội dung đọc được hoặc bộ đọc chưa hỗ trợ bố cục này. Kiểm tra trình duyệt rồi bấm Tiếp tục, hoặc dừng lượt tìm kiếm.",
    );
  }
  private async readPage(
    wc: WebContents,
    search: boolean,
    limit = 10,
  ): Promise<ResearchPage> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let destroyed: () => void = () => {};
    try {
      return await Promise.race([
        wc.executeJavaScript(
          researchReadScript(search, limit),
        ) as Promise<ResearchPage>,
        new Promise<never>((_, reject) => {
          destroyed = () => reject(new ResearchPausedError());
          wc.once("destroyed", destroyed);
          timer = setTimeout(() => reject(new Error("DOM read timeout")), 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      wc.removeListener("destroyed", destroyed);
    }
  }
  stop() {
    ++this.epoch;
    this.stopped = true;
    this.creating = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}

const protectedSessions = new WeakSet<Session>();
export function researchSession() {
  const s = session.fromPartition("master-chat-people-research", {
    cache: false,
  });
  s.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  s.setPermissionCheckHandler(() => false);
  if (!protectedSessions.has(s)) {
    s.on("will-download", (event) => event.preventDefault());
    protectedSessions.add(s);
  }
  return s;
}
