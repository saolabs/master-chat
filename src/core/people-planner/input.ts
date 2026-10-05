// Person planner ported from seo-expert; server execution stays in Electron.
import * as z from "zod";
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/core";
import phoneMetadata from "libphonenumber-js/metadata.min.json";
import {
  containsNameSequence,
  nameTarget,
  socialQueryVariants,
} from "./name-variants.ts";
import { SOCIAL_PLATFORMS, SOCIAL_QUERY_HOSTS } from "./social-platforms.ts";
import { buildSchoolDiscoveryQueries } from "./context-query-variants.ts";

export const deepSearchModeSchema = z.enum(["person", "topic"]);
export const deepSearchDepthSchema = z.enum([
  "quick",
  "standard",
  "deep",
  "exhaustive",
]);
const socialPlatformSchema = z.enum(SOCIAL_PLATFORMS);

const text = z.string().trim().max(500).optional();

function parsePersonPhone(value: string, country: string | undefined) {
  return parsePhoneNumberFromString(
    value,
    {
      defaultCountry: country?.toUpperCase() as CountryCode | undefined,
    },
    phoneMetadata,
  );
}

function phoneDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

/** Keep the local and canonical spellings used by public pages and search engines. */
export function phoneIdentityVariants(
  value: string | undefined,
  country: string | undefined,
): string[] {
  if (!value) return [];
  const parsed = parsePersonPhone(value, country);
  if (!parsed?.isValid()) return [value];
  const nationalDigits = phoneDigits(parsed.formatNational());
  return [
    ...new Set(
      [
        nationalDigits.length >= 7 ? nationalDigits : undefined,
        parsed.number,
        parsed.nationalNumber.length >= 7 ? parsed.nationalNumber : undefined,
      ].filter((variant): variant is string => Boolean(variant)),
    ),
  ];
}

export const deepSearchInputSchema = z
  .object({
    mode: deepSearchModeSchema,
    depth: deepSearchDepthSchema.default("standard"),
    language: z.string().trim().max(20).default("vi"),
    socialPlatforms: z
      .array(socialPlatformSchema)
      .max(SOCIAL_PLATFORMS.length)
      .default([...SOCIAL_PLATFORMS]),
    directSocialPlatforms: z
      .array(socialPlatformSchema)
      .max(SOCIAL_PLATFORMS.length)
      .default([]),
    person: z
      .object({
        familyName: text,
        givenName: text,
        fullName: text,
        email: z.string().trim().max(320).optional(),
        phone: z.string().trim().max(50).optional(),
        phoneCountry: z.string().trim().length(2).optional(),
        username: z.string().trim().max(100).optional(),
        profileUrl: z.string().trim().max(2_000).optional(),
        organization: text,
        other: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(100),
              value: z.string().trim().min(1).max(500),
            }),
          )
          .max(10)
          .default([]),
      })
      .default({ other: [] }),
    topic: z
      .object({
        question: z.string().trim().max(2_000).default(""),
      })
      .default({ question: "" }),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "topic") {
      if (!value.topic.question)
        ctx.addIssue({
          code: "custom",
          path: ["topic", "question"],
          message: "Hãy nhập câu hỏi cần nghiên cứu.",
        });
      return;
    }
    const person = value.person;
    const hasCriterion =
      [
        person.familyName,
        person.givenName,
        person.fullName,
        person.email,
        person.phone,
        person.username,
        person.profileUrl,
        person.organization,
      ].some(Boolean) || person.other.length > 0;
    if (!hasCriterion)
      ctx.addIssue({
        code: "custom",
        path: ["person"],
        message: "Hãy nhập ít nhất một thông tin để tìm người.",
      });
    if (person.phone) {
      const phone = parsePersonPhone(person.phone, person.phoneCountry);
      if (!phone?.isValid())
        ctx.addIssue({
          code: "custom",
          path: ["person", "phone"],
          message: "Số điện thoại hoặc mã quốc gia không hợp lệ.",
        });
    }
  });

export type DeepSearchInput = z.infer<typeof deepSearchInputSchema>;
export type DeepSearchCriterionField =
  | "family_name"
  | "given_name"
  | "full_name"
  | "email"
  | "phone"
  | "username"
  | "profile_url"
  | "organization"
  | "other";

