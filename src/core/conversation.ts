import type { Conversation, Message, Summary } from "./types.ts";
import { messageContent } from "./response-style.ts";
export const RECENT_WINDOW = 9;
export function ingest(
  conversation: Conversation,
  observed: Omit<Message, "baseline">[],
  enabledAt: number | null,
): string[] {
  const ids = new Set(conversation.messages.map((m) => m.id));
  for (const raw of observed) {
    const saved = conversation.messages.find((m) => m.id === raw.id);
    if (saved) {
      saved.text = raw.text;
      if (saved.timestamp === null && raw.timestamp !== null) {
        saved.timestamp = raw.timestamp;
        saved.precision = raw.precision;
      }
    }
    if (saved && raw.attachments?.length) {
      if (
        raw.attachments.some(
          (a) => !saved.attachments?.some((old) => old.id === a.id),
        ) &&
        conversation.summary.coveredIds.includes(raw.id)
      ) {
        conversation.summary = {
          text: "",
          coveredIds: [],
          revision: conversation.summary.revision + 1,
        };
      }
      saved.attachments = raw.attachments.map((a) => {
        const old = saved.attachments?.find((x) => x.id === a.id);
        return old
          ? {
              ...old,
              ...a,
              analysis: old.analysis,
              error: old.error,
              analyzedAt: old.analyzedAt,
            }
          : a;
      });
    }
  }
  const initial = !conversation.initialized;
  const fresh = observed
    .filter((m) => !ids.has(m.id) && (ids.add(m.id), true))
    .map((m) => ({ ...m, baseline: initial }));
  conversation.messages.push(...fresh);
  // Browser adapters preserve timeline order; unknown-time raw messages must not jump after the newest incoming.
  // Fully timed profile imports can be sorted safely, while partial semantic timelines keep DOM order.
  if (conversation.messages.every((m) => m.timestamp !== null))
    conversation.messages.sort((a, b) => a.timestamp! - b.timestamp!);
  else {
    // Overlapping DOM reads anchor older, newly discovered context before newer messages.
    const ordered = [...new Set(observed.map((m) => m.id))];
    const freshIds = new Set(fresh.map((m) => m.id));
    for (let n = 0; n < ordered.length; n++) {
      if (!freshIds.has(ordered[n])) continue;
      const next = ordered.slice(n + 1).find((id) => !freshIds.has(id));
      const previous = n > 0 ? ordered[n - 1] : undefined;
      if (!next && !previous) continue;
      const from = conversation.messages.findIndex((m) => m.id === ordered[n]);
      const [message] = conversation.messages.splice(from, 1);
      const anchor = conversation.messages.findIndex(
        (m) => m.id === (next ?? previous),
      );
      conversation.messages.splice(anchor + (next ? 0 : 1), 0, message);
    }
    for (let n = ordered.length - 2; n >= 0; n--) {
      const from = conversation.messages.findIndex((m) => m.id === ordered[n]);
      const before = conversation.messages.findIndex(
        (m) => m.id === ordered[n + 1],
      );
      if (from > before && before >= 0) {
        const [message] = conversation.messages.splice(from, 1);
        conversation.messages.splice(before, 0, message);
      }
    }
  }
  conversation.initialized = true;
  const eligible = fresh.filter(
    (m) =>
      !m.baseline &&
      m.direction === "incoming" &&
      m.timestamp !== null &&
      enabledAt !== null &&
      m.timestamp > enabledAt &&
      m.timestamp <= m.observedAt + 60_000,
  );
  conversation.pendingIds = [
    ...new Set([...conversation.pendingIds, ...eligible.map((m) => m.id)]),
  ];
  const outgoingIndex = conversation.messages.findLastIndex(
    (m) => m.direction === "outgoing",
  );
  const afterOutgoing = new Set(
    conversation.messages.slice(outgoingIndex + 1).map((m) => m.id),
  );
  conversation.pendingIds = conversation.pendingIds.filter((id) => {
    const message = conversation.messages.find((m) => m.id === id);
    return (
      afterOutgoing.has(id) &&
      enabledAt !== null &&
      message?.timestamp !== null &&
      message?.timestamp !== undefined &&
      message.timestamp > enabledAt
    );
  });
  return eligible.map((m) => m.id);
}
export function summaryBatch(conversation: Conversation): Message[] {
  const covered = new Set(conversation.summary.coveredIds);
  return conversation.messages
    .slice(0, Math.max(0, conversation.messages.length - RECENT_WINDOW))
    .filter((m) => !covered.has(m.id))
    .slice(0, 50);
}
export function commitSummary(
  previous: Summary,
  messages: Message[],
  text: string,
): Summary {
  if (!text.trim()) throw new Error("Model tóm tắt trả nội dung rỗng.");
  return {
    text: text.trim(),
    coveredIds: [
      ...new Set([...previous.coveredIds, ...messages.map((m) => m.id)]),
    ],
    revision: previous.revision + 1,
  };
}
export function history(conversation: Conversation) {
  const covered = new Set(conversation.summary.coveredIds);
  return conversation.messages
    .filter((m) => !covered.has(m.id))
    .map((m) => ({
      role:
        m.direction === "outgoing" ? ("assistant" as const) : ("user" as const),
      content:
        m.direction === "system"
          ? `[Sự kiện nền tảng] ${m.text}`
          : messageContent(m),
    }));
}
export function latestId(c: Conversation) {
  return c.messages.at(-1)?.id ?? null;
}
export function searchKnowledge<
  T extends { text: string; title: string; accountId: string | null },
>(items: T[], query: string, accountId: string): T[] {
  const words = [
    ...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []),
  ].filter((w) => w.length > 1);
  return items
    .filter((i) => i.accountId === null || i.accountId === accountId)
    .map((item) => ({
      item,
      score: words.reduce(
        (n, w) =>
          n +
          Number(`${item.title} ${item.text}`.toLocaleLowerCase().includes(w)),
        0,
      ),
    }))
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((i) => i.item);
}
