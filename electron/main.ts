import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  powerMonitor,
} from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Vault } from "./vault.ts";
import { Browsers } from "./browser.ts";
import { Engine } from "./engine.ts";
import {
  validateTranscriptionSelection,
  transcriptionMode,
} from "./transcription.ts";
import { discoverModels, providerChat } from "./ai.ts";
import {
  providerURL,
  resolveModel,
  validateSelections,
} from "../src/core/ai-config.ts";
import { threadIdentity } from "../src/core/urls.ts";
import type { Command, DOMProfile, Snapshot } from "../src/core/types.ts";
import { rememberProviderKey } from "./provider-keys.ts";
import { saveProvider, updateAccount } from "../src/core/settings.ts";
import { publicState } from "../src/core/types.ts";
import { isDifferentReviewModel } from "../src/core/reply-quality.ts";
import {
  knowledgeCommands,
  applyKnowledgeCommand,
  MAX_DOCUMENT_FILES,
} from "../src/core/knowledge.ts";
import {
  DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  readDocumentFiles,
  readDocumentUploads,
} from "./documents.ts";
const platform = z.literal("messenger-personal");
const id = z.string().uuid(),
  short = z.string().trim().min(1).max(200);
const profileSchema = z
  .object({
    version: z.literal(1),
    platform,
    verified: z.boolean(),
    threadSelector: short,
    threadIdAttribute: short,
    messageSelector: short,
    messageIdAttribute: short,
    textSelector: short,
    directionAttribute: short,
    incomingValue: short,
    outgoingValue: short,
    timestampAttribute: short,
    composerSelector: short,
    sendSelector: short,
    listSelector: short,
    linkSelector: short,
  })
  .strict();
const selectionSchema = z
  .object({
    providerId: id,
    modelId: short,
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().min(1).max(1000000).optional(),
  })
  .strict();
const aiSchema = z
  .object({
    default: selectionSchema.nullable(),
    tasks: z
      .object({
        summary: selectionSchema.nullable(),
        knowledge: selectionSchema.nullable(),
        reply: selectionSchema.nullable(),
      })
      .strict(),
  })
  .strict();
const providerSchema = z
  .object({
    id,
    name: short,
    type: z.enum([
      "ollama",
      "lmstudio",
      "openai_compatible",
      "openai",
      "anthropic",
      "google",
      "deepseek",
      "nvidia",
    ]),
    baseUrl: z.string().min(1).max(2000),
    apiKey: z.string().max(4000),
    apiKeys: z.array(z.string().trim().min(1).max(4000)).max(100).optional(),
    enabled: z.boolean(),
    allowRemote: z.boolean(),
    models: z.array(short).max(2000),
  })
  .strict();
