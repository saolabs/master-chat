import type {
  PeopleSearchJob,
  PeopleCandidate,
  PeopleEvidence,
  PeopleSearchInput,
} from "./people-search.ts";
import {
  PEOPLE_ANALYSIS_CATEGORIES,
  type PeopleSourceAnalysis,
} from "./people-analysis.ts";
export type PeopleProfileClaim =
  PeopleSourceAnalysis["observations"][number] & {
    evidenceId: string;
    url: string;
  };
export type PeopleProfileReport = {
  id: string;
  displayName: string;
  primaryUrl: string;
  confidence: PeopleCandidate["confidence"];
  identityState: NonNullable<PeopleCandidate["identityState"]>;
  criteria: PeopleCandidate["matches"];
  sections: {
    category: keyof typeof PEOPLE_ANALYSIS_CATEGORIES;
    title: string;
    claims: PeopleProfileClaim[];
  }[];
  timeline: PeopleProfileClaim[];
  sources: {
    id: string;
    title: string;
    url: string;
    engine: string;
    accessStatus: string;
    readAt?: number;
    declaredLinks: PeopleEvidence["metadata"];
  }[];
  limitations: string[];
};
export type SavedPeopleProfile = {
  id: string;
  jobId: string;
  candidateId: string;
  createdAt: number;
  updatedAt: number;
  versions: {
    createdAt: number;
    report: PeopleProfileReport;
    input: PeopleSearchInput;
    evidence: PeopleEvidence[];
    analyses: Record<string, PeopleSourceAnalysis>;
  }[];
};
export function buildPeopleProfile(
  job: PeopleSearchJob,
  candidate: PeopleCandidate,
): PeopleProfileReport {
  const sources = job.evidence.filter((e) =>
    candidate.evidenceIds.includes(e.id),
  );
  const seen = new Set<string>(),
    claims: PeopleProfileClaim[] = [];
  for (const analysis of Object.values(job.analyses || {})) {
    const source = sources.find((e) => e.id === analysis.evidenceId);
    if (!source?.text) continue;
    for (const row of analysis.observations) {
      const key = `${source.id}:${row.start}:${row.end}:${row.category}`;
      if (seen.has(key) || source.text.slice(row.start, row.end) !== row.quote)
        continue;
      seen.add(key);
      claims.push({ ...row, evidenceId: source.id, url: source.url });
    }
  }
  const sections = Object.entries(PEOPLE_ANALYSIS_CATEGORIES).flatMap(
    ([category, title]) => {
      const rows = claims.filter((row) => row.category === category);
      return rows.length
        ? [
            {
              category: category as keyof typeof PEOPLE_ANALYSIS_CATEGORIES,
              title,
              claims: rows,
            },
          ]
        : [];
    },
  );
  const year = (row: PeopleProfileClaim) =>
    Number(row.timeText?.match(/\b(?:18|19|20)\d{2}\b/)?.[0] || Infinity);
  const timeline = claims
    .filter((row) =>
      [
        "education",
        "employment",
        "achievement",
        "professional_event",
        "public_activity",
        "professional_activity",
      ].includes(row.category),
    )
    .sort((a, b) => year(a) - year(b));
  return {
    id: candidate.id,
    displayName:
      sources.find((e) => e.metadata?.displayName)?.metadata?.displayName ||
      candidate.title,
    primaryUrl: candidate.url,
    confidence: candidate.confidence,
    identityState: candidate.identityState || "unresolved",
    criteria: candidate.matches,
    sections,
    timeline,
    sources: sources
      .filter((e, i) => sources.findIndex((x) => x.url === e.url) === i)
      .map((e) => ({
        id: e.id,
        title: e.title,
        url: e.url,
        engine: e.engine,
        readAt: e.readAt,
        accessStatus: e.error ? "unavailable" : e.readAt ? "read" : "lead_only",
        declaredLinks: e.metadata,
      })),
    limitations: [
      ...candidate.matches
        .filter((m) => m.status === "missing")
        .map((m) => `Chưa có bằng chứng: ${m.label} (${m.value}).`),
      ...(candidate.identityState !== "reviewed_link"
        ? [
            "Các tiêu chí được nhắc trong văn bản chưa xác nhận danh tính ngoài đời.",
          ]
        : ["Liên kết hồ sơ dựa trên đối chiếu thủ công của bạn."]),
      ...(!claims.length
        ? ["Chưa có dữ kiện được phân tích và dẫn chứng cho báo cáo."]
        : []),
      ...sources
        .filter((e) => !e.readAt)
        .map((e) => `Chưa đọc được nguồn: ${e.url}`),
      ...job.errors,
      ...(job.analysisErrors || []),
    ],
  };
}
export function peopleReportExport(job: PeopleSearchJob) {
  return {
    version: 2,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    status: job.status,
    coverage: job.coverage,
    profiles: job.candidates.map((c) => buildPeopleProfile(job, c)),
    reviews: job.reviews || [],
    limitations: job.errors,
  };
}
export function peopleReportCSV(job: PeopleSearchJob) {
  const rows: unknown[][] = [
    [
      "profile",
      "url",
      "identity_state",
      "category",
      "detail",
      "quote",
      "source_url",
      "start",
      "end",
      "time",
      "criterion",
      "status",
    ],
  ];
  for (const profile of peopleReportExport(job).profiles) {
    for (const section of profile.sections)
      for (const claim of section.claims)
        rows.push([
          profile.displayName,
          profile.primaryUrl,
          profile.identityState,
          section.title,
          claim.detail,
          claim.quote,
          claim.url,
          claim.start,
          claim.end,
          claim.timeText || "",
          "",
          "",
        ]);
    for (const criterion of profile.criteria)
      rows.push([
        profile.displayName,
        profile.primaryUrl,
        profile.identityState,
        "Tiêu chí",
        criterion.value,
        criterion.quote || "",
        "",
        "",
        "",
        "",
        criterion.label,
        criterion.status,
      ]);
  }
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const s = String(value ?? "");
            return (
              '"' +
              (/^[=+\-@\t\r]/.test(s) ? "'" : "") +
              s.replace(/"/g, '""') +
              '"'
            );
          })
          .join(","),
      )
      .join("\r\n")
  );
}
