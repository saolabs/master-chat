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
  inboxOrder?: string[];
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
  attachments?: Attachment[];
};
export type Attachment = {
  id: string;
  kind: "image" | "audio";
  source?: string;
  label?: string;
  analysis?: string;
  error?: string;
  analyzedAt?: number;
};
export type LearnedStyle = {
  instructions: string;
  sampleIds: string[];
  sampleCount: number;
  updatedAt: number;
};
export type ProfileObservation = { detail: string; evidenceIds: string[] };
export type ContactProfile = {
  version: 1;
  relationship: ProfileObservation | null;
  address: ProfileObservation | null;
  style: ProfileObservation | null;
  facts: ProfileObservation[];
  cautions: string[];
  sourceIds: string[];
  sourceHashes: Record<string, string>;
  messageCount: number;
  ownerMessageCount: number;
  updatedAt: number;
};
export type ReplyReview = {
  status: "approved" | "revised" | "held" | "unavailable" | "skipped";
  issues: string[];
  model?: ModelSelection;
  originalText?: string;
  reviewedText?: string;
  checkedAt: number;
};
export type ResponseSettings = {
  aboutMe?: string;
  personality?: string;
  instructions?: string;
  learnStyle?: boolean;
  providerCache?: boolean;
  review?: { enabled?: boolean; model?: ModelSelection | null };
  media?: {
    enabled?: boolean;
    imageModel?: ModelSelection | null;
    audioModel?: ModelSelection | null;
    transcription?: TranscriptionSettings;
  };
  typing?: {
    enabled?: boolean;
    charactersPerMinute?: number;
    thinkingMs?: number;
    maxDelayMs?: number;
  };
};
export type TranscriptionSettings = {
  mode?: "local" | "provider";
  executable?: string;
  modelPath?: string;
  ffmpegPath?: string;
  language?: string;
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
  inboxPreview?: string;
  inboxUnread?: boolean;
  responseStyle?: string;
  learnStyle?: boolean;
  learnedStyle?: LearnedStyle;
  contactProfile?: ContactProfile;
  relationshipContext?: string;
  conversationDirection?: string;
  profileAttemptKey?: string;
  profileError?: string;
};
export type Draft = {
  id: string;
  conversationId: string;
  text: string;
  basedOnId: string | null;
  triggerIds: string[];
  proactive: boolean;
  automatic?: boolean;
  origin?: "manual" | "ai";
  review?: ReplyReview;
  sendAfter?: number;
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
  apiKeys?: string[];
  activeApiKeyIndex?: number;
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
  providers: (Omit<AIProvider, "apiKey" | "apiKeys"> & {
    hasApiKey: boolean;
    apiKeyCount?: number;
  })[];
};
export type Knowledge = {
  id: string;
  title: string;
  text: string;
  accountId: string | null;
  fileName?: string;
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
  response?: ResponseSettings;
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
    conversations: state.conversations.map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({
        ...m,
        ...(m.attachments
          ? { attachments: m.attachments.map(({ source, ...a }) => a) }
          : {}),
      })),
    })),
    accounts: state.accounts.map(
      ({ password, cookies, recoveryPin, ...account }) => ({
        ...account,
        hasPassword: Boolean(password),
        hasRecoveryPin: Boolean(recoveryPin),
      }),
    ),
    ai: {
      ...state.ai,
      providers: state.ai.providers.map(({ apiKey, apiKeys, ...provider }) => ({
        ...provider,
        hasApiKey: Boolean(apiKeys?.length || apiKey),
        apiKeyCount: apiKeys?.length ?? (apiKey ? 1 : 0),
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
  replying?: string[];
  data: PublicState;
  tabs: BrowserTab[];
  paused: boolean;
  pauseReason?: string;
  live?: {
    conversationId: string | null;
    updatedAt: number | null;
    error?: string;
  };
  notice: string;
  monitors?: MonitorStatus[];
};
export type InboxThread = {
  platformId: string;
  name: string;
  url: string;
  unread: boolean;
  signature: string;
  preview?: string;
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
  | { type: "conversation.watch"; conversationId: string | null }
  | { type: "conversation.composing"; conversationId: string; active: boolean }
  | { type: "account.auto"; accountId: string; enabled: boolean }
  | { type: "automation.all"; enabled: boolean }
  | { type: "draft.review"; draftId: string; text: string }
  | {
      type: "conversation.send";
      conversationId: string;
      text: string;
      basedOnId: string | null;
    }
  | {
      type: "provider.save";
      provider: Omit<AIProvider, "availableModels" | "testedAt" | "testStatus">;
      clearApiKey?: boolean;
      removeApiKeyIndexes?: number[];
    }
  | {
      type: "provider.models" | "provider.test" | "provider.remove";
      providerId: string;
      modelId?: string;
    }
  | { type: "ai.save"; config: Pick<AIConfig, "default" | "tasks"> }
  | { type: "response.save"; settings: ResponseSettings }
  | {
      type: "conversation.style";
      conversationId: string;
      style?: string;
      learnStyle?: boolean;
      relationshipContext?: string;
      conversationDirection?: string;
    }
  | {
      type: "style.learn" | "media.retry" | "conversation.backfill";
      conversationId: string;
    }
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
  | {
      type: "knowledge.update";
      knowledgeId: string;
      title: string;
      text: string;
      accountId: string | null;
    }
  | { type: "knowledge.remove"; knowledgeId: string }
  | {
      type: "knowledge.import";
      sources: { title: string; text: string; fileName: string }[];
      accountId: string | null;
    }
  | { type: "draft.generate"; conversationId: string; goal?: string }
  | { type: "draft.resolve"; draftId: string; outcome: "sent" | "stale" }
  | { type: "draft.discard"; draftId: string }
  | { type: "draft.send"; draftId: string; text: string };
export type Bridge = {
  importDocuments(files?: DocumentUpload[]): Promise<DocumentImport[]>;
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<Snapshot>;
  bounds(
    bounds: { x: number; y: number; width: number; height: number } | null,
  ): Promise<void>;
  onChange(callback: () => void): () => void;
};
export type DocumentUpload = { name: string; data: Uint8Array };
export type DocumentImport =
  | { fileName: string; title: string; text: string; error?: never }
  | { fileName: string; error: string; title?: never; text?: never };
