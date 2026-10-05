import { z } from "zod";
import {
  normalizeDeepSearchInput,
  personNameConflict,
  phoneIdentityVariants,
  DEEP_SEARCH_LIMITS,
  type DeepSearchInput,
} from "./people-planner/input.ts";
import {
  reconcileDeepSearchQueries,
  describeQueryCoverage,
} from "./people-planner/query-planner.ts";
import {
  containsNameSequence,
  containsOpenMiddleName,
  nameTarget,
} from "./people-planner/name-variants.ts";
import type { PeopleSourceAnalysis } from "./people-analysis.ts";

// Local adaptation of seo-expert's person query planner and evidence contract.
// No server/tenant dependencies: facts come from pages, never invented by AI.
export const PEOPLE_PLATFORMS = {
  facebook: "facebook.com",
  instagram: "instagram.com",
  linkedin: "linkedin.com",
  x: "x.com",
  youtube: "youtube.com",
  tiktok: "tiktok.com",
} as const;
export type PeoplePlatform = keyof typeof PEOPLE_PLATFORMS;
export type SearchEngine = "google" | "bing" | "duckduckgo";
const field = z.string().trim().max(500).default("");
export const peopleSearchInputSchema = z
  .object({
    fullName: field,
    familyName: z.string().trim().max(500).optional(),
    givenName: z.string().trim().max(500).optional(),
    phoneCountry: z.string().trim().length(2).optional(),
    language: z.string().trim().min(2).max(20).optional(),
    other: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(100),
            value: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(10)
      .optional(),
    directPlatforms: z
      .array(
        z.enum(["facebook", "instagram", "linkedin", "x", "youtube", "tiktok"]),
      )
      .max(6)
      .optional(),
    analyzeOnComplete: z.boolean().optional(),
    email: z.union([z.email().max(320), z.literal("")]).default(""),
    phone: z.string().trim().max(50).default(""),
    username: z.string().trim().max(100).default(""),
    profileUrl: z.string().trim().max(2000).default(""),
    organization: field,
    context: field,
    platforms: z
      .array(
        z.enum(
          Object.keys(PEOPLE_PLATFORMS) as [
            PeoplePlatform,
            ...PeoplePlatform[],
          ],
        ),
      )
      .max(6),
    engines: z
      .array(z.enum(["google", "bing", "duckduckgo"]))
      .min(1)
      .max(3),
    depth: z.enum(["quick", "standard", "deep", "exhaustive"]),
    accountId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      ![
        input.fullName,
        input.familyName,
        input.givenName,
        input.organization,
        input.context,
        ...(input.other || []).map((row) => row.value),
        input.email,
        input.phone,
        input.username,
        input.profileUrl,
      ].some(Boolean)
    )
      ctx.addIssue({
        code: "custom",
        message: "Nhập tên hoặc một đầu mối nhận dạng.",
      });
    if (input.profileUrl)
      try {
        publicResearchUrl(input.profileUrl);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["profileUrl"],
          message: "URL hồ sơ phải là trang HTTPS công khai.",
        });
      }
    if ((input.other?.length || 0) + Number(Boolean(input.context)) > 10)
      ctx.addIssue({
        code: "custom",
        path: ["other"],
        message: "Tối đa 10 tiêu chí bổ sung, gồm ô thông tin bổ sung.",
      });
    try {
      const normalized = plannerInput(input);
      const conflict = personNameConflict(normalized);
      if (conflict)
        ctx.addIssue({ code: "custom", path: ["fullName"], message: conflict });
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Số điện thoại hoặc mã quốc gia không hợp lệ.",
      });
    }
    if (input.directPlatforms?.some((p) => !input.platforms.includes(p)))
      ctx.addIssue({
        code: "custom",
        path: ["directPlatforms"],
        message: "Chọn nền tảng trước khi bật tìm trực tiếp.",
      });
  });
