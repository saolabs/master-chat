import { createHash } from "node:crypto";
import { localChat } from "./ai.ts";
import { rememberProviderKey } from "./provider-keys.ts";
import {
  PEOPLE_ANALYSIS_INSTRUCTIONS,
  reconcilePeopleAnalysis,
} from "../src/core/people-analysis.ts";
import { peopleCriteria } from "../src/core/people-search.ts";
import type { ModelSelection } from "../src/core/types.ts";
import type { Vault } from "./vault.ts";
export async function analyzePeopleSource(
  vault: Vault,
  jobId: string,
  candidateId: string,
  chat = localChat,
  options: { signal?: AbortSignal; evidenceId?: string; focus?: string } = {},
) {
  const state = vault.read(),
    job = state.peopleSearches?.find((j) => j.id === jobId);
  const candidate = job?.candidates.find((c) => c.id === candidateId);
  const evidence = job?.evidence.find(
    (e) =>
      candidate?.evidenceIds.includes(e.id) &&
      (!options.evidenceId || options.evidenceId === e.id) &&
      e.readAt &&
      e.text,
  );
  if (!job || !candidate || !evidence)
    throw new Error("Nguồn chưa có nội dung để phân tích.");
  if (["running", "waiting", "paused"].includes(job.status))
    throw new Error("Hoàn tất hoặc dừng tìm kiếm trước khi phân tích.");
  if (!options.evidenceId) {
    const sources = job.evidence.filter(
      (e) => candidate.evidenceIds.includes(e.id) && e.readAt && e.text,
    );
    if (sources.length > 1) {
      for (const e of sources)
        await analyzePeopleSource(vault, jobId, candidateId, chat, {
          ...options,
          evidenceId: e.id,
        });
      return;
    }
  }
  const sourceHash = createHash("sha256").update(evidence.text!).digest("hex");
  let used: ModelSelection | undefined;
  const result = await chat(
    state.ai,
    "knowledge",
    [
      { role: "system", content: PEOPLE_ANALYSIS_INSTRUCTIONS },
      {
        role: "user",
        content: JSON.stringify({
          criteria: peopleCriteria(job.input),
          url: evidence.url,
          sourceText: evidence.text,
          displayName: evidence.metadata?.displayName,
          language: job.input.language || "vi",
          focus:
            options.focus ||
            job.focus ||
            "Hồ sơ tổng quan và dòng thời gian nghề nghiệp",
        }),
      },
    ],
    options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)])
      : AbortSignal.timeout(120000),
    {
      maxContentLength: 20000,
      validateResponse: (content) => {
        reconcilePeopleAnalysis(content, evidence, job.input);
      },
      onModelUsed: (selection) => {
        used = selection;
      },
      onKeyChange: (provider, key) => rememberProviderKey(vault, provider, key),
    },
  );
  const observations = reconcilePeopleAnalysis(result, evidence, job.input);
  await vault.mutate((s) => {
    const current = s.peopleSearches?.find((j) => j.id === job.id);
    const source = current?.evidence.find((e) => e.id === evidence.id);
    if (
      !current ||
      !source?.text ||
      createHash("sha256").update(source.text).digest("hex") !== sourceHash
    )
      throw new Error(
        "Nguồn đã thay đổi. Chạy lại phân tích trên nội dung hiện tại.",
      );
    const analysis = {
      evidenceId: evidence.id,
      sourceHash,
      observations,
      modelId: used?.modelId || "",
      createdAt: Date.now(),
    };
    current.analyses = {
      ...current.analyses,
      [evidence.id]: analysis,
      ...(candidate.evidenceIds[0] === evidence.id
        ? { [candidate.id]: analysis }
        : {}),
    };
  });
}