const commands = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("response.save"),
      settings: z
        .object({
          aboutMe: z.string().max(4000).optional(),
          personality: z.string().max(4000).optional(),
          instructions: z.string().max(8000).optional(),
          learnStyle: z.boolean().optional(),
          providerCache: z.boolean().optional(),
          review: z
            .object({
              enabled: z.boolean().optional(),
              model: selectionSchema.nullable().optional(),
            })
            .strict()
            .optional(),
          media: z
            .object({
              enabled: z.boolean().optional(),
              imageModel: selectionSchema.nullable().optional(),
              audioModel: selectionSchema.nullable().optional(),
              transcription: z
                .object({
                  mode: z.enum(["local", "provider"]).optional(),
                  executable: z.string().max(4000).optional(),
                  modelPath: z.string().max(4000).optional(),
                  ffmpegPath: z.string().max(4000).optional(),
                  language: z
                    .string()
                    .regex(/^(?:auto|[a-z]{2,3})$/)
                    .optional(),
                })
                .strict()
                .optional(),
            })
            .strict()
            .optional(),
          typing: z
            .object({
              enabled: z.boolean().optional(),
              charactersPerMinute: z.number().min(40).max(1200).optional(),
              thinkingMs: z.number().int().min(0).max(60000).optional(),
              maxDelayMs: z.number().int().min(1000).max(300000).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("conversation.style"),
      conversationId: id,
      style: z.string().max(4000).optional(),
      learnStyle: z.boolean().optional(),
      relationshipContext: z.string().max(12000).optional(),
      conversationDirection: z.string().max(12000).optional(),
    })
    .strict(),
  ...(["style.learn", "conversation.backfill"] as const).map((type) =>
    z.object({ type: z.literal(type), conversationId: id }).strict(),
  ),
  z
    .object({
      type: z.literal("media.retry"),
      conversationId: id,
      target: z
        .object({
          messageId: z.string().min(1).max(2000),
          attachmentId: z.string().min(1).max(2000),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal("draft.discard"), draftId: id }).strict(),
  z
    .object({
      type: z.literal("draft.review"),
      draftId: id,
      text: z.string().trim().min(1).max(5000),
    })
    .strict(),
  z
    .object({ type: z.literal("automation.all"), enabled: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("account.auto"),
      accountId: id,
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("conversation.composing"),
      conversationId: id,
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("conversation.send"),
      conversationId: id,
      text: z.string().trim().min(1).max(5000),
      basedOnId: z.string().min(1).max(2000).nullable(),
    })
    .strict(),
  z.object({ type: z.literal("inbox.sync"), accountId: id }).strict(),
  z
    .object({
      type: z.literal("account.discovery"),
      accountId: id,
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({ type: z.literal("conversation.sync"), conversationId: id })
    .strict(),
  z
    .object({
      type: z.literal("conversation.watch"),
      conversationId: id.nullable(),
    })
    .strict(),
  z.object({ type: z.literal("profile.reset") }).strict(),
  z
    .object({
      type: z.literal("account.save"),
      id: id.optional(),
      name: short,
      platform,
      username: z.string().max(320),
      password: z.string().max(1000),
      recoveryPin: z
        .string()
        .regex(/^(?:\d{6})?$/, "PIN cần đúng 6 chữ số.")
        .optional(),
      clearRecoveryPin: z.boolean().optional(),
      autoRestorePin: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("browser.open"),
      accountId: id,
      url: z.string().max(2000).optional(),
      detached: z.boolean().optional(),
    })
    .strict(),
  ...(
    [
      "browser.select",
      "browser.close",
      "browser.detach",
      "browser.reload",
      "browser.inspect",
      "browser.login",
    ] as const
  ).map((type) => z.object({ type: z.literal(type), tabId: id }).strict()),
  ...(["automation.pause", "automation.resume"] as const).map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
  z.object({ type: z.literal("ai.save"), config: aiSchema }).strict(),
  z
    .object({
      type: z.literal("provider.save"),
      provider: providerSchema,
      clearApiKey: z.boolean().optional(),
      removeApiKeyIndexes: z
        .array(z.number().int().min(0).max(99))
        .max(100)
        .optional(),
    })
    .strict(),
  ...(["provider.models", "provider.test", "provider.remove"] as const).map(
    (type) =>
      z
        .object({
          type: z.literal(type),
          providerId: id,
          modelId: short.optional(),
        })
        .strict(),
  ),
  z
    .object({ type: z.literal("profile.save"), profile: profileSchema })
    .strict(),
  z
    .object({
      type: z.literal("conversation.add"),
      accountId: id,
      name: short,
      url: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("conversation.auto"),
      conversationId: id,
      enabled: z.boolean().nullable(),
    })
    .strict(),
  ...knowledgeCommands,
  z
    .object({
      type: z.literal("draft.generate"),
      conversationId: id,
      goal: z.string().trim().min(1).max(5000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("draft.resolve"),
      draftId: id,
      outcome: z.enum(["sent", "stale"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("draft.send"),
      draftId: id,
      text: z.string().trim().min(1).max(5000),
    })
    .strict(),
]);
let main: BrowserWindow | null = null,
  browsers: Browsers,
  engine: Engine,
  vault: Vault;
// A separate directory makes smoke testing independent of the user's real vault.
if (process.env.MASTER_CHAT_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.MASTER_CHAT_DATA_DIR));
app.commandLine.appendSwitch("disable-http-cache");
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => main?.show());
function changed() {
  if (main && !main.isDestroyed()) main.webContents.send("app:changed");
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
    !main ||
    event.sender.id !== main.webContents.id ||
    event.senderFrame !== main.webContents.mainFrame
  )
    throw new Error("IPC sender không được phép.");
}
function snapshot(): Snapshot {
  const state = vault.read();
  return {
    data: publicState(state),
    tabs: browsers.list(),
    paused: engine.paused,
    pauseReason: engine.pauseReason,
    live: { ...engine.live },
    replying: engine.replying,
    notice: engine.notice,
    monitors: structuredClone(engine.monitors),
  };
}
async function execute(cmd: Command) {
  switch (cmd.type) {
    case "response.save":
      await engine.configure(() =>
        vault.mutate((s) => {
          const image = cmd.settings.media?.imageModel;
          if (image)
            resolveModel(
              { ...s.ai, tasks: { ...s.ai.tasks, reply: image } },
              "reply",
            );
          const audio = cmd.settings.media?.audioModel;
          if (
            audio &&
            transcriptionMode(cmd.settings.media?.transcription, audio) ===
              "provider"
          )
            validateTranscriptionSelection(s.ai, audio);
          s.response = cmd.settings;
          const reviewer = cmd.settings.review?.model;
          if (reviewer && cmd.settings.review?.enabled !== false) {
            resolveModel(
              { ...s.ai, tasks: { ...s.ai.tasks, reply: reviewer } },
              "reply",
            );
            if (
              (s.ai.tasks.reply || s.ai.default) &&
              !isDifferentReviewModel(
                resolveModel(s.ai, "reply").selection,
                reviewer,
              )
            )
              throw new Error(
                "Chọn model kiểm tra khác model viết câu trả lời.",
              );
          }
        }),
      );
      engine.report(
        engine.paused
          ? "Đã lưu phong cách, media và nhịp trả lời. Tự trả lời vẫn đang tạm dừng."
          : "Đã lưu phong cách, media và nhịp trả lời. Tự trả lời tiếp tục theo dõi.",
      );
      break;
    case "conversation.style":
      await engine.configure(() =>
        vault.mutate((s) => {
          const c = s.conversations.find((c) => c.id === cmd.conversationId);
          if (!c) throw new Error("Hội thoại không tồn tại.");
          c.responseStyle = cmd.style?.trim() || undefined;
          c.learnStyle = cmd.learnStyle;
          c.relationshipContext = cmd.relationshipContext?.trim() || undefined;
          c.conversationDirection =
            cmd.conversationDirection?.trim() || undefined;
          for (const d of s.drafts)
            if (d.conversationId === c.id && d.status === "draft")
              d.status = "stale";
        }),
      );
      break;
    case "style.learn":
      await engine.learnConversationStyle(cmd.conversationId);
      break;
    case "media.retry":
      await engine.retryMedia(cmd.conversationId, cmd.target);
      break;
    case "account.auto":
      await engine.setAccountAuto(cmd.accountId, cmd.enabled);
      break;
    case "automation.all":
      await engine.setAllAuto(cmd.enabled);
      break;
    case "draft.review":
      await engine.recheckDraft(cmd.draftId, cmd.text);
      break;
    case "conversation.composing":
      engine.setComposing(cmd.conversationId, cmd.active);
      break;
    case "conversation.send":
      await engine.sendMessage(cmd.conversationId, cmd.text, cmd.basedOnId);
      break;
    case "inbox.sync":
      await engine.syncInbox(cmd.accountId);
      break;
    case "conversation.watch":
      engine.watchConversation(cmd.conversationId);
      break;
    case "conversation.sync": {
      const c = vault
        .read()
        .conversations.find((c) => c.id === cmd.conversationId);
      if (!c) throw new Error("Hội thoại không tồn tại.");
      browsers.invalidateSync(c.accountId);
      await engine.syncConversation(cmd.conversationId);
      break;
    }
    case "conversation.backfill":
      await engine.backfillConversation(cmd.conversationId);
      break;
    case "account.discovery":
      await engine.configure(() =>
        vault.mutate((s) => {
          const a = s.accounts.find((a) => a.id === cmd.accountId);
          if (!a) throw new Error("Tài khoản không tồn tại.");
          a.autoDiscoverReply = cmd.enabled;
        }),
      );
      break;
    case "profile.reset":
      engine.pause();
      await vault.mutate((s) => {
        delete s.profiles["messenger-personal"];
      });
      engine.report("Đã chọn bộ đọc Messenger tích hợp.");
      break;
    case "account.save": {
      engine.pause();
      await vault.mutate((s) => {
        const existing = cmd.id
          ? s.accounts.find((a) => a.id === cmd.id)
          : undefined;
        if (cmd.id && !existing) throw new Error("Tài khoản không tồn tại.");
        if (existing) {
          updateAccount(existing, cmd);
        } else {
          const account = {
            id: randomUUID(),
            name: cmd.name,
            platform: cmd.platform,
            username: cmd.username,
            password: cmd.password,
            cookies: [],
          };
          updateAccount(account, cmd);
          s.accounts.push(account);
        }
      });
      if (cmd.id) browsers.credentialsChanged(cmd.id);
      engine.report("Đã lưu thông tin tài khoản trong vault mã hóa.");
      break;
    }
    case "browser.open":
      await browsers.open(cmd.accountId, cmd.url, cmd.detached);
      break;
    case "browser.select":
      browsers.select(cmd.tabId);
      break;
    case "browser.close":
      browsers.close(cmd.tabId);
      break;
    case "browser.detach":
      browsers.detach(cmd.tabId);
      break;
    case "browser.reload":
      browsers.reload(cmd.tabId);
      break;
    case "browser.login":
      browsers.retryLogin(cmd.tabId);
      break;
    case "browser.inspect": {
      const tab = browsers.list().find((t) => t.id === cmd.tabId)!,
        a = browsers.account(tab.accountId),
        p = vault.read().profiles[a.platform];
      const result = await browsers.inspect(cmd.tabId, p);
      engine.report(
        `DOM: thread ${result.threadId ? "có ID" : "thiếu ID"}, ${result.messages.length} tin, ${result.invalid} tin thiếu dữ liệu, composer ${result.composerPresent ? "có" : "không"}.`,
      );
      break;
    }
    case "automation.pause":
      engine.pause();
      break;
    case "automation.resume":
      await engine.resume();
      break;
    case "provider.save": {
      engine.pause();
      // A blocked cloud provider can be saved, but cannot make requests until explicitly enabled.
      providerURL(cmd.provider, true);
      await vault.mutate((s) => {
        saveProvider(
          s.ai,
          cmd.provider,
          cmd.clearApiKey,
          cmd.removeApiKeyIndexes,
        );
      });
      engine.report(
        "Đã lưu provider. Tải danh sách model và chọn model sử dụng.",
      );
      break;
    }
    case "provider.models": {
      const p = vault.read().ai.providers.find((p) => p.id === cmd.providerId);
      if (!p) throw new Error("Provider không tồn tại.");
      const models = await discoverModels(p, {
        onKeyChange: (provider, key) =>
          rememberProviderKey(vault, provider, key),
      });
      await vault.mutate((s) => {
        const current = s.ai.providers.find((x) => x.id === p.id);
        if (
          current &&
          current.baseUrl === p.baseUrl &&
          current.apiKey === p.apiKey &&
          current.allowRemote === p.allowRemote
        )
          current.availableModels = models;
      });
      engine.report(`Đã tải ${models.length} model từ provider.`);
      break;
    }
    case "provider.test": {
      const p = vault.read().ai.providers.find((p) => p.id === cmd.providerId);
      if (!p) throw new Error("Provider không tồn tại.");
      const modelId = cmd.modelId || p.models[0];
      if (!modelId || !p.models.includes(modelId))
        throw new Error("Chọn ít nhất một model trước khi kiểm tra.");
      try {
        await providerChat(
          p,
          { providerId: p.id, modelId },
          [{ role: "user", content: "Chỉ trả lời OK." }],
          undefined,
          {
            onKeyChange: (provider, key) =>
              rememberProviderKey(vault, provider, key),
          },
        );
        await vault.mutate((s) => {
          const current = s.ai.providers.find((x) => x.id === p.id);
          if (
            current &&
            current.baseUrl === p.baseUrl &&
            current.apiKey === p.apiKey &&
            current.allowRemote === p.allowRemote
          ) {
            current.testStatus = "ok";
            current.testedAt = Date.now();
          }
        });
      } catch (e) {
        await vault.mutate((s) => {
          const current = s.ai.providers.find((x) => x.id === p.id);
          if (current) {
            current.testStatus = "error";
            current.testedAt = Date.now();
          }
        });
        changed();
        throw e;
      }
      engine.report(`Provider kết nối thành công · ${modelId}.`);
      break;
    }
    case "provider.remove":
      engine.pause();
      await vault.mutate((s) => {
        s.ai.providers = s.ai.providers.filter((p) => p.id !== cmd.providerId);
        if (s.ai.default?.providerId === cmd.providerId) s.ai.default = null;
        for (const key of ["summary", "knowledge", "reply"] as const)
          if (s.ai.tasks[key]?.providerId === cmd.providerId)
            s.ai.tasks[key] = null;
      });
      break;
    case "ai.save":
      await engine.configure(() =>
        vault.mutate((s) => {
          const next = { ...s.ai, ...cmd.config };
          validateSelections(next);
          s.ai = next;
        }),
      );
      engine.report("Đã lưu model mặc định và model cho từng tác vụ.");
      break;
    case "profile.save": {
      engine.pause();
      const p: DOMProfile = cmd.profile;
      if (p.verified) {
        let valid = false;
        for (const t of browsers.list()) {
          const a = browsers.account(t.accountId);
          if (a.platform !== p.platform) continue;
          const result = await browsers.inspect(t.id, p);
          const expected = threadIdentity(result.url, a.platform);
          if (
            expected &&
            result.threadId === expected &&
            result.messages.length > 0 &&
            result.invalid === 0 &&
            result.composerPresent &&
            result.messages.every((m: { direction: string }) =>
              ["incoming", "outgoing"].includes(m.direction),
            )
          )
            valid = true;
        }
        if (!valid)
          throw new Error(
            "Chưa thể verify: tab phải có ID đúng, hướng và timestamp đầy đủ.",
          );
      }
      await vault.mutate((s) => {
        s.profiles[p.platform] = p;
      });
      engine.report(
        p.verified
          ? "Profile đã qua kiểm tra dữ liệu; thử nháp trước khi bật auto."
          : "Đã lưu profile chưa verify.",
      );
      break;
    }
    case "conversation.add": {
      const a = browsers.account(cmd.accountId),
        platformId = threadIdentity(cmd.url, a.platform);
      if (!platformId)
        throw new Error("URL phải định danh đúng thread Messenger cá nhân.");
      await vault.mutate((s) => {
        if (
          s.conversations.some(
            (c) => c.accountId === a.id && c.platformId === platformId,
          )
        )
          throw new Error("Hội thoại đã có.");
        s.conversations.push({
          id: randomUUID(),
          accountId: a.id,
          platformId,
          name: cmd.name,
          url: cmd.url,
          messages: [],
          initialized: false,
          autoReply: null,
          pendingIds: [],
          summary: { text: "", coveredIds: [], revision: 0 },
        });
      });
      break;
    }
    case "conversation.auto":
      await engine.setConversationAuto(cmd.conversationId, cmd.enabled);
      break;
    case "knowledge.add":
    case "knowledge.update":
    case "knowledge.remove":
    case "knowledge.import":
      await vault.mutate((s) => applyKnowledgeCommand(s, cmd));
      engine.report(
        cmd.type === "knowledge.remove"
          ? "Đã xóa nguồn tri thức."
          : "Đã lưu tri thức.",
      );
      break;
    case "draft.generate":
      await engine.generate(cmd.conversationId, cmd.goal);
      break;
    case "draft.discard":
      await vault.mutate((s) => {
        const d = s.drafts.find((d) => d.id === cmd.draftId);
        if (!d || !["draft", "stale", "sent"].includes(d.status))
          throw new Error("Không thể bỏ tin đang gửi hoặc chưa rõ kết quả.");
        if (d.status === "draft") d.status = "stale";
      });
      break;
    case "draft.resolve":
      engine.pause();
      await vault.mutate((s) => {
        const d = s.drafts.find((d) => d.id === cmd.draftId);
        if (!d || d.status !== "uncertain")
          throw new Error("Chỉ giải quyết lần gửi chưa rõ kết quả.");
        d.status = cmd.outcome;
        // Resolution is explicit; neither outcome may cause an automatic retry.
        const c = s.conversations.find((c) => c.id === d.conversationId)!;
        c.pendingIds = c.pendingIds.filter((id) => !d.triggerIds.includes(id));
      });
      engine.report("Đã ghi nhận kết quả kiểm tra thủ công; không tự gửi lại.");
      break;
    case "draft.send":
      await engine.send(cmd.draftId, cmd.text);
      break;
  }
  changed();
  return snapshot();
}
app.whenReady().then(async () => {
  try {
    vault = new Vault(
      path.join(app.getPath("userData"), "secure"),
      safeStorage,
    );
    await vault.open();
    main = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 1050,
      minHeight: 720,
      backgroundColor: "#f4f6fb",
      title: "Master Chat",
      webPreferences: {
        preload: path.join(__dirname, "../preload/preload.js"),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    main.webContents.on("will-navigate", (e) => e.preventDefault());
    main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    browsers = new Browsers(main, vault, changed, (reason) =>
      engine?.pause(reason),
    );
    engine = new Engine(vault, browsers, changed);
    const reconnect = () => {
      browsers.invalidateSync();
      void engine.refreshSync();
    };
    powerMonitor.on("resume", reconnect);
    main.on("focus", () => void engine.refreshSync());
    ipcMain.handle("app:snapshot", (e) => {
      trusted(e);
      return snapshot();
    });
    ipcMain.handle("app:command", (e, input) => {
      trusted(e);
      return execute(commands.parse(input) as Command);
    });
    ipcMain.handle("knowledge:documents", async (e, input) => {
      trusted(e);
      if (input !== undefined) {
        const files = z
          .array(
            z
              .object({
                name: z.string().min(1).max(255),
                data: z
                  .instanceof(Uint8Array)
                  .refine(
                    (data) => data.byteLength <= MAX_DOCUMENT_BYTES,
                    "File vượt quá 20 MB.",
                  ),
              })
              .strict(),
          )
          .max(MAX_DOCUMENT_FILES)
          .parse(input);
        return readDocumentUploads(files);
      }
      if (!main) throw new Error("Cửa sổ chưa sẵn sàng.");
      const choice = await dialog.showOpenDialog(main, {
        title: "Nhập tài liệu vào kho tri thức",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Tài liệu", extensions: DOCUMENT_EXTENSIONS }],
      });
      return choice.canceled ? [] : readDocumentFiles(choice.filePaths);
    });
    ipcMain.handle("browser:bounds", (e, input) => {
      trusted(e);
      const bounds = z
        .object({
          x: z.number().int().min(0).max(10000),
          y: z.number().int().min(0).max(10000),
          width: z.number().int().min(0).max(10000),
          height: z.number().int().min(0).max(10000),
        })
        .strict()
        .nullable()
        .parse(input);
      browsers.setBounds(bounds);
    });
    main.on("close", () => {
      powerMonitor.removeListener("resume", reconnect);
      engine.shutdown();
      browsers.shutdown();
    });
    main.on("closed", () => {
      main = null;
    });
    if (process.env.ELECTRON_RENDERER_URL)
      await main.loadURL(process.env.ELECTRON_RENDERER_URL);
    else await main.loadFile(path.join(__dirname, "../renderer/index.html"));
    engine.startSync();
  } catch (e) {
    dialog.showErrorBox(
      "Không mở được Master Chat",
      e instanceof Error ? e.message : "Không đọc được vault.",
    );
    app.quit();
  }
});
app.on("window-all-closed", () => app.quit());
