import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePeopleAnalysis } from "../src/core/people-analysis.ts";
import { analyzePeopleSource } from "../electron/people-analysis.ts";
import {
  peopleSearchInputSchema,
  buildPeopleCandidates,
  type PeopleEvidence,
  type PeopleSearchJob,
} from "../src/core/people-search.ts";
import { emptyState } from "../src/core/types.ts";
import type { Vault } from "../electron/vault.ts";
import type { localChat } from "../electron/ai.ts";
const evidence: PeopleEvidence = {
  id: "source",
  url: "https://example.com/an",
  title: "An",
  snippet: "",
  engine: "google",
  query: "An",
  capturedAt: 1,
  readAt: 2,
  text: "An works as an engineer at Example Labs. An studied computer science at Example University.",
};
const report = JSON.stringify({
  observations: [
    {
      category: "employment",
      detail: "Nguồn mô tả An là kỹ sư tại Example Labs.",
      quote: "An works as an engineer at Example Labs.",
    },
  ],
});
test("AI report keeps exact, bounded source spans and discards invented quotes", () => {
  const rows = reconcilePeopleAnalysis(report, evidence);
  assert.equal(evidence.text!.slice(rows[0].start, rows[0].end), rows[0].quote);
  const mixed = JSON.stringify({
    observations: [
      JSON.parse(report).observations[0],
      {
        category: "education",
        detail: "Fake",
        quote: "This fabricated quotation is absent from the source text.",
      },
    ],
  });
  assert.equal(reconcilePeopleAnalysis(mixed, evidence).length, 1);
  assert.throws(
    () =>
      reconcilePeopleAnalysis(
        JSON.stringify({
          observations: [
            {
              category: "education",
              detail: "Fake",
              quote:
                "This fabricated quotation is absent from the source text.",
            },
          ],
        }),
        evidence,
      ),
    /không có trong nguồn/,
  );
  assert.throws(() => reconcilePeopleAnalysis("plain prose", evidence));
  assert.throws(() =>
    reconcilePeopleAnalysis(report, {
      ...evidence,
      text: undefined,
      readAt: undefined,
    }),
  );
});
function fixture() {
  const state = emptyState();
  const input = peopleSearchInputSchema.parse({
    fullName: "An",
    engines: ["google"],
    platforms: [],
    depth: "quick",
  });
  const job: PeopleSearchJob = {
    id: "job",
    input,
    queries: ["An"],
    status: "completed",
    phase: "sources",
    cursor: 1,
    sourceCursor: 1,
    sourceUrls: [evidence.url],
    evidence: [{ ...evidence }],
    candidates: buildPeopleCandidates({ input, evidence: [evidence] }),
    errors: [],
    message: "done",
    createdAt: 1,
    updatedAt: 1,
  };
  state.peopleSearches = [job];
  const vault = {
    read: () => structuredClone(state),
    mutate: async (fn: (s: typeof state) => unknown) => fn(state),
  } as Vault;
  return { state, job, vault };
}
test("AI receives only the selected source and stores model/provenance, without account credentials", async () => {
  const { state, job, vault } = fixture();
  state.accounts.push({
    id: "account",
    name: "Fixture",
    platform: "messenger-personal",
    username: "secret-login",
    password: "SECRET",
    cookies: ["COOKIE"],
  });
  const chat: typeof localChat = async (
    _config,
    role,
    messages,
    _signal,
    options,
  ) => {
    assert.equal(role, "knowledge");
    const payload = JSON.stringify(messages);
    assert.ok(payload.includes("Example Labs"));
    assert.ok(!payload.includes("SECRET"));
    assert.ok(!payload.includes("COOKIE"));
    options?.validateResponse?.(report);
    options?.onModelUsed?.({ providerId: "fixture", modelId: "fixture-model" });
    return report;
  };
  await analyzePeopleSource(vault, job.id, job.candidates[0].id, chat);
  const saved = state.peopleSearches![0].analyses![job.candidates[0].id];
  assert.equal(saved.modelId, "fixture-model");
  assert.equal(saved.evidenceId, evidence.id);
  assert.equal(saved.sourceHash.length, 64);
});
test("late AI results cannot resurrect deleted jobs or overwrite a changed source", async () => {
  for (const mutation of ["delete", "change"] as const) {
    const { state, job, vault } = fixture();
    const chat: typeof localChat = async () => {
      if (mutation === "delete") state.peopleSearches = [];
      else state.peopleSearches![0].evidence[0].text = "New source text";
      return report;
    };
    await assert.rejects(
      analyzePeopleSource(vault, job.id, job.candidates[0].id, chat),
      /Nguồn đã thay đổi/,
    );
  }
});
test("active search and unread source never invoke the AI provider", async () => {
  const { job, vault } = fixture();
  let calls = 0;
  const chat: typeof localChat = async () => {
    calls++;
    return report;
  };
  job.status = "waiting";
  await assert.rejects(
    analyzePeopleSource(vault, job.id, job.candidates[0].id, chat),
  );
  job.status = "completed";
  delete job.evidence[0].readAt;
  await assert.rejects(
    analyzePeopleSource(vault, job.id, job.candidates[0].id, chat),
  );
  assert.equal(calls, 0);
});
