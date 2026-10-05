// Person planner ported from seo-expert; server execution stays in Electron.
export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "youtube",
  "tiktok",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_HOSTS: Record<SocialPlatform, string[]> = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  linkedin: ["linkedin.com"],
  x: ["x.com", "twitter.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
};

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  youtube: "YouTube",
  tiktok: "TikTok",
};

/** Earliest public launch (TikTok: Douyin). Someone who died before it had no personal account there. */
export const SOCIAL_LAUNCH_YEAR: Record<SocialPlatform, number> = {
  linkedin: 2003,
  facebook: 2004,
  youtube: 2005,
  x: 2006,
  instagram: 2010,
  tiktok: 2016,
};

export const SOCIAL_QUERY_HOSTS: Record<SocialPlatform, string> = {
  facebook: "facebook.com",
  instagram: "instagram.com",
  linkedin: "linkedin.com/in",
  x: "x.com",
  youtube: "youtube.com",
  tiktok: "tiktok.com",
};

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}
