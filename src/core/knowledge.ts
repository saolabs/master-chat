import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Command, State } from "./types.ts";

import { MAX_DOCUMENT_TEXT, MAX_DOCUMENT_FILES } from "./document-limits.ts";
export { MAX_DOCUMENT_TEXT, MAX_DOCUMENT_FILES } from "./document-limits.ts";
export const knowledgeSourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(MAX_DOCUMENT_TEXT),
});
export const knowledgeCommands = [
  knowledgeSourceSchema
    .extend({
      type: z.literal("knowledge.add"),
      accountId: z.string().uuid().nullable(),
    })
    .strict(),
  knowledgeSourceSchema
    .extend({
      type: z.literal("knowledge.update"),
      knowledgeId: z.string().uuid(),
      accountId: z.string().uuid().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("knowledge.remove"),
      knowledgeId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("knowledge.import"),
      sources: z
        .array(
          knowledgeSourceSchema
            .extend({ fileName: z.string().min(1).max(255) })
            .strict(),
        )
        .min(1)
        .max(MAX_DOCUMENT_FILES),
      accountId: z.string().uuid().nullable(),
    })
    .strict(),
] as const;
type KnowledgeCommand = Extract<Command, { type: `knowledge.${string}` }>;

export function applyKnowledgeCommand(state: State, command: KnowledgeCommand) {
  const cmd = z.discriminatedUnion("type", knowledgeCommands).parse(command);
  if (
    cmd.type !== "knowledge.remove" &&
    cmd.accountId &&
    !state.accounts.some((a) => a.id === cmd.accountId)
  )
    throw new Error("Tài khoản không tồn tại.");
  if (cmd.type === "knowledge.add") {
    state.knowledge.push({
      id: randomUUID(),
      title: cmd.title,
      text: cmd.text,
      accountId: cmd.accountId,
    });
  } else if (cmd.type === "knowledge.import") {
    state.knowledge.push(
      ...cmd.sources.map((s) => ({
        ...s,
        id: randomUUID(),
        accountId: cmd.accountId,
      })),
    );
  } else {
    const source = state.knowledge.find((s) => s.id === cmd.knowledgeId);
    if (!source) throw new Error("Nguồn tri thức không còn tồn tại.");
    if (cmd.type === "knowledge.remove")
      state.knowledge = state.knowledge.filter((s) => s.id !== cmd.knowledgeId);
    else
      Object.assign(source, {
        title: cmd.title,
        text: cmd.text,
        accountId: cmd.accountId,
      });
  }
}
