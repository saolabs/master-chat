// Person planner ported from seo-expert; server execution stays in Electron.
/**
 * Biến thể tên trên mạng xã hội. Người tên "Lê Ngọc Doãn" thường hiện là "Doãn Lê",
 * "Ngọc Doãn Lê", "Doan Le" hoặc username `lengocdoan`, `ngocdoanle` — so khớp đúng
 * thứ tự từng chữ bỏ sót toàn bộ nhóm tài khoản này.
 *
 * Hai mức có chủ đích:
 * - `reordered`: đủ MỌI chữ của họ tên, chỉ đổi thứ tự/dấu → coi như khớp tên.
 * - `partial`: bớt chữ (thường bỏ tên đệm) nhưng còn tên gọi → chỉ là "gần giống";
 *   tên phổ biến có hàng trăm tài khoản như vậy, nên cần một liên kết khác mới nối.
 */
export type NameVariant = "exact" | "reordered" | "partial";
export type NameTarget = {
  tokens: string[];
  given: string[];
  display: string[];
  openMiddle: boolean;
};

const MAX_TOKENS = 5;
const MAX_OPEN_NAME_TOKENS = 8;
const RANK: Record<NameVariant, number> = {
  exact: 3,
  reordered: 2,
  partial: 1,
};

/** Chữ thường giữ nguyên dấu — "Doãn", "Đoan", "Đoàn" là ba tên khác nhau. */
function rawTokens(value: string): string[] {
  return value
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Hai chữ là một nếu giống hệt, hoặc chữ ứng viên viết KHÔNG DẤU mà bỏ dấu thì trùng
 * ("Doan" ≈ "Doãn"). Có dấu mà dấu khác ("Đoan" vs "Doãn") là tên khác.
 */
function sameNameToken(candidate: string, target: string): boolean {
  return (
    candidate === target ||
    (/^[a-z0-9]+$/u.test(candidate) && foldName(target).join("") === candidate)
  );
}

/** Họ tên xuất hiện đúng thứ tự trong văn bản, so dấu theo `sameNameToken`. */
export function containsNameSequence(text: string, name: string): boolean {
  const target = rawTokens(name);
  if (!target.length) return false;
  return text.split(/[\n\r;|•]+/u).some((segment) => {
    const tokens = rawTokens(segment.slice(0, 300));
    for (let start = 0; start + target.length <= tokens.length; start++) {
      if (
        target.every((token, index) =>
          sameNameToken(tokens[start + index]!, token),
        )
      )
        return true;
    }
    return false;
  });
}

export function foldName(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/đ/giu, "d")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

/** Tên gọi = `givenName` nếu có, không thì chữ CUỐI (thứ tự tên tiếng Việt). */
export function nameTarget(input: {
  fullName?: string;
  familyName?: string;
  givenName?: string;
}): NameTarget | null {
  const display = (
    input.fullName ||
    [input.familyName, input.givenName].filter(Boolean).join(" ")
  )
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
  const tokens = foldName(display.join(" "));
  if (tokens.length < 2 || tokens.length !== display.length) return null;
  const given = input.givenName ? foldName(input.givenName) : tokens.slice(-1);
  return {
    tokens,
    given,
    display,
    openMiddle: !input.fullName && Boolean(input.familyName && input.givenName),
  };
}

export function bestNameVariant(
  ...variants: Array<NameVariant | null>
): NameVariant | null {
  return variants.reduce<NameVariant | null>(
    (best, row) => (row && (!best || RANK[row] > RANK[best]) ? row : best),
    null,
  );
}

/** Ghép từng chữ ứng viên với một chữ của họ tên (mỗi chữ dùng một lần); trả chỉ số đã ghép. */
function matchTokens(part: string[], whole: string[]): number[] | null {
  const used: number[] = [];
  for (const token of part) {
    const index = whole.findIndex(
      (candidate, i) => !used.includes(i) && sameNameToken(token, candidate),
    );
    if (index < 0) return null;
    used.push(index);
  }
  return used;
}

/** Tên hiển thị của tài khoản so với họ tên đang tìm. */
export function classifyNameVariant(
  candidate: string,
  target: NameTarget,
): NameVariant | null {
  const tokens = rawTokens(candidate);
  if (
    target.openMiddle &&
    target.tokens.length === 2 &&
    target.given.length === 1
  ) {
    if (tokens.length < 2 || tokens.length > MAX_OPEN_NAME_TOKENS) return null;
    const family = (token: string) =>
      sameNameToken(token, rawTokens(target.display[0]!)[0]!);
    const given = (token: string) =>
      sameNameToken(token, rawTokens(target.display[1]!)[0]!);
    if (family(tokens[0]!) && given(tokens.at(-1)!))
      return tokens.length === 2 ? "exact" : "reordered";
    if (given(tokens.at(-2)!) && family(tokens.at(-1)!)) return "reordered";
    if (given(tokens[0]!) && family(tokens[1]!)) return "reordered";
    return null;
  }
  const whole = rawTokens(target.display.join(" "));
  const used = tokens.length >= 2 ? matchTokens(tokens, whole) : null;
  if (!used) return null;
  const givenIndexes = target.given.map((token) =>
    target.tokens.lastIndexOf(token),
  );
  if (!givenIndexes.every((index) => used.includes(index))) return null;
  if (tokens.length < whole.length) return "partial";
  return used.every((index, position) => index === position)
    ? "exact"
    : "reordered";
}

/** Match a complete name span, not a substring of a longer name such as "Lê Doãn Hợp". */
export function containsOpenMiddleName(
  text: string,
  target: NameTarget,
): boolean {
  const honorifics = new Set([
    "ong",
    "ba",
    "anh",
    "chi",
    "mr",
    "mrs",
    "ms",
    "dr",
    "ts",
  ]);
  return text.split(/[\n\r;|•,.:!?()[\]{}—–]+/u).some((segment) => {
    const words = segment.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (
      words.length >= 2 &&
      words.length <= MAX_OPEN_NAME_TOKENS &&
      classifyNameVariant(words.join(" "), target)
    )
      return true;
    const casedRuns: string[][] = [];
    let run: string[] = [];
    for (const word of words) {
      if (/^\p{Lu}/u.test(word)) run.push(word);
      else if (run.length) {
        casedRuns.push(run);
        run = [];
      }
    }
    if (run.length) casedRuns.push(run);
    return casedRuns.some((rawRun) => {
      const candidate = [...rawRun];
      while (
        candidate.length &&
        honorifics.has(foldName(candidate[0]!).join(""))
      )
        candidate.shift();
      return (
        candidate.length >= 2 &&
        candidate.length <= MAX_OPEN_NAME_TOKENS &&
        Boolean(classifyNameVariant(candidate.join(" "), target))
      );
    });
  });
}

function permutations(tokens: string[]): string[][] {
  if (tokens.length <= 1) return [tokens];
  return tokens.flatMap((token, index) =>
    permutations([...tokens.slice(0, index), ...tokens.slice(index + 1)]).map(
      (rest) => [token, ...rest],
    ),
  );
}

/** Các tập con ≥2 chữ còn giữ tên gọi, mỗi tập kèm mọi thứ tự ghép liền. */
function handleSpellings(target: NameTarget): Map<string, NameVariant> {
  const spellings = new Map<string, NameVariant>();
  const n = target.tokens.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset = target.tokens.filter((_, index) => mask & (1 << index));
    if (
      subset.length < 2 ||
      !target.given.every((token) => subset.includes(token))
    )
      continue;
    const variant: NameVariant = subset.length === n ? "reordered" : "partial";
    for (const order of permutations(subset)) {
      const spelling = order.join("");
      if (spelling.length >= 5 && !spellings.has(spelling))
        spellings.set(spelling, variant);
    }
  }
  return spellings;
}

