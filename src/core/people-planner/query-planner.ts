// Person planner ported from seo-expert; server execution stays in Electron.

import { SOCIAL_QUERY_HOSTS } from "./social-platforms.ts";

import {
  buildDeepSearchQueries,
  criteriaForInput,
  phoneIdentityVariants,
  type DeepSearchInput,
} from "./input.ts";

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function validOneLineQuery(value: string): boolean {
  return (
    Boolean(value.trim()) && value.length <= 300 && !/[\r\n\0]/u.test(value)
  );
}

function topicQueryKeepsSubject(
  input: DeepSearchInput,
  query: string,
): boolean {
  const tokens = fold(input.topic.question)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
  const normalizedQuery = fold(query);
  return (
    tokens.length === 0 ||
    tokens.some((token) => normalizedQuery.includes(token))
  );
}

export function reconcileDeepSearchQueries(input: {
  searchInput: DeepSearchInput;
  aiQueries: readonly string[];
  maxQueries: number;
}): string[] {
  const deterministic = buildDeepSearchQueries(input.searchInput);
  const validAi = input.aiQueries
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter(validOneLineQuery)
    .filter((query) =>
      input.searchInput.mode === "person"
        ? deterministic.includes(query)
        : topicQueryKeepsSubject(input.searchInput, query),
    );
  const platformOrder = [
    ...input.searchInput.directSocialPlatforms,
    ...input.searchInput.socialPlatforms.filter(
      (platform) => !input.searchInput.directSocialPlatforms.includes(platform),
    ),
  ];
  const platformQueues = platformOrder.map((platform) =>
    deterministic.filter(
      (query) =>
        !query.includes(" OR ") &&
        query.includes(`site:${SOCIAL_QUERY_HOSTS[platform]}`),
    ),
  );
  const social: string[] = [];
  for (let index = 0; platformQueues.some((queue) => queue[index]); index++) {
    for (const queue of platformQueues)
      if (queue[index]) social.push(queue[index]!);
  }
  const discriminating = criteriaForInput(input.searchInput).filter(
    (row) => !["full_name", "family_name", "given_name"].includes(row.field),
  );
  const standalone = (value: string) =>
    `"${value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
  const independentContacts = discriminating
    .filter((row) =>
      ["phone", "email", "username", "profile_url"].includes(row.field),
    )
    .map((row) =>
      standalone(
        row.field === "phone"
          ? phoneIdentityVariants(
              row.value,
              input.searchInput.person.phoneCountry,
            )[0]!
          : row.value,
      ),
    );
  const nameQuery =
    deterministic.find(
      (query) =>
        !query.includes("site:") &&
        (input.searchInput.person.fullName
          ? query === standalone(input.searchInput.person.fullName)
          : input.searchInput.person.familyName &&
              input.searchInput.person.givenName
            ? query ===
              `${standalone(input.searchInput.person.familyName)} ${standalone(input.searchInput.person.givenName)}`
            : false),
    ) ?? deterministic[0]!;
  const contextual = discriminating.flatMap((criterion) => {
    const values =
      criterion.field === "phone"
        ? phoneIdentityVariants(
            criterion.value,
            input.searchInput.person.phoneCountry,
          )
        : [criterion.value];
    return deterministic.filter(
      (query) =>
        !query.includes("site:") &&
        query !== nameQuery &&
        values.some((value) => fold(query).includes(fold(value))),
    );
  });
  // First cover each criterion with one anchored query. Standalone/alternate spellings follow.
  const primaryContext = discriminating.flatMap((criterion) => {
    const value =
      criterion.field === "phone"
        ? phoneIdentityVariants(
            criterion.value,
            input.searchInput.person.phoneCountry,
          )[0]!
        : criterion.value;
    const query = contextual.find(
      (query) =>
        query.startsWith(nameQuery) && fold(query).includes(fold(value)),
    );
    return query ? [query] : [];
  });
  const fair: string[] = [];
  for (
    let index = 0;
    index < Math.max(primaryContext.length, social.length);
    index++
  ) {
    if (primaryContext[index]) fair.push(primaryContext[index]!);
    if (social[index]) fair.push(social[index]!);
  }
  const ordered = [
    ...independentContacts,
    nameQuery,
    ...fair,
    ...contextual,
    ...validAi,
    ...deterministic,
  ].filter((query): query is string => Boolean(query));
  const seen = new Set<string>();
  return ordered
    .filter((query) => {
      const key = query.toLocaleLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, input.maxQueries);
}

/** Coverage describes scheduled searches, never claims that a network was exhaustively searched. */
export function describeQueryCoverage(
  input: DeepSearchInput,
  queries: string[],
) {
  const criteria = criteriaForInput(input);
  const scheduledCriteria = criteria
    .filter((criterion) =>
      queries.some((query) => {
        const values =
          criterion.field === "phone"
            ? phoneIdentityVariants(criterion.value, input.person.phoneCountry)
            : [criterion.value];
        return values.some((value) => fold(query).includes(fold(value)));
      }),
    )
    .map((criterion) => criterion.id);
  const scheduledPlatforms = input.socialPlatforms.filter((platform) =>
    queries.some((query) =>
      query.includes(`site:${SOCIAL_QUERY_HOSTS[platform]}`),
    ),
  );
  return {
    scheduledCriteria,
    deferredCriteria: criteria
      .filter((row) => !scheduledCriteria.includes(row.id))
      .map((row) => row.id),
    scheduledPlatforms,
    deferredPlatforms: input.socialPlatforms.filter(
      (platform) => !scheduledPlatforms.includes(platform),
    ),
  };
}
