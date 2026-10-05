import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  buildPeopleQueries,
  peopleSearchInputSchema,
  peopleSearchUrl,
  canonicalResearchUrl,
  publicResearchUrl,
  buildPeopleCandidates,
  type PeopleEvidence,
  type PeopleSearchJob,
} from "../src/core/people-search.ts";
import { researchReadScript } from "../src/core/people-search-dom.ts";
import {
  PeopleSearchRunner,
  ResearchPausedError,
  type PeopleSearchStore,
  type ResearchTransport,
} from "../electron/people-search-runner.ts";
import type { ResearchPage } from "../src/core/people-search-dom.ts";
const input = peopleSearchInputSchema.parse({
  fullName: "Nguyễn An",
  organization: "Example Labs",
  platforms: ["facebook", "linkedin"],
  engines: ["google"],
  depth: "quick",
});
function source(id: string, url: string, text?: string): PeopleEvidence {
  return {
    id,
    url,
    title: "Nguyễn An",
    snippet: "Nguyễn An làm việc ở Example Labs",
    engine: "google",
    query: "test",
    capturedAt: 1,
    ...(text ? { text, readAt: 2 } : {}),
  };
}
test("queries are derived from submitted anchors, fairly cover selected platforms and are bounded", () => {
  const queries = buildPeopleQueries(input);
  assert.ok(queries.some((q) => q.includes('"Nguyễn An" "Example Labs"')));
  for (const host of ["facebook.com", "linkedin.com"])
    assert.ok(queries.some((q) => q.includes(`site:${host}`)));
  assert.ok(queries.length <= 6);
  assert.equal(
    new URL(peopleSearchUrl("google", '"An" & example')).searchParams.get("q"),
    '"An" & example',
  );
  assert.doesNotThrow(() =>
    peopleSearchInputSchema.parse({
      ...input,
      fullName: "",
      organization: "Only a company",
    }),
  );
  assert.throws(() => peopleSearchInputSchema.parse({ ...input, engines: [] }));
  assert.throws(() =>
    peopleSearchInputSchema.parse({
      ...input,
      fullName: "",
      organization: "",
      phone: "......",
    }),
  );
});
test("untrusted URLs cannot open files, local services, credentials or non-HTTPS destinations", () => {
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://example.com",
    "https://127.0.0.1",
    "https://0x7f000001",
    "https://[::1]",
    "https://foo.local",
    "https://foo.local.",
    "https://example.com:3000",
    "https://user:pass@example.com",
  ])
    assert.throws(() => publicResearchUrl(url), url);
  assert.equal(
    canonicalResearchUrl("https://example.com/an/?utm_source=x&fbclid=y#bio"),
    "https://example.com/an",
  );
});
test("namesakes stay separate and SERP text cannot become confirmed evidence", () => {
  const rows = [
    source("a", "https://example.com/a"),
    source("b", "https://example.com/b", "Nguyễn An works at Example Labs."),
  ];
  const candidates = buildPeopleCandidates({ input, evidence: rows });
  assert.equal(candidates.length, 2);
  assert.equal(candidates.find((c) => c.id === "a")!.confidence, "unconfirmed");
  assert.equal(
    candidates.find((c) => c.id === "b")!.confidence,
    "criteria_mentioned",
  );
  assert.match(
    candidates.find((c) => c.id === "b")!.matches[0].quote!,
    /Nguyễn An/,
  );
});
test("email/phone matching requires whole values, name matching handles Vietnamese accents", () => {
  const search = { ...input, email: "an@example.com", phone: "0901234567" };
  const evidence = [
    source(
      "a",
      "https://example.com/a",
      "Nguyen An at Example Labs. otheran@example.com, 09012345678.",
    ),
  ];
  const matches = buildPeopleCandidates({ input: search, evidence })[0].matches;
  assert.equal(
    matches.find((m) => m.field === "fullName")!.status,
    "mentioned",
  );
  assert.equal(matches.find((m) => m.field === "email")!.status, "missing");
  assert.equal(matches.find((m) => m.field === "phone")!.status, "missing");
});
function domRead(
  html: string,
  url = "https://www.google.com/search?q=An",
  search = true,
) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  Object.defineProperty(dom.window.Element.prototype, "getClientRects", {
    value() {
      return this.hasAttribute("hidden") ? [] : [{ width: 100, height: 20 }];
    },
  });
  try {
    return dom.window.eval(researchReadScript(search)) as ResearchPage;
  } finally {
    dom.window.close();
  }
}
test("DOM reads organic results and unwraps engine redirects without accepting navigation headings", () => {
  const page = domRead(
    '<a href="/search?q=other"><h3>Nav</h3></a><div class="MjjYud"><a href="/url?q=https%3A%2F%2Fexample.com%2Fan"><h3>Nguyễn An</h3></a><p>Example Labs</p></div>',
  );
  assert.equal(page.state, "ready");
  assert.equal(page.hits.length, 1);
  assert.equal(page.hits[0].url, "https://example.com/an");
  assert.match(page.hits[0].snippet, /Example Labs/);
  const ddg = domRead(
    '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fan">Nguyễn An</a>',
    "https://duckduckgo.com/?q=An",
  );
  assert.equal(ddg.hits[0].url, "https://example.com/an");
});
test("CAPTCHA, consent and login stop collection, including pages with an ordinary result underneath", () => {
  for (const body of [
    "<h1>Unusual traffic</h1>",
    '<iframe src="https://example.com/recaptcha"></iframe>',
    "<p>Before you continue to Google</p>",
    '<input type="password">',
  ]) {
    const page = domRead(
      `${body}<a href="https://example.com/an"><h3>Result</h3></a>`,
    );
    assert.equal(page.state, "waiting");
    assert.equal(page.hits.length, 0);
    assert.equal(page.text, "");
  }
  assert.equal(domRead("<p>No results found</p>").state, "ready");
  assert.equal(domRead("<p>Loading…</p>").state, "loading");
});
function harness(read: ResearchTransport["read"]) {
  const state: { peopleSearches?: PeopleSearchJob[] } = {};
  const store: PeopleSearchStore = {
    read: () => structuredClone(state),
    mutate: async (fn) => fn(state),
  };
  let shows = 0,
    stops = 0;
  const browser: ResearchTransport = {
    read,
    show: async () => {
      shows++;
    },
    stop: () => {
      stops++;
    },
  };
  return {
    state,
    browser,
    runner: new PeopleSearchRunner(store, browser, () => {}),
    counts: () => ({ shows, stops }),
  };
}
const ready = (url: string, search: boolean): ResearchPage => ({
  state: "ready",
  url,
  title: "Nguyễn An",
  text: search
    ? ""
    : "Nguyễn An works at Example Labs. This is a professional public profile for fixture tests.",
  hits: search
    ? [
        {
          url: "https://example.com/an",
          title: "Nguyễn An",
          snippet: "Public profile",
        },
      ]
    : [],
});
test("runner pauses at CAPTCHA and resumes the same query; results and source text persist once per URL", async () => {
  let blocked = true;
  const calls: { url: string; resume: boolean }[] = [];
  const h = harness(async (url, search, resume) => {
    calls.push({ url, resume });
    return blocked
      ? {
          ...ready(url, search),
          state: "waiting",
          reason: "CAPTCHA",
          hits: [],
          text: "",
        }
      : ready(url, search);
  });
  await h.runner.start(input);
  await h.runner.idle();
  const id = h.state.peopleSearches![0].id;
  assert.equal(h.state.peopleSearches![0].status, "waiting");
  assert.equal(h.state.peopleSearches![0].cursor, 0);
  assert.equal(h.counts().shows, 1);
  await assert.rejects(h.runner.start(input));
  blocked = false;
  await h.runner.resume(id);
  await h.runner.idle();
  const job = h.state.peopleSearches![0];
  assert.equal(job.status, "completed");
  assert.equal(calls[1].url, calls[0].url);
  assert.equal(calls[1].resume, true);
  assert.equal(job.candidates.length, 1);
  assert.equal(job.sourceCursor, 1);
  assert.equal(job.evidence.filter((e) => e.text).length, 1);
  assert.equal(job.candidates[0].confidence, "criteria_mentioned");
});
test("concurrent starts cannot overwrite a run and manual window closure pauses instead of retrying", async () => {
  const h = harness(async () => {
    throw new ResearchPausedError();
  });
  const first = h.runner.start(input);
  await assert.rejects(h.runner.start(input));
  await first;
  await h.runner.idle();
  assert.equal(h.state.peopleSearches!.length, 1);
  assert.equal(h.state.peopleSearches![0].status, "paused");
  assert.equal(h.state.peopleSearches![0].cursor, 0);
});
test("cancelling an in-flight read rejects late results and permits a new run", async () => {
  let release!: (page: ResearchPage) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const h = harness((url) => {
    entered();
    return new Promise((resolve) => (release = resolve));
  });
  await h.runner.start(input);
  await started;
  const job = h.state.peopleSearches![0];
  const cancel = h.runner.cancel(job.id);
  release(ready("https://example.com/", true));
  await cancel;
  assert.equal(h.state.peopleSearches![0].status, "cancelled");
  assert.equal(h.state.peopleSearches![0].evidence.length, 0);
  h.browser.read = async (url, search) => ready(url, search);
  await h.runner.start(input);
  await h.runner.idle();
  assert.equal(h.state.peopleSearches![0].status, "completed");
});
test("skipping a challenge advances only its current cursor and records partial coverage", async () => {
  let blocked = true;
  const h = harness(async (url, search) =>
    blocked
      ? { ...ready(url, search), state: "waiting", reason: "CAPTCHA" }
      : ready(url, search),
  );
  await h.runner.start(input);
  await h.runner.idle();
  const id = h.state.peopleSearches![0].id;
  blocked = false;
  await h.runner.skip(id);
  await h.runner.idle();
  assert.equal(h.state.peopleSearches![0].status, "completed");
  assert.equal(h.state.peopleSearches![0].errors.length, 1);
});

