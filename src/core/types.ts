export type Platform = "messenger-personal";
export type Role = "summary" | "knowledge" | "reply";
export type Account = {
  id: string;
  name: string;
  platform: Platform;
  username: string;
  password: string;
  recoveryPin?: string;
  autoRestorePin?: boolean;
  pinAutoFillBlocked?: boolean;
  cookies: unknown[];
  facebookUserId?: string;
  inboxInitialized?: boolean;
  autoDiscoverReply?: boolean;
  monitorStartedAt?: number;
};
export type Message = {
  id: string;
  text: string;
  direction: "incoming" | "outgoing" | "system";
  timestamp: number | null;
  observedAt: number;
  baseline: boolean;
  identity?: "platform" | "fingerprint";
  precision?: "exact" | "minute";
};
export type Summary = { text: string; coveredIds: string[]; revision: number };
export type Conversation = {
  id: string;
  accountId: string;
  platformId: string;
  name: string;
  url: string;
  messages: Message[];
  initialized: boolean;
  autoReply: boolean;
  pendingIds: string[];
  summary: Summary;
  discoveredAt?: number;
  diagnostics?: string;
  lastInboxSignature?: string;
};
export type Draft = {
  id: string;
  conversationId: string;
  text: string;
  basedOnId: string | null;
  triggerIds: string[];
  proactive: boolean;
  status: "draft" | "sending" | "sent" | "uncertain" | "stale";
  createdAt: number;
};
export type ProviderType =
  | "ollama"
  | "lmstudio"
  | "openai_compatible"
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "nvidia";
export type AIProvider = {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  allowRemote: boolean;
  models: string[];
  availableModels: string[];
  testedAt?: number;
  testStatus?: "ok" | "error";
};
export type ModelSelection = {
  providerId: string;
  modelId: string;
  temperature?: number;
  maxOutputTokens?: number;
};
export type AIConfig = {
  providers: AIProvider[];
  default: ModelSelection | null;
  tasks: Record<Role, ModelSelection | null>;
};
export type PublicAIConfig = Omit<AIConfig, "providers"> & {
  providers: (Omit<AIProvider, "apiKey"> & { hasApiKey: boolean })[];
};
export type Knowledge = {
  id: string;
  title: string;
  text: string;
  accountId: string | null;
};
export type DOMProfile = {
  version: 1;
  platform: Platform;
  verified: boolean;
  threadSelector: string;
  threadIdAttribute: string;
  messageSelector: string;
  messageIdAttribute: string;
  textSelector: string;
  directionAttribute: string;
  incomingValue: string;
  outgoingValue: string;
  timestampAttribute: string;
  composerSelector: string;
  sendSelector: string;
  listSelector: string;
  linkSelector: string;
};
export type State = {
  version: 1;
  accounts: Account[];
  conversations: Conversation[];
  drafts: Draft[];
  knowledge: Knowledge[];
  ai: AIConfig;
  profiles: Partial<Record<Platform, DOMProfile>>;
  enabledAt: number | null;
};
export function emptyState(): State {
  return {
    version: 1,
    accounts: [],
    conversations: [],
    drafts: [],
    knowledge: [],
    ai: {
      providers: [],
      default: null,
      tasks: { summary: null, knowledge: null, reply: null },
    },
    profiles: {},
    enabledAt: null,
  };
}
export type PublicState = Omit<State, "accounts" | "ai"> & {
  accounts: (Omit<Account, "password" | "cookies" | "recoveryPin"> & {
    hasPassword: boolean;
    hasRecoveryPin: boolean;
  })[];
  ai: PublicAIConfig;
};
export function publicState(state: State): PublicState {
  return {
    ...state,
    accounts: state.accounts.map(
      ({ password, cookies, recoveryPin, ...account }) => ({
        ...account,
        hasPassword: Boolean(password),
        hasRecoveryPin: Boolean(recoveryPin),
      }),
    ),
    ai: {
      ...state.ai,
      providers: state.ai.providers.map(({ apiKey, ...provider }) => ({
        ...provider,
        hasApiKey: Boolean(apiKey),
      })),
    },
  };
}
export type BrowserTab = {
  id: string;
  accountId: string;
  title: string;
  url: string;
  detached: boolean;
  status: string;
};
export type Snapshot = {
  data: PublicState;
  tabs: BrowserTab[];
  paused: boolean;
  notice: string;
  monitors?: MonitorStatus[];
};
export type InboxThread = {
  platformId: string;
  name: string;
  url: string;
  unread: boolean;
  signature: string;
};
export type InboxScan = {
  threads: InboxThread[];
  scannedAt: number;
  coverage: "partial" | "visible";
  revision: number;
};
export type MonitorStatus = {
  accountId: string;
  status: string;
  scannedAt: number | null;
  threadCount: number;
  coverage: "partial" | "visible";
  error?: string;
};
export type Command =
  | {
      type: "account.save";
      id?: string;
      name: string;
      platform: Platform;
      username: string;
      password: string;
      recoveryPin?: string;
      clearRecoveryPin?: boolean;
      autoRestorePin?: boolean;
    }
  | {
      type: "browser.open";
      accountId: string;
      url?: string;
      detached?: boolean;
    }
  | {
      type:
        | "browser.select"
        | "browser.close"
        | "browser.detach"
        | "browser.reload"
        | "browser.inspect"
        | "browser.login";
      tabId: string;
    }
  | { type: "automation.pause" | "automation.resume" }
  | { type: "inbox.sync"; accountId: string }
  | { type: "account.discovery"; accountId: string; enabled: boolean }
  | { type: "conversation.sync"; conversationId: string }
  | {
      type: "provider.save";
      provider: Omit<AIProvider, "availableModels" | "testedAt" | "testStatus">;
      clearApiKey?: boolean;
    }
  | {
      type: "provider.models" | "provider.test" | "provider.remove";
      providerId: string;
      modelId?: string;
    }
  | { type: "ai.save"; config: Pick<AIConfig, "default" | "tasks"> }
  | { type: "profile.save"; profile: DOMProfile }
  | { type: "profile.reset" }
  | { type: "conversation.add"; accountId: string; name: string; url: string }
  | { type: "conversation.auto"; conversationId: string; enabled: boolean }
  | {
      type: "knowledge.add";
      title: string;
      text: string;
      accountId: string | null;
    }
  | { type: "draft.generate"; conversationId: string; goal?: string }
  | { type: "draft.resolve"; draftId: string; outcome: "sent" | "stale" }
  | { type: "draft.send"; draftId: string; text: string };
export type Bridge = {
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<Snapshot>;
  bounds(
    bounds: { x: number; y: number; width: number; height: number } | null,
  ): Promise<void>;
  onChange(callback: () => void): () => void;
};
