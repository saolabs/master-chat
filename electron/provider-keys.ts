import type { AIProvider } from "../src/core/types.ts";
import { activeKeyIndex, providerKeys } from "../src/core/provider-keys.ts";
import type { Vault } from "./vault.ts";

export type KeyOptions = {
  onKeyChange?: (provider: AIProvider, key: string) => Promise<void>;
  // Shared by the primary and fallback model to avoid retrying exhausted keys.
  failedKeys?: Map<string, Set<string>>;
};

// Some providers use HTTP 400 for invalid keys or depleted credit. Never echo
// their error payload, which may contain credentials or conversation content.
export async function providerHTTPError(response: Response, message: string) {
  let retryKey = false;
  if (response.status === 400) {
    const reader = response.body?.getReader();
    if (reader) {
      try {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (size <= 16000) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size <= 16000) chunks.push(value);
        }
        if (size <= 16000) {
          const error = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ).error;
          const details = [
            error?.code,
            error?.type,
            error?.message,
            ...(Array.isArray(error?.details)
              ? error.details.map(
                  (detail: { reason?: string }) => detail.reason,
                )
              : []),
          ]
            .filter((value) => typeof value === "string")
            .join(" ");
          retryKey =
            /invalid_api_key|api_key_invalid|api key (?:is )?(?:not valid|invalid|expired)|insufficient_quota|quota_exceeded|credit balance.*(?:low|exhausted)|insufficient (?:credit|balance)/i.test(
              details,
            );
        }
      } catch {
        // Unreadable bodies do not change the retry policy.
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
  }
  return Object.assign(new Error(message), {
    status: response.status,
    retryKey,
  });
}

export async function rememberProviderKey(
  vault: Vault,
  provider: AIProvider,
  key: string,
) {
  await vault.mutate((state) => {
    const current = state.ai.providers.find((p) => p.id === provider.id);
    if (
      !current ||
      current.type !== provider.type ||
      current.baseUrl !== provider.baseUrl ||
      current.enabled !== provider.enabled ||
      current.allowRemote !== provider.allowRemote ||
      activeKeyIndex(current) !== activeKeyIndex(provider) ||
      JSON.stringify(providerKeys(current)) !==
        JSON.stringify(providerKeys(provider))
    )
      return;
    const index = providerKeys(current).indexOf(key);
    if (index >= 0) current.activeApiKeyIndex = index;
  });
}

export async function withProviderKeys<T>(
  provider: AIProvider,
  operation: (selected: AIProvider) => Promise<T>,
  signal?: AbortSignal,
  options?: KeyOptions,
): Promise<T> {
  const keys = providerKeys(provider);
  const start = activeKeyIndex(provider);
  const failed = options?.failedKeys?.get(provider.id) ?? new Set<string>();
  options?.failedKeys?.set(provider.id, failed);
  let lastError: unknown = new Error("Đã thử hết API key của provider.");
  const remember = async (index: number) => {
    if (index === activeKeyIndex(provider)) return;
    await options?.onKeyChange?.(provider, keys[index]);
    provider.activeApiKeyIndex = index;
  };
  for (let attempt = 0; attempt < Math.max(keys.length, 1); attempt++) {
    signal?.throwIfAborted();
    const index = keys.length ? (start + attempt) % keys.length : 0;
    const key = keys[index] ?? "";
    if (failed.has(key)) continue;
    let result: T;
    try {
      result = await operation({ ...provider, apiKey: key });
    } catch (error) {
      if (signal?.aborted || (error as Error)?.name === "AbortError")
        throw error;
      const { status, retryKey } = (error ?? {}) as {
        status?: number;
        retryKey?: boolean;
      };
      if (
        !retryKey &&
        ![401, 402, 403, 408, 429].includes(status ?? 0) &&
        !(status && status >= 500)
      )
        throw error;
      lastError = error;
      failed.add(key);
      if (keys.length) await remember((index + 1) % keys.length);
      continue;
    }
    signal?.throwIfAborted();
    if (keys.length) await remember(index);
    return result;
  }
  throw lastError;
}
