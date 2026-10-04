import type {
  AIConfig,
  AIProvider,
  ModelSelection,
  Role,
  ProviderType,
} from "./types.ts";

export const PROVIDER_CATALOG: Record<
  ProviderType,
  { label: string; baseUrl: string }
> = {
  ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  openai_compatible: {
    label: "OpenAI compatible",
    baseUrl: "http://127.0.0.1:8000/v1",
  },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  google: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  nvidia: { label: "NVIDIA", baseUrl: "https://integrate.api.nvidia.com/v1" },
};
export function providerURL(
  provider: Pick<AIProvider, "baseUrl">,
  allowRemote = false,
): URL {
  const url = new URL(provider.baseUrl);
  // Normalize localhost to a literal loopback address; avoid DNS resolution for local-only AI.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  const local = ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Base URL AI không hợp lệ.");
  if (!local && !allowRemote)
    throw new Error(
      "Chế độ riêng tư chỉ cho phép AI chạy trên máy. Provider cloud cần được cho phép riêng.",
    );
  if (!local && url.protocol !== "https:")
    throw new Error("Provider từ xa cần HTTPS.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}
export function resolveModel(
  config: AIConfig,
  role: Role,
): { provider: AIProvider; selection: ModelSelection } {
  const selection = config.tasks[role] ?? config.default;
  if (!selection)
    throw new Error(`Chưa chọn model cho ${role} hoặc model mặc định.`);
  const provider = config.providers.find((p) => p.id === selection.providerId);
  if (!provider?.enabled)
    throw new Error(
      "Provider đã bị tắt hoặc không còn tồn tại; hãy chọn lại model.",
    );
  if (!provider.models.includes(selection.modelId))
    throw new Error("Model chưa được bật trong provider; hãy chọn lại model.");
  providerURL(provider, provider.allowRemote);
  return { provider, selection };
}
export function validateSelections(config: AIConfig) {
  for (const selection of [config.default, ...Object.values(config.tasks)]) {
    if (!selection) continue;
    const p = config.providers.find((p) => p.id === selection.providerId);
    if (!p?.enabled || !p.models.includes(selection.modelId))
      throw new Error("Model đã chọn không thuộc provider đang bật.");
    providerURL(p, p.allowRemote);
  }
}
export function migrateAI(value: unknown): AIConfig {
  const old = value as AIConfig & {
    baseUrl?: string;
    defaultModel?: string;
    models?: Record<Role, string>;
  };
  if (Array.isArray(old.providers)) return old;
  const models = [
    ...new Set(
      [old.defaultModel, ...Object.values(old.models ?? {})].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  ];
  const provider: AIProvider = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "AI local",
    type: "openai_compatible",
    baseUrl: old.baseUrl || PROVIDER_CATALOG.ollama.baseUrl,
    apiKey: "",
    enabled: true,
    allowRemote: false,
    models,
    availableModels: [],
  };
  const choose = (modelId?: string) =>
    modelId ? { providerId: provider.id, modelId } : null;
  return {
    providers: [provider],
    default: choose(old.defaultModel),
    tasks: {
      summary: choose(old.models?.summary),
      knowledge: choose(old.models?.knowledge),
      reply: choose(old.models?.reply),
    },
  };
}