export type DeepSearchCriterion = {
  id: string;
  field: DeepSearchCriterionField;
  label: string;
  value: string;
};

function compact(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

export function normalizeDeepSearchInput(raw: unknown): DeepSearchInput {
  const parsed = deepSearchInputSchema.parse(raw);
  return {
    ...parsed,
    language: parsed.language.toLowerCase(),
    socialPlatforms: [...new Set(parsed.socialPlatforms)],
    directSocialPlatforms: [...new Set(parsed.directSocialPlatforms)].filter(
      (platform) => parsed.socialPlatforms.includes(platform),
    ),
    person: {
      familyName: compact(parsed.person.familyName),
      givenName: compact(parsed.person.givenName),
      fullName: compact(parsed.person.fullName),
      email: compact(parsed.person.email),
      phone: parsed.person.phone
        ? parsePersonPhone(parsed.person.phone, parsed.person.phoneCountry)
            ?.number
        : undefined,
      phoneCountry: compact(parsed.person.phoneCountry)?.toUpperCase(),
      username: compact(parsed.person.username)?.replace(/^@/, ""),
      profileUrl: compact(parsed.person.profileUrl),
      organization: compact(parsed.person.organization),
      other: parsed.person.other.map((row) => ({
        label: compact(row.label)!,
        value: compact(row.value)!,
      })),
    },
    topic: { question: compact(parsed.topic.question) ?? "" },
  };
}

/**
 * Họ/Tên đi kèm Họ tên đầy đủ phải nằm nguyên văn trong đó. Mọi tiêu chí là AND nên hai
 * cách viết khác nhau ("Nguyển" vs "Nguyễn") không bao giờ cùng khớp một nguồn: lượt chạy
 * tốn ngân sách mà chắc chắn 0 hồ sơ. Chỉ chặn lúc TẠO case — case cũ vẫn đọc/xuất được.
 */
export function personNameConflict(input: DeepSearchInput): string | null {
  const fullName = input.mode === "person" ? input.person.fullName : undefined;
  if (!fullName) return null;
  const parts = [
    ["Họ", input.person.familyName],
    ["Tên", input.person.givenName],
  ] as const;
  const conflict = parts.find(
    ([, value]) => value && !containsNameSequence(fullName, value),
  );
  return conflict
    ? `${conflict[0]} “${conflict[1]}” không có trong Họ tên “${fullName}”. Mọi thông tin nhập phải cùng khớp, nên hai cách viết khác nhau sẽ không tìm ra ai. Sửa cho cùng cách viết (kể cả dấu) hoặc để trống ô ${conflict[0]}.`
    : null;
}

export function criteriaForInput(
  input: DeepSearchInput,
): DeepSearchCriterion[] {
  if (input.mode !== "person") return [];
  const rows: Array<[DeepSearchCriterionField, string, string | undefined]> = [
    ["family_name", "Họ", input.person.familyName],
    ["given_name", "Tên", input.person.givenName],
    ["full_name", "Họ tên", input.person.fullName],
    ["email", "Email", input.person.email],
    ["phone", "Số điện thoại", input.person.phone],
    ["username", "Username", input.person.username],
    ["profile_url", "URL hồ sơ", input.person.profileUrl],
    ["organization", "Đơn vị", input.person.organization],
  ];
  const result: DeepSearchCriterion[] = rows.flatMap(([field, label, value]) =>
    value ? [{ id: field, field, label, value }] : [],
  );
  input.person.other.forEach((row, index) =>
    result.push({
      id: `other:${index}`,
      field: "other",
      label: row.label,
      value: row.value,
    }),
  );
  return result;
}

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

function withoutDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gu, "d")
    .replace(/Đ/gu, "D");
}

