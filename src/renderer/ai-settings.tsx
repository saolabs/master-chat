import React, { useEffect, useState } from "react";
import type {
  Command,
  Snapshot,
  AIProvider,
  PublicAIConfig,
  ModelSelection,
  Role,
  ProviderType,
} from "../core/types.ts";
import { PROVIDER_CATALOG } from "../core/ai-config.ts";
import llmModels from "../../llm-models.json";
type Runner = (command: Command) => Promise<Snapshot | null>;
type SafeProvider = PublicAIConfig["providers"][number];
const TASKS: [Role, string, string][] = [
  [
    "summary",
    "Tóm tắt ngữ cảnh",
    "Cập nhật ngữ cảnh từ các tin nhắn ra khỏi cửa sổ gần nhất.",
  ],
  [
    "knowledge",
    "Nghiên cứu tri thức",
    "Chọn thông tin liên quan trong kho tri thức để hỗ trợ phản hồi.",
  ],
  [
    "reply",
    "Sinh tin nhắn phản hồi",
    "Viết phản hồi theo lịch sử và cách xưng hô của hội thoại.",
  ],
];
export function AISettings({
  config,
  busy,
  run,
}: {
  config: PublicAIConfig;
  busy: boolean;
  run: Runner;
}) {
  const [section, setSection] = useState<"providers" | "tasks">("providers");
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="ai-settings">
      <div className="section-heading">
        <div>
          <h2>Provider & model AI</h2>
          <p>
            Quản lý kết nối, chọn model sử dụng và phân công cho từng tác vụ.
          </p>
        </div>
        <span className="chip">{config.providers.length} provider</span>
      </div>
      <div className="settings-tabs">
        <button
          className={section === "providers" ? "active" : ""}
          onClick={() => setSection("providers")}
        >
          Provider
        </button>
        <button
          className={section === "tasks" ? "active" : ""}
          onClick={() => setSection("tasks")}
        >
          Model theo tác vụ
        </button>
      </div>
      {section === "providers" ? (
        <>
          <div className="section-heading">
            <p>
              API key được lưu mã hóa. Nội dung hội thoại chỉ gửi tới provider
              cloud khi bạn bật quyền riêng của provider đó.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => setEditing("new")}
            >
              + Thêm provider
            </button>
          </div>
          {editing !== null && (
            <ProviderEditor
              key={editing}
              provider={config.providers.find((p) => p.id === editing)}
              latest={config.providers}
              busy={busy}
              run={run}
              close={() => setEditing(null)}
            />
          )}
          <div className="provider-grid">
            {config.providers.map((p) => (
              <article className="card provider-card" key={p.id}>
                <div className="section-heading">
                  <div>
                    <h3>{p.name}</h3>
                    <small>{PROVIDER_CATALOG[p.type].label}</small>
                  </div>
                  <span className="chip">
                    {p.enabled ? "Đang bật" : "Đã tắt"}
                  </span>
                </div>
                <p className="provider-url">{p.baseUrl}</p>
                <p>
                  {p.models.length} model đã chọn ·{" "}
                  {p.hasApiKey ? "Đã lưu API key" : "Không có API key"}
                </p>
                <small>
                  {p.allowRemote
                    ? "Cho phép gửi ngữ cảnh tới endpoint đã cấu hình"
                    : "Chỉ kết nối AI trên máy"}
                  {p.testedAt
                    ? ` · ${p.testStatus === "ok" ? "Kết nối OK" : "Kiểm tra thất bại"}`
                    : ""}
                </small>
                <div className="inline">
                  <button disabled={busy} onClick={() => setEditing(p.id)}>
                    Chỉnh sửa
                  </button>
                  <button
                    disabled={busy || !p.models.length || !p.enabled}
                    onClick={() =>
                      void run({ type: "provider.test", providerId: p.id })
                    }
                  >
                    Kiểm tra
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({ type: "provider.remove", providerId: p.id })
                    }
                  >
                    Xóa cấu hình
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!config.providers.length && editing === null && (
            <div className="card empty">
              <h3>Chưa có provider</h3>
              <p>
                Thêm provider rồi chọn model có sẵn trong catalog hoặc tải danh
                sách từ endpoint của bạn.
              </p>
            </div>
          )}
        </>
      ) : (
        <TaskMatrix
          key={JSON.stringify([config.default, config.tasks])}
          config={config}
          busy={busy}
          run={run}
        />
      )}
    </div>
  );
}
function ProviderEditor({
  provider,
  latest,
  busy,
  run,
  close,
}: {
  provider?: SafeProvider;
  latest: SafeProvider[];
  busy: boolean;
  run: Runner;
  close: () => void;
}) {
  const [value, setValue] = useState<
    Omit<AIProvider, "availableModels" | "testedAt" | "testStatus">
  >(() =>
    provider
      ? {
          id: provider.id,
          name: provider.name,
          type: provider.type,
          baseUrl: provider.baseUrl,
          apiKey: "",
          enabled: provider.enabled,
          allowRemote: provider.allowRemote,
          models: provider.models,
        }
      : {
          id: crypto.randomUUID(),
          name: "Ollama",
          type: "ollama",
          baseUrl: PROVIDER_CATALOG.ollama.baseUrl,
          apiKey: "",
          enabled: true,
          allowRemote: false,
          models: [],
        },
  );
  const [catalog, setCatalog] = useState(provider?.availableModels ?? []),
    [filter, setFilter] = useState(""),
    [custom, setCustom] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [saved, setSaved] = useState(Boolean(provider));
  useEffect(() => {
    const p = latest.find((p) => p.id === value.id);
    if (p) setCatalog(p.availableModels);
  }, [latest, value.id]);
  async function save() {
    const result = await run({
      type: "provider.save",
      provider: value,
      clearApiKey: clearKey,
    });
    if (result) {
      setValue((v) => ({ ...v, apiKey: "" }));
      setClearKey(false);
      setSaved(true);
    }
    return result;
  }
  async function loadModels() {
    if (await save())
      await run({ type: "provider.models", providerId: value.id });
  }
  async function test() {
    if (await save())
      await run({ type: "provider.test", providerId: value.id });
  }
  const catalogProvider = value.type === "google" ? "gemini" : value.type;
  const curated =
    llmModels
      .find((p) => p.provider === catalogProvider)
      ?.models.filter((m) => !m.name.includes("-image")) ?? [];
  const descriptions = new Map(curated.map((m) => [m.name, m.description]));
  const availableIds = new Set([...curated.map((m) => m.name), ...catalog]);
  const ids = [...new Set([...value.models, ...availableIds])].filter((id) =>
    id.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="card provider-editor">
      <div className="section-heading">
        <h3>{provider ? "Chỉnh sửa provider" : "Thêm provider"}</h3>
        <button disabled={busy} onClick={close}>
          Đóng
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save()) close();
        }}
      >
        <div className="field-grid">
          <label>
            Loại provider
            <select
              value={value.type}
              disabled={Boolean(provider) || saved}
              onChange={(e) => {
                const type = e.target.value as ProviderType;
                setValue((v) => ({
                  ...v,
                  type,
                  name: PROVIDER_CATALOG[type].label,
                  baseUrl: PROVIDER_CATALOG[type].baseUrl,
                  allowRemote: false,
                  models: [],
                }));
                setCatalog([]);
                setFilter("");
                setCustom("");
              }}
            >
              {Object.entries(PROVIDER_CATALOG).map(([type, m]) => (
                <option key={type} value={type}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tên hiển thị
            <input
              required
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          </label>
        </div>
        <label>
          Base URL
          <input
            required
            type="url"
            value={value.baseUrl}
            onChange={(e) => {
              setValue({ ...value, baseUrl: e.target.value });
              setCatalog([]);
            }}
          />
        </label>
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            value={value.apiKey}
            onChange={(e) => setValue({ ...value, apiKey: e.target.value })}
            placeholder={
              latest.find((p) => p.id === value.id)?.hasApiKey
                ? "Đã lưu key · để trống để giữ nguyên"
                : "Không bắt buộc với server local"
            }
          />
        </label>
        {latest.find((p) => p.id === value.id)?.hasApiKey && (
          <label className="check">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(e) => setClearKey(e.target.checked)}
            />
            Xóa API key đã lưu
          </label>
        )}
        <div className="field-grid">
          <label className="check">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(e) =>
                setValue({ ...value, enabled: e.target.checked })
              }
            />
            Bật provider
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.allowRemote}
              onChange={(e) =>
                setValue({ ...value, allowRemote: e.target.checked })
              }
            />
            Cho phép AI cloud cho provider này
          </label>
        </div>
        {value.allowRemote && (
          <p className="hint">
            Khi dùng model của provider này, lịch sử tin nhắn, tóm tắt và tri
            thức liên quan sẽ gửi trực tiếp tới endpoint trên. Không đi qua
            server Master Chat.
          </p>
        )}
        <div className="section-heading">
          <div>
            <h3>Model sử dụng</h3>
            <small>
              {curated.length
                ? `Catalog ${PROVIDER_CATALOG[value.type].label} · ${curated.length} model có sẵn`
                : "Tải danh sách model đang có trên endpoint của bạn."}
            </small>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadModels()}
          >
            Lưu & tải danh sách model
          </button>
        </div>
        <p className="model-catalog-hint">
          {curated.length
            ? "Tích chọn model muốn sử dụng. Catalog có sẵn từ SEO Expert; quyền sử dụng tùy tài khoản. Có thể tải thêm model từ endpoint."
            : "Provider này dùng danh sách model do endpoint của bạn cung cấp."}
          {catalog.length > 0 && ` Đã tải ${catalog.length} model từ endpoint.`}
        </p>
        <input
          aria-label="Tìm model"
          placeholder="Tìm trong danh sách model…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="model-grid">
          {ids.map((id) => (
            <label
              className={`check model-option${value.models.includes(id) ? " selected" : ""}`}
              key={id}
            >
              <input
                type="checkbox"
                disabled={busy}
                checked={value.models.includes(id)}
                onChange={(e) =>
                  setValue({
                    ...value,
                    models: e.target.checked
                      ? [...value.models, id]
                      : value.models.filter((m) => m !== id),
                  })
                }
              />
              <span>
                <strong>{id}</strong>
                {descriptions.get(id) && <small>{descriptions.get(id)}</small>}
                {!availableIds.has(id) && (
                  <small>Model tùy chỉnh hoặc đã lưu ngoài catalog.</small>
                )}
              </span>
            </label>
          ))}
          {!ids.length && (
            <p>
              {filter
                ? "Không có model khớp bộ lọc."
                : "Tải danh sách để chọn model hoặc thêm ID model bên dưới."}
            </p>
          )}
        </div>
        <div className="inline">
          <input
            aria-label="ID model tùy chỉnh"
            value={custom}
            placeholder="ID model tùy chỉnh"
            onChange={(e) => setCustom(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !custom.trim()}
            onClick={() => {
              setValue({
                ...value,
                models: [...new Set([...value.models, custom.trim()])],
              });
              setCustom("");
            }}
          >
            Thêm model
          </button>
        </div>
        <div className="inline form-actions">
          <button className="primary" disabled={busy}>
            Lưu provider
          </button>
          <button
            type="button"
            disabled={busy || !value.models.length || !value.enabled}
            onClick={() => void test()}
          >
            Lưu & kiểm tra kết nối
          </button>
          <small>{value.models.length} model đã chọn</small>
        </div>
      </form>
    </section>
  );
}
function TaskMatrix({
  config,
  busy,
  run,
}: {
  config: PublicAIConfig;
  busy: boolean;
  run: Runner;
}) {
  const [value, setValue] = useState({
    default: config.default,
    tasks: config.tasks,
  });
  const providers = config.providers.filter(
    (p) =>
      p.enabled &&
      (p.allowRemote ||
        ["127.0.0.1", "[::1]", "localhost"].includes(
          new URL(p.baseUrl).hostname,
        )),
  );
  const encode = (s: ModelSelection | null) =>
    s ? JSON.stringify([s.providerId, s.modelId]) : "";
  const selected = (raw: string, prior: ModelSelection | null) => {
    if (!raw) return null;
    const [providerId, modelId] = JSON.parse(raw);
    return { ...prior, providerId, modelId };
  };
  const rows: ["default" | Role, string, string][] = [
    [
      "default",
      "Model mặc định chung",
      "Dùng cho các tác vụ chưa được gán model riêng.",
    ],
    ...TASKS,
  ];
  const defaultProvider = providers.find(
    (p) => p.id === value.default?.providerId,
  );
  const inherited = defaultProvider
    ? `${defaultProvider.name} · ${value.default?.modelId}`
    : "chưa chọn model mặc định";
  return (
    <form
      className="card task-matrix"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ type: "ai.save", config: value });
      }}
    >
      <h3>Gán model theo tác vụ</h3>
      <p>
        Model riêng ưu tiên hơn model mặc định. Mỗi lựa chọn gồm cả provider và
        model.
      </p>
      {rows.map(([role, name, description]) => {
        const choice = role === "default" ? value.default : value.tasks[role];
        const change = (selection: ModelSelection | null) =>
          setValue((v) =>
            role === "default"
              ? { ...v, default: selection }
              : { ...v, tasks: { ...v.tasks, [role]: selection } },
          );
        return (
          <div className="task-row" key={role}>
            <div>
              <h3>{name}</h3>
              <p>{description}</p>
              {!choice && role !== "default" && (
                <small>Kế thừa: {inherited}</small>
              )}
            </div>
            <div>
              <select
                aria-label={`Model ${name}`}
                value={encode(choice)}
                onChange={(e) => change(selected(e.target.value, choice))}
              >
                <option value="">
                  {role === "default"
                    ? "Chọn provider · model…"
                    : `Kế thừa mặc định · ${inherited}`}
                </option>
                {providers.map((p) => (
                  <optgroup label={p.name} key={p.id}>
                    {p.models.map((modelId) => (
                      <option
                        key={modelId}
                        value={JSON.stringify([p.id, modelId])}
                      >
                        {p.name} · {modelId}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {choice && (
                <div className="field-grid parameters">
                  <label>
                    Temperature
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      placeholder="Mặc định provider"
                      value={choice.temperature ?? ""}
                      onChange={(e) => {
                        const { temperature, ...rest } = choice;
                        change(
                          e.target.value === ""
                            ? rest
                            : {
                                ...choice,
                                temperature: Number(e.target.value),
                              },
                        );
                      }}
                    />
                  </label>
                  <label>
                    Token đầu ra tối đa
                    <input
                      type="number"
                      min="1"
                      max="1000000"
                      placeholder="Mặc định provider"
                      value={choice.maxOutputTokens ?? ""}
                      onChange={(e) => {
                        const { maxOutputTokens, ...rest } = choice;
                        change(
                          e.target.value === ""
                            ? rest
                            : {
                                ...choice,
                                maxOutputTokens: Number(e.target.value),
                              },
                        );
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!providers.some((p) => p.models.length) && (
        <p className="hint">
          Thêm provider, chọn và lưu ít nhất một model trước khi gán tác vụ.
        </p>
      )}
      <button className="primary" disabled={busy}>
        Lưu model theo tác vụ
      </button>
    </form>
  );
}
