import type { Account, Conversation } from "./types.ts";

export function isAutoReplyEnabled(
  conversation: Pick<Conversation, "accountId" | "autoReply">,
  accounts: readonly Pick<Account, "id" | "autoDiscoverReply">[],
): boolean {
  return (
    conversation.autoReply ??
    Boolean(
      accounts.find((a) => a.id === conversation.accountId)?.autoDiscoverReply,
    )
  );
}