export type PeopleSearchInput = z.infer<typeof peopleSearchInputSchema>;
export type PeopleCriterion = { field: string; label: string; value: string };
export type ResearchHit = { url: string; title: string; snippet: string };
export type PeoplePageMetadata = {
  displayName?: string;
  description?: string;
  links: {
    url: string;
    label: string;
    kind: "same_as" | "rel_me" | "profile" | "activity";
  }[];
};
export type PeopleSearchTask = {
  query: string;
  engine: SearchEngine | "direct";
  url: string;
  platform?: PeoplePlatform;
  page?: number;
};
export type PeopleIdentityReview = {
  left: string;
  right: string;
  decision: "same" | "different" | "uncertain";
  reason: string;
  createdAt: number;
};
export type PeopleEvidence = ResearchHit & {
  id: string;
  query: string;
  engine: SearchEngine | "direct";
  capturedAt: number;
  text?: string;
  readAt?: number;
  error?: string;
  metadata?: PeoplePageMetadata;
  discoveredFrom?: string;
};
export type PeopleMatch = PeopleCriterion & {
  status: "mentioned" | "missing";
  quote?: string;
};
export type PeopleCandidate = {
  id: string;
  url: string;
  title: string;
  evidenceIds: string[];
  identityState?: "account_only" | "reviewed_link" | "unresolved";
  matches: PeopleMatch[];
  confidence: "criteria_mentioned" | "partial" | "name_only" | "unconfirmed";
};
export type PeopleSearchJob = {
  id: string;
  input: PeopleSearchInput;
  queries: string[];
  tasks?: PeopleSearchTask[];
  coverage?: ReturnType<typeof describeQueryCoverage>;
  reviews?: PeopleIdentityReview[];
  researchRound?: number;
  focus?: string;
  parentJobId?: string;
  analysisErrors?: string[];
  analyzing?: boolean;
  status:
    "running" | "waiting" | "paused" | "completed" | "cancelled" | "failed";
  phase: "search" | "sources";
  cursor: number;
  sourceCursor: number;
  sourceUrls: string[];
  evidence: PeopleEvidence[];
  candidates: PeopleCandidate[];
  analyses?: Record<string, PeopleSourceAnalysis>;
  errors: string[];
  createdAt: number;
  updatedAt: number;
  message: string;
};
export function foldPersonText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
export function publicResearchUrl(value: string): string {
  const u = new URL(value);
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  // Reject local files, IP literals and obvious LAN names in result URLs.
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !host.includes(".") ||
    /[\[\]:]/.test(host) ||
    /^\d+(?:\.\d+)*$/.test(host) ||
    /\.home\.arpa$/.test(host) ||
    /(?:^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)
  )
    throw new Error("Chỉ mở trang HTTPS công khai.");
  u.hash = "";
  return u.toString();
}
export function canonicalResearchUrl(value: string): string {
  const u = new URL(publicResearchUrl(value));
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  u.pathname = u.pathname.replace(/\/$/, "") || "/";
  u.searchParams.sort();
  return u.toString();
}
export function peopleCriteria(input: PeopleSearchInput): PeopleCriterion[] {
  const basic = (
    [
      ["fullName", "Họ tên", input.fullName],
      ["familyName", "Họ", input.familyName || ""],
      ["givenName", "Tên", input.givenName || ""],
      ["email", "Email", input.email],
      ["phone", "Điện thoại", input.phone],
      ["username", "Username", input.username],
      ["profileUrl", "URL hồ sơ", input.profileUrl],
      ["organization", "Đơn vị", input.organization],
      ["context", "Thông tin bổ sung", input.context],
    ] as const
  )
    .filter((row) => row[2])
    .map(([field, label, value]) => ({ field, label, value }));
  return [
    ...basic,
    ...(input.other || []).map((row, index) => ({
      field: `other:${index}`,
      ...row,
    })),
  ];
}
export function plannerInput(input: PeopleSearchInput): DeepSearchInput {
  return normalizeDeepSearchInput({
    mode: "person",
    depth: input.depth,
    language: input.language || "vi",
    socialPlatforms: input.platforms,
    directSocialPlatforms: input.directPlatforms || [],
    person: {
      ...input,
      phoneCountry: input.phoneCountry || "VN",
      other: [
        ...(input.other || []),
        ...(input.context
          ? [{ label: "Thông tin bổ sung", value: input.context }]
          : []),
      ].slice(0, 10),
    },
  });
}
export function personPhoneVariants(value: string, country = "VN") {
  return phoneIdentityVariants(value, country);
}
export const PEOPLE_BUDGETS = Object.fromEntries(
  Object.entries(DEEP_SEARCH_LIMITS).map(([key, value]) => [
    key,
    {
      queries: value.queries,
      sources: value.fetchedPages,
      results: value.resultsPerSource,
    },
  ]),
) as Record<
  PeopleSearchInput["depth"],
  { queries: number; sources: number; results: number }
