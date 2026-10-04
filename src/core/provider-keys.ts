import type { AIProvider } from "./types.ts";

export function providerKeys(provider: Pick<AIProvider, "apiKey" | "apiKeys">) {
  return [
    ...new Set(
      (provider.apiKeys ?? [provider.apiKey])
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
}

export function activeKeyIndex(provider: AIProvider) {
  const count = providerKeys(provider).length;
  const index = provider.activeApiKeyIndex ?? 0;
  return Number.isInteger(index) && index >= 0 && index < count ? index : 0;
}
