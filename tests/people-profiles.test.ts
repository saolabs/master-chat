import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPeopleCandidates,
  peopleSearchInputSchema,
  peopleAccountUrl,
  type PeopleEvidence,
  type PeopleSearchJob,
} from "../src/core/people-search.ts";
import {
  buildPeopleProfile,
  peopleReportExport,
  peopleReportCSV,
} from "../src/core/people-profiles.ts";
import { reconcilePeopleAnalysis } from "../src/core/people-analysis.ts";
const input = peopleSearchInputSchema.parse({
  fullName: "Nguyễn An",
  organization: "Example Labs",
  engines: ["google"],
  platforms: ["facebook"],
  depth: "quick",
});
const source = (id: string, url: string): PeopleEvidence => ({
  id,
  url,
  title: "Nguyễn An",
  engine: "google",
  query: "PRIVATE SEARCH",
  snippet: "Lead",
  capturedAt: 1,
  readAt: 2,
  text: "Nguyễn An studied computer science at Example University in 2015. Nguyễn An works at Example Labs since 2019.",
});
function job(evidence: PeopleEvidence[]): PeopleSearchJob {
  return {
    id: "job",
    input,
    queries: ["PRIVATE SEARCH"],
    status: "completed",
    phase: "sources",
    cursor: 1,
    sourceCursor: evidence.length,
    sourceUrls: evidence.map((e) => e.url),
    evidence,
    candidates: buildPeopleCandidates({ input, evidence }),
    createdAt: 1,
    updatedAt: 2,
    errors: [],
    message: "done",
  };
}
test("same-account posts cluster by platform account, while identical handles across platforms stay separate", () => {
  const evidence = [
    source("a", "https://www.facebook.com/example.an"),
    source("b", "https://m.facebook.com/example.an/posts/123"),
    source("c", "https://x.com/example.an"),
  ];
  const candidates = buildPeopleCandidates({ input, evidence });
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.find((c) => c.url.includes("facebook"))?.evidenceIds,
    ["a", "b"],
  );
  assert.notEqual(
    peopleAccountUrl("https://www.youtube.com/watch?v=abc"),
    peopleAccountUrl("https://www.youtube.com/@abc"),
  );
  assert.equal(
    peopleAccountUrl("https://www.facebook.com/photo.php?fbid=123&id=999"),
    "https://www.facebook.com/photo.php?fbid=123&id=999",
  );
});
test("explicit reviews join accounts, uncertain withdraws a join, and different blocks a transitive bridge", () => {
  const evidence = [
    source("a", "https://example.com/a"),
    source("b", "https://example.com/b"),
    source("c", "https://example.com/c"),
  ];
  const same = (left: string, right: string) => ({
    left,
    right,
    decision: "same" as const,
    reason: "Explicit identity link",
    createdAt: 1,
  });
  assert.equal(
    buildPeopleCandidates({ input, evidence, reviews: [same("a", "b")] })
      .length,
    2,
  );
  assert.equal(
    buildPeopleCandidates({
      input,
      evidence,
      reviews: [{ ...same("a", "b"), decision: "uncertain" }],
    }).length,
    3,
  );
  const result = buildPeopleCandidates({
    input,
    evidence,
    reviews: [
      same("a", "b"),
      same("b", "c"),
      { ...same("a", "c"), decision: "different" },
    ],
  });
  assert.ok(
    !result.some(
      (c) => c.evidenceIds.includes("a") && c.evidenceIds.includes("c"),
    ),
  );
});
test("profile sections and timeline use verified spans from all account sources; exports exclude queries, cookies and raw snapshots", () => {
  const j = job([
    source("a", "https://www.facebook.com/example.an"),
    source("b", "https://www.facebook.com/example.an/posts/123"),
  ]);
  const education = {
    category: "education" as const,
    detail: "Studied in 2015",
    quote: "Nguyễn An studied computer science at Example University in 2015.",
    timeText: "2015",
  };
  const employment = {
    category: "employment" as const,
    detail: "Works since 2019",
    quote: "Nguyễn An works at Example Labs since 2019.",
    timeText: "2019",
  };
  const analyze = (
    e: PeopleEvidence,
    row: typeof education | typeof employment,
  ) => ({
    evidenceId: e.id,
    sourceHash: "fixture",
    createdAt: 1,
    modelId: "fixture",
    observations: reconcilePeopleAnalysis(
      JSON.stringify({ observations: [row] }),
      e,
      input,
    ),
  });
  j.analyses = {
    a: analyze(j.evidence[0], employment),
    b: analyze(j.evidence[1], education),
  };
  const report = buildPeopleProfile(j, j.candidates[0]);
  assert.equal(report.sections.length, 2);
  assert.deepEqual(
    report.timeline.map((c) => c.timeText),
    ["2015", "2019"],
  );
  assert.equal(report.timeline[0].evidenceId, "b");
  const exported = JSON.stringify(peopleReportExport(j));
  assert.ok(!exported.includes("PRIVATE SEARCH"));
  assert.ok(!exported.includes("sourceHash"));
  assert.ok(!exported.includes("sourceText"));
  assert.ok(exported.includes("Example University"));
  const csv = peopleReportCSV(j);
  assert.match(csv, /2015/);
  assert.match(csv, /source_url/);
});
test("source attribution rejects another subject and unsupported time even when quotes exist", () => {
  const e = source("a", "https://example.com/a");
  const quote = "Nguyễn An works at Example Labs since 2019.";
  for (const row of [
    { subject: "Nguyễn Bình", timeText: "2019" },
    { subject: "Nguyễn An", timeText: "2025" },
  ])
    assert.throws(() =>
      reconcilePeopleAnalysis(
        JSON.stringify({
          observations: [
            { category: "employment", detail: "Work", quote, ...row },
          ],
        }),
        e,
        input,
      ),
    );
});

test("an open-middle name cannot match a longer name whose given name is different", () => {
  const person = {
    ...input,
    fullName: "",
    familyName: "Lê",
    givenName: "Doãn",
    organization: "",
  };
  const e = source("a", "https://example.com/other");
  e.text =
    "Lê Doãn Hợp works at Example Labs and has a public professional profile.";
  const c = buildPeopleCandidates({ input: person, evidence: [e] })[0];
  assert.ok(
    c.matches
      .filter((m) => ["familyName", "givenName"].includes(m.field))
      .every((m) => m.status === "missing"),
  );
});