/**
 * Username so với họ tên: bỏ dấu phân cách `._-` và số đuôi (`lengocdoan98`), cả hậu
 * tố mã của LinkedIn (`an-nguyen-vu-933a69176`). Không đoán theo chữ viết tắt
 * (`lndoan`) — quá lỏng để làm tín hiệu.
 */
export function classifyHandleVariant(
  handle: string,
  target: NameTarget,
): NameVariant | null {
  const normalized = handle
    .toLowerCase()
    .replace(/-[a-z0-9]*\d[a-z0-9]*$/u, "")
    .replace(/[._-]+/gu, "")
    .replace(/\d+$/u, "");
  if (normalized.length < 5) return null;
  const known = handleSpellings(target).get(normalized);
  if (known)
    return target.openMiddle && normalized === target.tokens.join("")
      ? "exact"
      : known;
  if (
    !target.openMiddle ||
    target.tokens.length !== 2 ||
    target.given.length !== 1
  )
    return null;
  const family = target.tokens[0]!;
  const given = target.given[0]!;
  const middle = "[a-z]{2,20}";
  return new RegExp(
    `^(?:${family}${middle}${given}|${middle}${given}${family}|${given}${family}${middle})$`,
    "u",
  ).test(normalized)
    ? "reordered"
    : null;
}

/** Biến thể đưa vào truy vấn tìm kiếm: vài cách viết tên + vài username khả dĩ. */
export function socialQueryVariants(target: NameTarget): {
  names: string[];
  handles: string[];
} {
  const [family, ...rest] = target.display;
  const given = rest.at(-1);
  const middle = rest.slice(0, -1);
  if (!family || !given) return { names: [], handles: [] };
  const original = target.display.join(" ");
  const names = [
    [given, family, ...middle],
    [...middle, given, family],
    [given, family],
  ]
    .map((row) => row.join(" "))
    .filter((row) => row !== original);
  const t = target.tokens;
  const handles = [
    t.join(""),
    [...t.slice(1), t[0]].join(""),
    `${t.at(-1)}${t[0]}`,
    `${t[0]}${t.at(-1)}`,
  ];
  return {
    names: [...new Set(names)].slice(0, 3),
    handles: [...new Set(handles)].filter((row) => row.length >= 5).slice(0, 3),
  };
}