test("original planner includes separate family/given, school alternatives and country-aware independent phone searches", () => {
  const person = peopleSearchInputSchema.parse({
    ...input,
    fullName: "",
    familyName: "Lê",
    givenName: "Doãn",
    phone: "202-555-0123",
    phoneCountry: "US",
    organization: "",
    other: [{ label: "Trường học", value: "THPT Nguyễn Trãi" }],
    directPlatforms: ["facebook"],
    depth: "exhaustive",
  });
  const queries = buildPeopleQueries(person);
  assert.ok(queries.includes('"2025550123"'));
  assert.ok(queries.includes('"+12025550123"'));
  assert.ok(queries.some((q) => q.includes('"Doãn" "Lê" site:facebook.com')));
  assert.ok(queries.some((q) => q.includes('"Nguyễn Trãi" site:facebook.com')));
  assert.ok(queries.some((q) => q.includes('"THPT Nguyễn Trãi"')));
  assert.ok(queries.length <= 42);
  assert.throws(
    () =>
      peopleSearchInputSchema.parse({
        ...person,
        fullName: "Lê Đoan",
        givenName: "Doãn",
      }),
    /không có trong Họ tên/,
  );
});
test("Vietnamese names with different accents stay distinct, while unaccented names remain a discovery match", () => {
  const person = { ...input, fullName: "Lê Doãn", organization: "" };
  assert.equal(
    buildPeopleCandidates({
      input: person,
      evidence: [
        source(
          "accent",
          "https://example.com/one",
          "Lê Đoan has a public profile.",
        ),
      ],
    })[0].matches[0].status,
    "missing",
  );
  assert.equal(
    buildPeopleCandidates({
      input: person,
      evidence: [
        source(
          "plain",
          "https://example.com/one",
          "Le Doan has a public profile.",
        ),
      ],
    })[0].matches[0].status,
    "mentioned",
  );
});
test("direct Facebook People DOM ignores navigation accounts and collects numeric and slug accounts", () => {
  const page = domRead(
    '<nav><a href="/me.fixture">My account</a></nav><main><div role="listitem"><a href="/nguyen.an">Nguyễn An</a><p>Example Labs</p></div><div role="listitem"><a href="/profile.php?id=12345">Nguyễn An Two</a></div><a href="/groups/example">Group</a></main>',
    "https://www.facebook.com/search/people/?q=Nguyen%20An",
  );
  assert.equal(page.state, "ready");
  assert.equal(page.hits.length, 2);
  assert.ok(!page.hits.some((h) => h.title === "My account"));
});
test("source DOM preserves declared links and metadata, and search pagination remains on the same query", () => {
  const page = domRead(
    '<h1>Nguyễn An</h1><p>Nguyễn An works at Example Labs and studied computer science at Example University.</p><a rel="me" href="https://x.com/example_an">X</a><script type="application/ld+json">{"@type":"Person","name":"Nguyễn An","sameAs":["https://www.linkedin.com/in/example-an"]}</script>',
    "https://example.com/an",
    false,
  );
  assert.equal(page.metadata?.displayName, "Nguyễn An");
  assert.equal(
    page.metadata?.links.find((l) => l.kind === "same_as")?.url,
    "https://www.linkedin.com/in/example-an",
  );
  const search = domRead(
    '<a href="https://example.com/an"><h3>An</h3></a><a id="pnnext" href="/search?q=An&start=10">Next</a>',
  );
  assert.equal(new URL(search.nextUrl!).searchParams.get("start"), "10");
});
test("runner searches directly first, follows named declared links and discovers observed middle names without inventing them", async () => {
  const requested: string[] = [];
  const h = harness(async (url, search) => {
    requested.push(url);
    if (search && url.includes("facebook.com/search"))
      return {
        ...ready(url, true),
        hits: [
          {
            url: "https://www.facebook.com/le.ngoc.doan",
            title: "Lê Ngọc Doãn",
            snippet: "School",
          },
        ],
      };
    if (!search && url.includes("facebook.com"))
      return {
        ...ready(url, false),
        title: "Lê Ngọc Doãn",
        text: "Lê Ngọc Doãn studied at Example University and works at Example Labs.",
        metadata: {
          displayName: "Lê Ngọc Doãn",
          links: [
            {
              kind: "rel_me",
              url: "https://example.com/declared",
              label: "Personal website",
            },
          ],
        },
      };
    return ready(url, search);
  });
  await h.runner.start({
    ...input,
    fullName: "",
    familyName: "Lê",
    givenName: "Doãn",
    directPlatforms: ["facebook"],
  });
  await h.runner.idle();
  const job = h.state.peopleSearches![0];
  assert.match(requested[0], /facebook.com\/search\/people/);
  assert.ok(job.queries.includes('"Lê Ngọc Doãn"'));
  assert.ok(requested.includes("https://example.com/declared"));
  assert.ok(
    job.evidence.find((e) => e.url === "https://example.com/declared")
      ?.discoveredFrom,
  );
  assert.ok(job.sourceUrls.length <= 12);
});

