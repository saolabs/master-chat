import type { ResearchHit, PeoplePageMetadata } from "./people-search.ts";

export type ResearchPage = {
  state: "ready" | "waiting" | "loading";
  url: string;
  title: string;
  text: string;
  hits: ResearchHit[];
  reason?: string;
  metadata?: PeoplePageMetadata;
  nextUrl?: string;
};
// Runs inside the unprivileged page. Read visible content only; no private APIs/stores.
export function readResearchDOM(search: boolean, limit = 10): ResearchPage {
  const visible = (element: Element) => {
    const s = getComputedStyle(element);
    return (
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  };
  const plain = (element: Element | null) =>
    element
      ? ((element as HTMLElement).innerText ?? element.textContent ?? "").trim()
      : "";
  const text = plain(document.body).slice(0, 60000);
  const lower = text.toLowerCase();
  const waiting =
    /\/sorry(?:\/|\?)|\/checkpoint\//i.test(location.href) ||
    /unusual traffic|verify (?:that )?you are human|confirm you are human|security check|xác minh.*(?:con người|robot)|lưu lượng truy cập bất thường|checking your browser|access denied/.test(
      lower,
    ) ||
    [
      ...document.querySelectorAll(
        'iframe[src*="recaptcha"],iframe[src*="hcaptcha"], [id*="captcha"], [class*="captcha"]',
      ),
    ].some(visible);
  const login = [...document.querySelectorAll('input[type="password"]')].some(
    visible,
  );
  const consent =
    search &&
    (/before you continue to google|trước khi bạn tiếp tục truy cập google/.test(
      lower,
    ) ||
      location.hostname === "consent.google.com");
  if (waiting || login || consent)
    return {
      state: "waiting",
      url: location.href,
      title: document.title,
      text: "",
      hits: [],
      reason: waiting
        ? "Trang yêu cầu CAPTCHA hoặc xác minh. Hoàn tất trong trình duyệt rồi bấm Tiếp tục."
        : login
          ? "Trang yêu cầu đăng nhập. Đăng nhập trong trình duyệt rồi bấm Tiếp tục."
          : "Trang yêu cầu xác nhận cookie. Hoàn tất trong trình duyệt rồi bấm Tiếp tục.",
    };
  const hits: ResearchHit[] = [];
  if (search) {
    for (const heading of document.querySelectorAll(
      'h3, h2, a.result__a, a[data-testid="result-title-a"]',
    )) {
      if (!visible(heading)) continue;
      const anchor =
        heading.closest("a[href]") || heading.querySelector("a[href]");
      if (!anchor) continue;
      let url: URL;
      try {
        url = new URL(anchor.getAttribute("href") || "", location.href);
        if (/(^|\.)google\.com$/.test(url.hostname) && url.pathname === "/url")
          url = new URL(
            url.searchParams.get("q") || url.searchParams.get("url") || "",
          );
        if (
          /(^|\.)duckduckgo\.com$/.test(url.hostname) &&
          url.searchParams.has("uddg")
        )
          url = new URL(url.searchParams.get("uddg")!);
        if (
          /(^|\.)bing\.com$/.test(url.hostname) &&
          url.pathname.startsWith("/ck/")
        ) {
          const encoded = url.searchParams.get("u") || "";
          if (encoded.startsWith("a1"))
            url = new URL(
              atob(encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/")),
            );
        }
        if (
          url.protocol !== "https:" ||
          /^(?:www\.)?(?:google|bing|duckduckgo)\.com$/.test(url.hostname)
        )
          continue;
      } catch {
        continue;
      }
      const title = plain(heading).slice(0, 400);
      if (!title || hits.some((h) => h.url === url.toString())) continue;
      const container =
        heading.closest(
          'li.b_algo, .result, [data-testid="result"], div.MjjYud',
        ) || anchor.parentElement?.parentElement;
      hits.push({
        url: url.toString(),
        title,
        snippet: plain(container || anchor).slice(0, 1400),
      });
      if (hits.length >= limit) break;
    }
  }
  const platform = location.hostname.replace(/^(www|m)\./, ""),
    direct =
      search &&
      [
        "facebook.com",
        "instagram.com",
        "linkedin.com",
        "x.com",
        "twitter.com",
        "youtube.com",
        "tiktok.com",
      ].includes(platform);
  if (direct) {
    const profilePath = (u: URL) => {
      if (u.hostname.replace(/^(www|m)\./, "") !== platform) return false;
      if (platform === "facebook.com")
        return (
          (u.pathname === "/profile.php" &&
            /^\d+$/.test(u.searchParams.get("id") || "")) ||
          (/^\/[\w.]+\/?$/.test(u.pathname) &&
            !/^\/(search|groups|pages|events|watch|reels?|login|help|settings|marketplace|friends|home|notifications)(?:\/|$)/.test(
              u.pathname,
            ))
        );
      if (platform === "instagram.com")
        return (
          /^\/[\w.]+\/?$/.test(u.pathname) &&
          !/^\/(explore|accounts|direct|reels?|p)(?:\/|$)/.test(u.pathname)
        );
      if (platform === "linkedin.com")
        return /^\/in\/[^/]+\/?$/.test(u.pathname);
      if (platform === "youtube.com")
        return /^\/(?:@[^/]+|channel\/[^/]+|user\/[^/]+)\/?$/.test(u.pathname);
      if (platform === "tiktok.com") return /^\/@[^/]+\/?$/.test(u.pathname);
      return (
        /^\/[\w]+\/?$/.test(u.pathname) &&
        !/^\/(search|home|explore|settings|messages|i)(?:\/|$)/.test(u.pathname)
      );
    };
    // Direct people/channel search uses account anchors rather than SERP headings.
    hits.length = 0;
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (
        !visible(anchor) ||
        anchor.closest(
          'nav,header,[role="navigation"],[role="banner"],[role="complementary"]',
        )
      )
        continue;
      try {
        const u = new URL(anchor.getAttribute("href") || "", location.href);
        if (u.protocol !== "https:" || !profilePath(u)) continue;
        const title = plain(anchor).replace(/\s+/g, " ").slice(0, 400);
        if (
          !title ||
          /^(?:follow|following|add friend|message|theo dõi|kết bạn|nhắn tin)$/i.test(
            title,
          )
        )
          continue;
        if (hits.some((h) => h.url === u.toString())) continue;
        const card =
          anchor.closest('[role="listitem"],ytd-channel-renderer,li') ||
          anchor.parentElement?.parentElement;
        hits.push({
          url: u.toString(),
          title,
          snippet: plain(card || anchor).slice(0, 1400),
        });
        if (hits.length >= limit) break;
      } catch {}
    }
  }
  const metadata: PeoplePageMetadata = { links: [] };
  if (!search) {
    metadata.displayName =
      plain(document.querySelector("h1")) ||
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content") ||
      undefined;
    metadata.description =
      document
        .querySelector(
          'meta[property="og:description"],meta[name="description"]',
        )
        ?.getAttribute("content")
        ?.slice(0, 2000) || undefined;
    const addLink = (
      url: string,
      label: string,
      kind: PeoplePageMetadata["links"][number]["kind"],
    ) => {
      try {
        const u = new URL(url, location.href);
        if (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !metadata.links.some((l) => l.url === u.toString())
        )
          metadata.links.push({
            url: u.toString(),
            label: label.slice(0, 200),
            kind,
          });
      } catch {}
    };
    for (const anchor of document.querySelectorAll('a[rel~="me"]'))
      addLink(anchor.getAttribute("href") || "", plain(anchor), "rel_me");
    for (const script of document.querySelectorAll(
      'script[type="application/ld+json"]',
    )) {
      try {
        const walk = (v: unknown, depth: number) => {
          if (depth > 6 || !v || typeof v !== "object") return;
          if (Array.isArray(v)) {
            v.slice(0, 40).forEach((row) => walk(row, depth + 1));
            return;
          }
          const row = v as Record<string, unknown>;
          if (
            row["@type"] === "Person" ||
            (Array.isArray(row["@type"]) && row["@type"].includes("Person"))
          ) {
            if (!metadata.displayName && typeof row.name === "string")
              metadata.displayName = row.name.slice(0, 400);
            const same = Array.isArray(row.sameAs) ? row.sameAs : [row.sameAs];
            for (const url of same)
              if (typeof url === "string")
                addLink(
                  url,
                  typeof row.name === "string" ? row.name : "",
                  "same_as",
                );
          }
          Object.values(row)
            .slice(0, 40)
            .forEach((x) => walk(x, depth + 1));
        };
        walk(JSON.parse(script.textContent || ""), 0);
      } catch {}
    }
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (!visible(anchor) || metadata.links.length >= 16) continue;
      try {
        const u = new URL(anchor.getAttribute("href") || "", location.href),
          label = plain(anchor);
        if (u.toString() === location.href || !label) continue;
        if (
          /(^|\.)(facebook|instagram|linkedin|x|twitter|youtube|tiktok)\.com$/.test(
            u.hostname,
          ) &&
          !/\/(?:search|share|intent)(?:\/|$)/.test(u.pathname)
        )
          addLink(
            u.toString(),
            label,
            /\/(posts|status|video|videos)\//.test(u.pathname)
              ? "activity"
              : "profile",
          );
      } catch {}
    }
    metadata.links = metadata.links.slice(0, 16);
  }
  let nextUrl: string | undefined;
  if (search && !direct) {
    const anchor = document.querySelector(
      'a#pnnext,a.sb_pagN,a[rel="next"],a[aria-label="Next page"],a[aria-label="Trang tiếp theo"]',
    );
    try {
      if (anchor) {
        const u = new URL(anchor.getAttribute("href") || "", location.href);
        const current = new URL(location.href);
        if (
          u.protocol === "https:" &&
          u.hostname === current.hostname &&
          u.pathname === current.pathname &&
          u.searchParams.get("q") === current.searchParams.get("q")
        )
          nextUrl = u.toString();
      }
    } catch {}
  }
  const noResults =
    /did not match any documents|no results found|there are no results|không khớp với bất kỳ tài liệu|không tìm thấy kết quả|không có kết quả/.test(
      lower,
    );
  const ready = search ? hits.length > 0 || noResults : text.length >= 80;
  return {
    state: ready ? "ready" : "loading",
    url: location.href,
    title: document.title,
    text: search ? "" : text,
    hits,
    ...(!search ? { metadata } : {}),
    ...(nextUrl ? { nextUrl } : {}),
  };
}
export function researchReadScript(search: boolean, limit = 10) {
  return `(() => {const __name=(value)=>value; return (${readResearchDOM.toString()})(${JSON.stringify(search)},${JSON.stringify(limit)});})()`;
}