>;
export function buildPeopleQueries(input: PeopleSearchInput): string[] {
  return reconcileDeepSearchQueries({
    searchInput: plannerInput(input),
    aiQueries: [],
    maxQueries: PEOPLE_BUDGETS[input.depth].queries,
  });
}
export function peopleCoverage(input: PeopleSearchInput, queries: string[]) {
  return describeQueryCoverage(plannerInput(input), queries);
}
export function directPeopleUrl(platform: PeoplePlatform, query: string) {
  const q = encodeURIComponent(query.replace(/"/g, "").trim());
  const urls: Record<PeoplePlatform, string> = {
    facebook: `https://www.facebook.com/search/people/?q=${q}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${q}`,
    linkedin: `https://www.linkedin.com/search/results/people/?keywords=${q}`,
    x: `https://x.com/search?q=${q}&f=user`,
    youtube: `https://www.youtube.com/results?search_query=${q}&sp=EgIQAg%253D%253D`,
    tiktok: `https://www.tiktok.com/search/user?q=${q}`,
  };
  return urls[platform];
}
export function buildPeopleTasks(
  input: PeopleSearchInput,
  queries: string[],
): PeopleSearchTask[] {
  const tasks: PeopleSearchTask[] = [];
  const name =
    input.fullName ||
    [input.familyName, input.givenName].filter(Boolean).join(" ") ||
    input.username ||
    input.email ||
    input.phone ||
    input.organization ||
    input.other?.[0]?.value ||
    input.context;
  const variants = [
    name,
    ...(!input.fullName && input.familyName && input.givenName
      ? [`${input.givenName} ${input.familyName}`, foldPersonText(name)]
      : []),
  ];
  for (const query of [...new Set(variants)])
    for (const platform of input.directPlatforms || [])
      tasks.push({
        query,
        platform,
        engine: "direct",
        url: directPeopleUrl(platform, query),
      });
  for (const query of queries)
    for (const engine of [...new Set(input.engines)])
      tasks.push({
        query,
        engine,
        url: peopleSearchUrl(engine, query, input.language),
      });
  return tasks;
}
export function peopleSearchUrl(
  engine: SearchEngine,
  query: string,
  language = "vi",
) {
  const url = new URL(
    engine === "google"
      ? "https://www.google.com/search"
      : engine === "bing"
        ? "https://www.bing.com/search"
        : "https://duckduckgo.com/",
  );
  url.searchParams.set("q", query);
  if (engine === "google") {
    url.searchParams.set("num", "10");
    url.searchParams.set("hl", language);
  }
  return url.toString();
}
export function matchPeopleCriterion(
  criterion: PeopleCriterion,
  evidence: PeopleEvidence,
): PeopleMatch {
  // A SERP snippet is a lead. Only source-page text can count as observed evidence.
  if (!evidence.readAt) return { ...criterion, status: "missing" };
  if (criterion.field === "profileUrl") {
    const matched =
      peopleAccountUrl(criterion.value) === peopleAccountUrl(evidence.url);
    return {
      ...criterion,
      status: matched ? "mentioned" : "missing",
      ...(matched ? { quote: evidence.url } : {}),
    };
  }
  const segments = (evidence.text || "")
    .split(/\n|(?<=[.!?])\s+/u)
    .filter(Boolean);
  const values =
    criterion.field === "phone"
      ? personPhoneVariants(criterion.value)
      : [criterion.value];
  const quote = segments.find((segment) =>
    values.some((value) => {
      if (criterion.field === "email")
        return (segment.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []).some(
          (email) => email.toLowerCase() === value.toLowerCase(),
        );
      if (criterion.field === "phone")
        return (segment.match(/\+?\d[\d ().-]{4,}\d/g) || []).some(
          (phone) => phone.replace(/\D/g, "") === value.replace(/\D/g, ""),
        );
      if (["fullName", "familyName", "givenName"].includes(criterion.field))
        return containsNameSequence(segment, value);
      const haystack = ` ${foldPersonText(segment).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
      const needle = ` ${foldPersonText(value).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
      return haystack.includes(needle);
    }),
  );
  return {
    ...criterion,
    status: quote ? "mentioned" : "missing",
    ...(quote ? { quote: quote.slice(0, 600) } : {}),
  };
}
export function buildPeopleCandidates(
  job: Pick<PeopleSearchJob, "input" | "evidence"> &
    Partial<Pick<PeopleSearchJob, "reviews">>,
): PeopleCandidate[] {
  const byUrl = new Map<string, PeopleEvidence[]>();
  for (const e of job.evidence) {
    const key = peopleAccountUrl(e.url);
    byUrl.set(key, [...(byUrl.get(key) || []), e]);
  }
  for (const review of job.reviews || []) {
    if (review.decision !== "same") continue;
    const left = [...byUrl.entries()].find(([, rows]) =>
      rows.some((e) => e.id === review.left),
    );
    const right = [...byUrl.entries()].find(([, rows]) =>
      rows.some((e) => e.id === review.right),
    );
    if (!left || !right || left[0] === right[0]) continue;
    const ids = new Set([...left[1], ...right[1]].map((e) => e.id));
    if (
      job.reviews?.some(
        (r) => r.decision !== "same" && ids.has(r.left) && ids.has(r.right),
      )
    )
      continue;
    byUrl.set(left[0], [...left[1], ...right[1]]);
    byUrl.delete(right[0]);
  }
  return [...byUrl.entries()]
    .map(([url, rows]) => {
      const source = rows.find((e) => e.readAt) || rows[0];
      const matches = peopleCriteria(job.input).map(
        (c) =>
          rows
            .map((e) => matchPeopleCriterion(c, e))
            .find((m) => m.status === "mentioned") ||
          matchPeopleCriterion(c, source),
      );
      const target = nameTarget(job.input);
      if (
        target?.openMiddle &&
        !rows.some(
          (e) =>
            e.readAt &&
            containsOpenMiddleName(
              [e.metadata?.displayName, e.text].filter(Boolean).join("\n"),
              target,
            ),
        )
      )
        for (const match of matches)
          if (["familyName", "givenName"].includes(match.field)) {
            match.status = "missing";
            delete match.quote;
          }
      const mentioned = matches.filter((m) => m.status === "mentioned");
      return {
        id: source.id,
        url,
        title: source.title,
        evidenceIds: rows.map((e) => e.id),
        identityState:
          new Set(rows.map((e) => peopleAccountUrl(e.url))).size > 1
            ? "reviewed_link"
            : peopleAccountUrl(url) !== canonicalResearchUrl(url) ||
                isSocialAccountUrl(url)
              ? "account_only"
              : "unresolved",
        matches,
        confidence:
          mentioned.length > 0 &&
          mentioned.every((m) =>
            ["fullName", "familyName", "givenName"].includes(m.field),
          )
            ? "name_only"
            : mentioned.length === matches.length
              ? "criteria_mentioned"
              : mentioned.length
                ? "partial"
                : "unconfirmed",
      } as PeopleCandidate;
    })
    .sort(
      (a, b) =>
        b.matches.filter((m) => m.status === "mentioned").length -
        a.matches.filter((m) => m.status === "mentioned").length,
    );
}
export function planPeopleSources(
  job: Pick<PeopleSearchJob, "input" | "evidence">,
) {
  const groups = new Map<string, string[]>();
  for (const e of job.evidence) {
    const key = `${e.engine}:${e.query}`;
    groups.set(key, [...(groups.get(key) || []), canonicalResearchUrl(e.url)]);
  }
  const queues = [...groups.values()],
    fair: string[] = [];
  for (let index = 0; queues.some((queue) => queue[index]); index++) {
    for (const queue of queues) if (queue[index]) fair.push(queue[index]);
  }
  return [
    ...new Set([
      ...(job.input.profileUrl
        ? [canonicalResearchUrl(job.input.profileUrl)]
        : []),
      ...fair,
    ]),
  ].slice(0, PEOPLE_BUDGETS[job.input.depth].sources);
}

/** Platform namespace + account path only. A shared display name/handle never joins platforms. */
export function peopleAccountUrl(value: string) {
  const u = new URL(canonicalResearchUrl(value));
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (["facebook.com", "fb.com"].includes(host)) {
    if (
      u.pathname === "/profile.php" &&
      /^\d+$/.test(u.searchParams.get("id") || "")
    )
      return `https://www.facebook.com/profile.php?id=${u.searchParams.get("id")}`;
    if (
      parts[0] &&
      ![
        "search",
        "watch",
        "groups",
        "pages",
        "events",
        "reel",
        "reels",
        "photo",
        "photo.php",
        "posts",
        "story.php",
        "login",
        "people",
        "permalink.php",
        "share",
        "help",
        "settings",
        "marketplace",
      ].includes(parts[0]) &&
      /^[\w.]+$/.test(parts[0]) &&
      (parts.length === 1 ||
        ["posts", "about", "videos", "photos"].includes(parts[1]))
    )
      return `https://www.facebook.com/${parts[0]}`;
  }
  if (
    host === "instagram.com" &&
    parts[0] &&
    !["p", "reel", "reels", "explore", "accounts", "direct"].includes(
      parts[0],
    ) &&
    parts.length === 1
  )
    return `https://www.instagram.com/${parts[0]}`;
  if (
    ["x.com", "twitter.com"].includes(host) &&
    parts[0] &&
    ![
      "search",
      "home",
      "i",
      "intent",
      "explore",
      "messages",
      "settings",
    ].includes(parts[0]) &&
    (parts.length === 1 || parts[1] === "status")
  )
    return `https://x.com/${parts[0]}`;
  if (host === "linkedin.com" && ["in", "pub"].includes(parts[0]) && parts[1])
    return `https://www.linkedin.com/${parts[0]}/${parts[1]}`;
  if (
    host === "youtube.com" &&
    (parts[0]?.startsWith("@") ||
      (["channel", "user", "c"].includes(parts[0]) && parts[1]))
  )
    return `https://www.youtube.com/${parts[0]}${parts[1] && !parts[0].startsWith("@") ? "/" + parts[1] : ""}`;
  if (host === "tiktok.com" && parts[0]?.startsWith("@"))
    return `https://www.tiktok.com/${parts[0]}`;
  return u.toString();
}
export function isSocialAccountUrl(url: string) {
  const u = new URL(url),
    host = u.hostname.replace(/^www\./, "");
  return (
    Object.values(PEOPLE_PLATFORMS).includes(host as never) &&
    (peopleAccountUrl(url) !== canonicalResearchUrl(url) ||
      /^\/(?:@|in\/|channel\/|profile\.php|[\w.]+$)/.test(u.pathname)) &&
    !/\/(?:search|watch|reel|explore|groups|p)(?:\/|$)/.test(u.pathname)
  );
}

export function buildPeopleFocusQueries(
  input: PeopleSearchInput,
  focus: string,
) {
  const clean = focus
    .replace(/["\\\r\n]/g, " ")
    .trim()
    .slice(0, 300);
  const anchor =
    input.fullName ||
    [input.familyName, input.givenName].filter(Boolean).join(" ") ||
    input.username;
  const terms: string[] = [];
  if (/học|education|school|stud/i.test(clean))
    terms.push('("học" OR "education" OR "studied")');
  if (/công việc|nghề nghiệp|work|employ|career/i.test(clean))
    terms.push('("công việc" OR "employment" OR "career")');
  if (/sự kiện|thành tựu|event|award|achieve/i.test(clean))
    terms.push('("sự kiện" OR "award" OR "conference")');
  if (/chia sẻ|nội dung|shared|content/i.test(clean))
    terms.push('("chia sẻ" OR "article" OR "published")');
  if (!terms.length) terms.push(`"${clean}"`);
  const scoped = input.profileUrl ? new URL(input.profileUrl) : undefined;
  const queries = terms.flatMap((term) => [
    `${anchor ? `"${anchor}" ` : ""}${term}`,
    ...(scoped ? [`site:${scoped.hostname}${scoped.pathname} ${term}`] : []),
  ]);
  return [...new Set(queries)].slice(0, 6);
}