test("automatic report generation is cancellable, and late analysis cannot lock the next search", async () => {
  const state: { peopleSearches?: PeopleSearchJob[] } = {};
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const transport: ResearchTransport = {
    read: async (url, search) => ready(url, search),
    show: async () => {},
    stop: () => {},
  };
  const runner = new PeopleSearchRunner(
    { read: () => structuredClone(state), mutate: async (fn) => fn(state) },
    transport,
    () => {},
    async (_job, _candidate, signal) => {
      entered();
      await new Promise<void>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
    },
  );
  await runner.start({ ...input, analyzeOnComplete: true });
  await started;
  assert.equal(state.peopleSearches![0].analyzing, true);
  await runner.cancel(state.peopleSearches![0].id);
  assert.equal(state.peopleSearches![0].analyzing, false);
  assert.equal(state.peopleSearches![0].status, "cancelled");
  await runner.start({ ...input, analyzeOnComplete: false });
  await runner.idle();
  assert.equal(state.peopleSearches![0].status, "completed");
});
test("exhaustive search follows only observed same-query next pages with a five-page cap", async () => {
  const h = harness(async (url, search) => {
    const page = ready(url, search);
    if (search) {
      const u = new URL(url);
      u.searchParams.set(
        "start",
        String(Number(u.searchParams.get("start") || 0) + 10),
      );
      page.nextUrl = u.toString();
    }
    return page;
  });
  await h.runner.start({ ...input, platforms: [], depth: "exhaustive" });
  await h.runner.idle();
  const j = h.state.peopleSearches![0];
  assert.equal(j.status, "completed");
  assert.ok(j.tasks?.some((t) => t.page === 5));
  assert.ok(!j.tasks?.some((t) => (t.page || 1) > 5));
});
