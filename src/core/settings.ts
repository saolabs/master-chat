import type { AIConfig, AIProvider, Account } from "./types.ts";

export function updateAccount(
  existing: Account,
  input: Pick<Account, "name" | "platform" | "username" | "password"> & {
    recoveryPin?: string;
    clearRecoveryPin?: boolean;
    autoRestorePin?: boolean;
  },
) {
  if (existing.platform !== input.platform)
    throw new Error(
      "Không đổi nền tảng của tài khoản đã lưu; hãy tạo tài khoản riêng.",
    );
  if (input.recoveryPin && !/^\d{6}$/.test(input.recoveryPin))
    throw new Error("PIN Messenger cần đúng 6 chữ số.");
  existing.name = input.name;
  existing.username = input.username;
  if (input.password) existing.password = input.password;
  if (input.clearRecoveryPin) {
    delete existing.recoveryPin;
    existing.autoRestorePin = false;
    existing.pinAutoFillBlocked = false;
  } else {
    if (input.recoveryPin) {
      existing.recoveryPin = input.recoveryPin;
      existing.pinAutoFillBlocked = false;
    }
    if (input.autoRestorePin !== undefined) {
      if (input.autoRestorePin && !existing.autoRestorePin)
        existing.pinAutoFillBlocked = false;
      existing.autoRestorePin =
        input.autoRestorePin && Boolean(existing.recoveryPin);
    }
  }
}

export function saveProvider(
  config: AIConfig,
  input: Omit<AIProvider, "availableModels" | "testedAt" | "testStatus">,
  clearApiKey = false,
) {
  const old = config.providers.find((p) => p.id === input.id);
  if (old && old.type !== input.type)
    throw new Error("Loại provider không được đổi khi sửa.");
  const apiKey = clearApiKey ? "" : input.apiKey || old?.apiKey || "";
  const endpointChanged =
    old &&
    (old.baseUrl !== input.baseUrl ||
      apiKey !== old.apiKey ||
      old.allowRemote !== input.allowRemote);
  const provider: AIProvider = {
    ...input,
    models: [...new Set(input.models)],
    apiKey,
    availableModels: endpointChanged ? [] : (old?.availableModels ?? []),
    testedAt: endpointChanged ? undefined : old?.testedAt,
    testStatus: endpointChanged ? undefined : old?.testStatus,
  };
  if (old) config.providers[config.providers.indexOf(old)] = provider;
  else config.providers.push(provider);
  for (const key of ["summary", "knowledge", "reply"] as const) {
    const choice = config.tasks[key];
    if (
      choice?.providerId === provider.id &&
      (!provider.enabled || !provider.models.includes(choice.modelId))
    )
      config.tasks[key] = null;
  }
  if (
    config.default?.providerId === provider.id &&
    (!provider.enabled || !provider.models.includes(config.default.modelId))
  )
    config.default = null;
}
