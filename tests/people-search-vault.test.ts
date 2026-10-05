import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPeopleProfile } from "../src/core/people-profiles.ts";
import { buildPeopleCandidates } from "../src/core/people-search.ts";
import { Vault } from "../electron/vault.ts";
import {
  peopleSearchInputSchema,
  type PeopleSearchJob,
} from "../src/core/people-search.ts";
test("search evidence stays encrypted and an interrupted run reopens paused without losing its cursor", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "master-chat-people-vault-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  };
  const vault = new Vault(dir, storage);
  await vault.open();
  const job: PeopleSearchJob = {
    id: "fixture",
    input: peopleSearchInputSchema.parse({
      fullName: "Private fixture name",
      engines: ["google"],
      platforms: [],
      depth: "quick",
    }),
    queries: ['"Private fixture name"'],
    status: "waiting",
    phase: "search",
    cursor: 0,
    sourceCursor: 0,
    sourceUrls: [],
    evidence: [],
    candidates: [],
    errors: [],
    message: "CAPTCHA",
    createdAt: 1,
    updatedAt: 1,
  };
  await vault.mutate((s) => {
    s.peopleSearches = [job];
  });
  assert.equal(
    (await readFile(path.join(dir, "data.vault"))).includes(
      Buffer.from("Private fixture name"),
    ),
    false,
  );
  const reopened = new Vault(dir, storage);
  await reopened.open();
  const saved = reopened.read().peopleSearches![0];
  assert.equal(saved.status, "paused");
  assert.equal(saved.cursor, 0);
  assert.equal(saved.input.fullName, job.input.fullName);
});

test("saved profile versions survive case removal and interrupted AI is cleared on reopening", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "master-chat-people-library-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (v: Buffer) => v.toString(),
  };
  const vault = new Vault(dir, storage);
  await vault.open();
  const input = peopleSearchInputSchema.parse({
    fullName: "Private fixture name",
    engines: ["google"],
    platforms: [],
    depth: "quick",
  });
  const evidence = [
    {
      id: "source",
      url: "https://example.com/fixture",
      title: "Private fixture name",
      snippet: "",
      engine: "google" as const,
      query: "fixture",
      capturedAt: 1,
      readAt: 2,
      text: "Private fixture name works at Example Labs in 2019.",
    },
  ];
  const candidates = buildPeopleCandidates({ input, evidence });
  const job: PeopleSearchJob = {
    id: "case",
    input,
    queries: ["fixture"],
    status: "completed",
    analyzing: true,
    phase: "sources",
    cursor: 1,
    sourceCursor: 1,
    sourceUrls: [evidence[0].url],
    evidence,
    candidates,
    createdAt: 1,
    updatedAt: 1,
    errors: [],
    message: "analysis",
  };
  await vault.mutate((s) => {
    s.peopleSearches = [job];
    s.savedPeopleProfiles = [
      {
        id: "saved",
        jobId: job.id,
        candidateId: candidates[0].id,
        createdAt: 1,
        updatedAt: 1,
        versions: [
          {
            createdAt: 1,
            report: buildPeopleProfile(job, candidates[0]),
            input,
            evidence,
            analyses: {},
          },
        ],
      },
    ];
  });
  const reopened = new Vault(dir, storage);
  await reopened.open();
  assert.equal(reopened.read().peopleSearches![0].analyzing, false);
  await reopened.mutate((s) => {
    s.peopleSearches = [];
  });
  const again = new Vault(dir, storage);
  await again.open();
  assert.equal(
    again.read().savedPeopleProfiles![0].versions[0].report.displayName,
    "Private fixture name",
  );
  assert.equal(
    (await readFile(path.join(dir, "data.vault"))).includes(
      Buffer.from("Private fixture name"),
    ),
    false,
  );
});