export function buildDeepSearchQueries(input: DeepSearchInput): string[] {
  if (input.mode === "topic") return [input.topic.question];
  const p = input.person;
  const identityVariants: string[] = [];
  if (p.fullName) identityVariants.push(quoted(p.fullName));
  if (p.familyName && p.givenName) {
    identityVariants.push(`${quoted(p.familyName)} ${quoted(p.givenName)}`);
    identityVariants.push(`${quoted(p.givenName)} ${quoted(p.familyName)}`);
  }
  const exactIdentifiers = [
    p.email,
    ...phoneIdentityVariants(p.phone, p.phoneCountry),
    p.username,
    p.profileUrl,
  ].filter((value): value is string => Boolean(value));
  const base = identityVariants[0] ?? quoted(criteriaForInput(input)[0]!.value);
  const anchoredIdentifiers = exactIdentifiers.map((identity) =>
    quoted(identity) === base ? base : `${base} ${quoted(identity)}`,
  );
  const hosts = SOCIAL_QUERY_HOSTS;
  const socialOrder = [
    ...input.directSocialPlatforms,
    ...input.socialPlatforms.filter(
      (platform) => !input.directSocialPlatforms.includes(platform),
    ),
  ];
  const socialQueries: string[] = [];
  const schoolFallbacks = buildSchoolDiscoveryQueries(input);
  // Tên trên mạng xã hội thường đảo thứ tự hoặc bỏ tên đệm, username ghép liền không dấu.
  const target = nameTarget(p);
  const variants = target
    ? socialQueryVariants(target)
    : { names: [], handles: [] };
  if (variants.names.length && socialOrder.length) {
    const terms = [...variants.names.map(quoted), ...variants.handles].join(
      " OR ",
    );
    socialQueries.push(
      `(${terms}) (${socialOrder.map((platform) => `site:${hosts[platform]}`).join(" OR ")})`,
    );
  }
  for (const platform of socialOrder) {
    // Context belongs in a platform query too: broad names alone can bury the
    // relevant account before the fetch budget is reached. Only submitted values.
    for (const criterion of criteriaForInput(input).filter(
      (row) => row.field === "organization" || row.field === "other",
    )) {
      if (quoted(criterion.value) !== base)
        socialQueries.push(
          `${base} ${quoted(criterion.value)} site:${hosts[platform]}`,
        );
    }
    socialQueries.push(`${base} site:${hosts[platform]}`);
    socialQueries.push(
      ...schoolFallbacks.filter((query) =>
        query.endsWith(`site:${hosts[platform]}`),
      ),
    );
  }
  // With only family + given names, the middle name is unknown. Search both orders on
  // the people-heavy source instead of spending the whole budget on one ordering.
  if (
    !p.fullName &&
    p.familyName &&
    p.givenName &&
    socialOrder.includes("facebook")
  ) {
    socialQueries.push(
      `${quoted(p.givenName)} ${quoted(p.familyName)} site:${hosts.facebook}`,
    );
    const accentlessPair = `${quoted(withoutDiacritics(p.familyName))} ${quoted(withoutDiacritics(p.givenName))} site:${hosts.facebook}`;
    if (accentlessPair !== `${base} site:${hosts.facebook}`)
      socialQueries.push(accentlessPair);
  }
  const accentlessName = p.fullName ? withoutDiacritics(p.fullName) : undefined;
  const facebookFallback =
    accentlessName &&
    accentlessName !== p.fullName &&
    input.socialPlatforms.includes("facebook")
      ? `${quoted(accentlessName)} site:${hosts.facebook}`
      : undefined;
  const contextualQueries = [
    ...(facebookFallback ? [facebookFallback] : []),
    ...identityVariants.slice(1),
    ...exactIdentifiers.map(quoted),
    ...criteriaForInput(input)
      .filter((row) => row.field === "organization" || row.field === "other")
      .map((row) => quoted(row.value)),
  ];
  if (p.organization)
    contextualQueries.push(`${base} ${quoted(p.organization)}`);
  for (const row of p.other)
    contextualQueries.push(`${base} ${quoted(row.value)}`);
  // Discovery is a union of independent searches; identity agreement is checked later.
  // A page with a phone/email but no name must still be discoverable under a small cap.
  return [
    ...new Set([
      ...exactIdentifiers.map(quoted),
      base,
      ...anchoredIdentifiers.slice(0, 1),
      ...socialQueries,
      ...contextualQueries,
      ...anchoredIdentifiers.slice(1),
    ]),
  ];
}

export const DEEP_SEARCH_LIMITS = {
  quick: { queries: 6, resultsPerSource: 5, fetchedPages: 12 },
  standard: { queries: 11, resultsPerSource: 8, fetchedPages: 40 },
  deep: { queries: 15, resultsPerSource: 10, fetchedPages: 80 },
  exhaustive: { queries: 42, resultsPerSource: 50, fetchedPages: 500 },
} as const;
