import { randomUUID } from "node:crypto";
import type { InboxScan, State } from "./types.ts";
// Unread labels and list position never authorize sending. Only timestamps beyond the persisted cutoff do.
export function reconcileInbox(
  state: State,
  accountId: string,
  scan: InboxScan,
): { added: string[]; priority: string[] } {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Tài khoản không tồn tại.");
  const hadBaseline = Boolean(account.inboxInitialized);
  account.monitorStartedAt ??= scan.scannedAt;
  const added: string[] = [],
    priority: string[] = [];
  for (const thread of scan.threads) {
    let c = state.conversations.find(
      (c) => c.accountId === accountId && c.platformId === thread.platformId,
    );
    if (!c) {
      c = {
        id: randomUUID(),
        accountId,
        platformId: thread.platformId,
        name: thread.name,
        url: thread.url,
        messages: [],
        initialized: false,
        autoReply: Boolean(account.autoDiscoverReply),
        pendingIds: [],
        summary: { text: "", coveredIds: [], revision: 0 },
        discoveredAt: scan.scannedAt,
      };
      state.conversations.push(c);
      added.push(c.id);
      // After an inbox baseline, the first visit can accept only messages demonstrably newer than cutoff.
      // This flag still cannot turn an old unread message into a new one.
      if (hadBaseline) c.initialized = true;
    } else {
      c.url = thread.url;
      if (thread.name) c.name = thread.name;
    }
    if (thread.unread || c.lastInboxSignature !== thread.signature)
      priority.push(c.id);
    c.lastInboxSignature = thread.signature;
  }
  account.inboxInitialized = true;
  return { added, priority };
}
