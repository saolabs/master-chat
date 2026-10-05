// Person planner ported from seo-expert; server execution stays in Electron.
import type { DeepSearchInput } from "./input.ts";
import { SOCIAL_QUERY_HOSTS } from "./social-platforms.ts";

function quoted(value: string): string {
  return `"${value.replace(/["\\]/gu, " ").replace(/\s+/gu, " ").trim()}"`;
}

function accentless(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d");
}

/** Discovery only: remove an explicit school-type prefix/suffix already supplied.
 * Never translate, invent a city/middle name, or relax the matching criteria. */
export function schoolDiscoveryName(value: string): string | null {
  const clean = value.replace(/\s+/gu, " ").trim();
  const shorter = clean
    .replace(
      /^(?:trường\s+)?(?:THPT|THCS|tiểu học|trung học phổ thông|trung học cơ sở)\s+/iu,
      "",
    )
    .replace(/\s+(?:high school|secondary school|primary school)$/iu, "")
    .trim();
  const tokens = shorter.match(/[\p{L}\p{N}]+/gu) ?? [];
  return shorter !== clean &&
    tokens.length >= 2 &&
    new Set(tokens.map((token) => token.toLowerCase())).size >= 2
    ? shorter
    : null;
}

/** Bounded alternatives derived exclusively from the submitted name and school.
 * A shortened school label is a fetch hint, never a newly asserted affiliation. */
export function buildSchoolDiscoveryQueries(input: DeepSearchInput): string[] {
  if (input.mode !== "person") return [];
  const person = input.person;
  const anchor = person.fullName
    ? quoted(person.fullName)
    : person.familyName && person.givenName
      ? `${quoted(person.familyName)} ${quoted(person.givenName)}`
      : null;
  if (!anchor) return [];
  const contexts = [
    person.organization,
    ...person.other.map((row) => row.value),
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      const name = schoolDiscoveryName(value);
      return name ? [name] : [];
    });
  const platforms = [
    ...input.directSocialPlatforms,
    ...input.socialPlatforms.filter(
      (platform) => !input.directSocialPlatforms.includes(platform),
    ),
  ];
  const queues = platforms.map((platform) =>
    contexts.flatMap((school) => {
      const scoped = `${anchor} ${quoted(school)} site:${SOCIAL_QUERY_HOSTS[platform]}`;
      return [scoped, accentless(scoped)];
    }),
  );
  const queries: string[] = [];
  for (let index = 0; queues.some((queue) => queue[index]); index++) {
    for (const queue of queues) if (queue[index]) queries.push(queue[index]!);
  }
  return [...new Set(queries)].filter(
    (query) => query.length <= 300 && !/[\r\n\0]/u.test(query),
  );
}
