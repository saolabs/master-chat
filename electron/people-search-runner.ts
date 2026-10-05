import { randomUUID } from "node:crypto";
import {
  buildPeopleQueries,
  buildPeopleFocusQueries,
  buildPeopleTasks,
  peopleCoverage,
  PEOPLE_BUDGETS,
  peopleAccountUrl,
  directPeopleUrl,
  plannerInput,
  buildPeopleCandidates,
  canonicalResearchUrl,
  peopleSearchInputSchema,
  peopleSearchUrl,
  planPeopleSources,
  type PeopleSearchInput,
  type PeopleSearchJob,
} from "../src/core/people-search.ts";
import {
  nameTarget,
  classifyNameVariant,
  containsNameSequence,
} from "../src/core/people-planner/name-variants.ts";
import type { ResearchPage } from "../src/core/people-search-dom.ts";

export type ResearchTransport = {
  read(
    url: string,
    search: boolean,
    resume: boolean,
    accountId?: string,
    limit?: number,
  ): Promise<ResearchPage>;
  show(url?: string, accountId?: string): Promise<void>;
  stop(): void;
};
export type PeopleSearchStore = {
  read(): { peopleSearches?: PeopleSearchJob[] };
  mutate<T>(
    fn: (state: { peopleSearches?: PeopleSearchJob[] }) => T,
  ): Promise<T>;
};
export class ResearchPausedError extends Error {
  constructor() {
    super("Trình duyệt đã đóng. Bấm Tiếp tục để mở lại lượt tìm kiếm.");
    this.name = "ResearchPausedError";
  }
}
export class PeopleSearchRunner {
  private running: string | null = null;
  private changing = false;
  private generation = 0;
  private analysisController?: AbortController;
  private task: Promise<void> = Promise.resolve();
  constructor(
    private store: PeopleSearchStore,
    private browser: ResearchTransport,
    private changed: () => void,
    private analyze?: (
      jobId: string,
      candidateId: string,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {}
  private job(id: string) {
    const job = this.store.read().peopleSearches?.find((j) => j.id === id);
    if (!job) throw new Error("Lượt tìm kiếm không tồn tại.");
    return job;
  }
  private async update(id: string, fn: (job: PeopleSearchJob) => void) {
    await this.store.mutate((s) => {
      const job = s.peopleSearches?.find((j) => j.id === id);
      if (!job) return;
      fn(job);
      job.updatedAt = Date.now();
      job.candidates = buildPeopleCandidates(job);
    });
    this.changed();
  }
  async start(
    raw: PeopleSearchInput,
    context?: { focus: string; parentJobId: string },
  ) {
    if (
      this.changing ||
      this.running ||
      this.store
        .read()
        .peopleSearches?.some(
          (j) =>
            ["waiting", "paused", "running"].includes(j.status) || j.analyzing,
        )
    )
      throw new Error(
        "Tiếp tục hoặc dừng lượt tìm kiếm hiện tại trước khi tạo lượt mới.",
      );
    const input = peopleSearchInputSchema.parse(raw),
      normalized = plannerInput(input);
    input.phone = normalized.person.phone || "";
    input.username = normalized.person.username || "";
    input.phoneCountry = normalized.person.phoneCountry || "VN";
    input.language = normalized.language;
    input.platforms = normalized.socialPlatforms;
    input.directPlatforms = normalized.directSocialPlatforms;
    const now = Date.now();
    const job: PeopleSearchJob = {
      id: randomUUID(),
      input,
      queries: buildPeopleQueries(input),
      status: "running",
      phase: "search",
      cursor: 0,
      sourceCursor: 0,
      sourceUrls: [],
      evidence: [],
      candidates: [],
      errors: [],
      createdAt: now,
      updatedAt: now,
      message: "Đang chuẩn bị truy vấn…",
      ...(context ? context : {}),
    };
    if (input.profileUrl)
      job.evidence.push({
        id: randomUUID(),
        url: input.profileUrl,
        title: "Hồ sơ được nhập",
        snippet: "",
        query: "",
        engine: "direct",
        capturedAt: now,
      });
    if (context?.focus) {
      const hints = buildPeopleFocusQueries(input, context.focus);
      job.queries = [...new Set([...hints, ...job.queries])].slice(
        0,
        PEOPLE_BUDGETS[input.depth].queries,
      );
    }
    job.tasks = buildPeopleTasks(input, job.queries);
    job.coverage = peopleCoverage(input, job.queries);
    this.changing = true;
    try {
      await this.store.mutate((s) => {
        s.peopleSearches = [job, ...(s.peopleSearches || [])].slice(0, 20);
      });
      this.launch(job.id, false);
    } finally {
      this.changing = false;
    }
  }
  async resume(id: string) {
    if (this.changing || this.running)
      throw new Error("Lượt tìm kiếm đang chạy.");
    const job = this.job(id);
    if (!["waiting", "paused"].includes(job.status))
      throw new Error("Lượt tìm kiếm không đang chờ.");
    this.changing = true;
    try {
      await this.update(id, (j) => {
        j.status = "running";
        j.message = "Đang tiếp tục…";
      });
      this.launch(id, job.status === "waiting");
    } finally {
      this.changing = false;
    }
  }
  async skip(id: string) {
    const job = this.job(id);
    if (
      this.changing ||
      this.running ||
      !["waiting", "paused"].includes(job.status)
    )
      throw new Error("Chỉ bỏ qua khi lượt tìm đang chờ.");
    this.changing = true;
    try {
      await this.update(id, (j) => {
        j.errors.push(
          `Đã bỏ qua ${j.phase === "search" ? "truy vấn" : "nguồn"} theo lựa chọn của bạn.`,
        );
        if (j.phase === "search") j.cursor++;
        else j.sourceCursor++;
        j.status = "running";
      });
      this.launch(id, false);
    } finally {
      this.changing = false;
    }
  }
  async cancel(id: string) {
    const job = this.job(id);
    if (
      !["running", "waiting", "paused"].includes(job.status) &&
      this.running !== id
    )
      return;
    if (this.changing)
      throw new Error("Đang cập nhật lượt tìm kiếm. Thử lại sau.");
    this.changing = true;
    try {
      ++this.generation;
      this.analysisController?.abort();
      this.browser.stop();
      // Retire the old transport before another run can reuse its page.
      await this.task;
      await this.update(id, (j) => {
        if (["running", "waiting", "paused", "completed"].includes(j.status)) {
          j.status = "cancelled";
          j.analyzing = false;
          j.message = "Đã dừng. Kết quả thu thập được giữ lại.";
        }
      });
    } finally {
      this.changing = false;
    }
  }
  async remove(id: string) {
    const job = this.job(id);
    if (["running", "waiting", "paused"].includes(job.status) || job.analyzing)
      await this.cancel(id);
    await this.store.mutate((s) => {
      s.peopleSearches = s.peopleSearches?.filter((j) => j.id !== id);
    });
    this.changed();
  }
  async show(id: string, url?: string) {
    const job = this.job(id);
    const active = this.store
      .read()
      .peopleSearches?.find((j) =>
        ["running", "waiting", "paused"].includes(j.status),
      );
    if (active && active.id !== id)
      throw new Error("Trình duyệt đang phục vụ một lượt tìm kiếm khác.");
    if (url) {
      if (this.running || job.status === "waiting")
        throw new Error("Dừng lượt tìm kiếm trước khi mở một nguồn khác.");
      if (
        !job.evidence.some(
          (e) => canonicalResearchUrl(e.url) === canonicalResearchUrl(url),
        )
      )
        throw new Error("Nguồn không thuộc lượt tìm kiếm.");
    }
    await this.browser.show(
      url ||
        (!active
          ? job.sourceUrls.at(-1) ||
            peopleSearchUrl(job.input.engines[0], job.queries[0])
          : undefined),
      job.input.accountId,
    );
  }
  private launch(id: string, resume: boolean) {
    this.running = id;
    const generation = ++this.generation;
    this.changed();
    this.task = this.run(id, resume, generation)
      .catch(async () => {
        if (generation === this.generation)
          await this.update(id, (j) => {
            j.status = "failed";
            j.analyzing = false;
            j.message =
              "Không hoàn tất lượt tìm kiếm. Kết quả đã thu thập được giữ lại.";
          });
      })
      .finally(() => {
        if (this.running === id) this.running = null;
        this.changed();
      });
  }
  async idle() {
    await this.task;
  }
  shutdown() {
    ++this.generation;
    this.analysisController?.abort();
    this.browser.stop();
  }
  private async run(id: string, resume: boolean, generation: number) {
    while (generation === this.generation) {
      let job = this.job(id);
      if (job.status !== "running") return;
      const tasks =
        job.tasks ||
        buildPeopleTasks({ ...job.input, directPlatforms: [] }, job.queries);
      const total = tasks.length;
      if (job.phase === "search" && job.cursor >= total) {
        const target = nameTarget(job.input);
        const observed =
          target?.openMiddle && !job.researchRound
            ? [
                ...new Set(
                  job.evidence
                    .filter((e) => e.engine === "direct")
                    .map((e) => e.title.split(/\s*[|·]\s*/)[0])
                    .filter(
                      (n) =>
                        n.split(/\s+/).length > 2 &&
                        classifyNameVariant(n, target),
                    ),
                ),
              ].slice(0, 2)
            : [];
        if (observed.length) {
          await this.update(id, (j) => {
            j.researchRound = 1;
            j.tasks = tasks;
            for (const name of observed) {
              const query = `"${name.replace(/"/g, "")}"`;
              j.queries.push(query);
              for (const engine of j.input.engines)
                j.tasks!.push({
                  query,
                  engine,
                  url: peopleSearchUrl(engine, query, j.input.language),
                });
              if (j.input.directPlatforms?.includes("facebook"))
                j.tasks!.push({
                  query: name,
                  engine: "direct",
                  platform: "facebook",
                  url: directPeopleUrl("facebook", name),
                });
            }
          });
          continue;
        }
        await this.update(id, (j) => {
          j.phase = "sources";
          j.sourceUrls = planPeopleSources(j);
          for (const e of [...j.evidence]) {
            const root = peopleAccountUrl(e.url);
            if (
              root !== canonicalResearchUrl(e.url) &&
              !j.evidence.some((row) => canonicalResearchUrl(row.url) === root)
            ) {
              j.evidence.push({
                ...e,
                id: randomUUID(),
                url: root,
                query: "Hồ sơ tài khoản từ URL nguồn",
                engine: "direct",
                discoveredFrom: e.id,
              });
              j.sourceUrls.unshift(root);
            }
          }
          if (j.input.profileUrl)
            j.sourceUrls.unshift(canonicalResearchUrl(j.input.profileUrl));
          j.sourceUrls = [...new Set(j.sourceUrls)].slice(
            0,
            PEOPLE_BUDGETS[j.input.depth].sources,
          );
        });
        job = this.job(id);
      }
      if (
        job.phase === "sources" &&
        job.sourceCursor >= job.sourceUrls.length
      ) {
        await this.update(id, (j) => {
          j.status = "completed";
          j.analyzing = Boolean(j.input.analyzeOnComplete && this.analyze);
          j.message = j.errors.length
            ? "Đã hoàn tất với một số nguồn chưa đọc được."
            : "Đã hoàn tất. Các kết quả là đầu mối cần đối chiếu danh tính.";
        });
        if (job.input.analyzeOnComplete && this.analyze) {
          this.analysisController = new AbortController();
          const candidates = this.job(id).candidates.filter((c) =>
            c.evidenceIds.some((eid) =>
              job.evidence.some((e) => e.id === eid && e.text && e.readAt),
            ),
          );
          for (
            let index = 0;
            index < candidates.length && generation === this.generation;
            index++
          ) {
            await this.update(id, (j) => {
              j.message = `Đọc hồ sơ với AI ${index + 1}/${candidates.length}…`;
            });
            try {
              await this.analyze(
                id,
                candidates[index].id,
                this.analysisController.signal,
              );
            } catch {
              if (generation === this.generation)
                await this.update(id, (j) => {
                  (j.analysisErrors ||= []).push(
                    `Chưa phân tích được ${candidates[index].title}`,
                  );
                });
            }
          }
          if (generation === this.generation)
            await this.update(id, (j) => {
              j.analyzing = false;
              j.message = `Hoàn tất tìm kiếm và dựng báo cáo. ${j.analysisErrors?.length || 0} hồ sơ chưa phân tích được.`;
            });
        }
        return;
      }
      const search = job.phase === "search";
      const task = tasks[job.cursor];
      const query = search ? task.query : "";
      const engine = search ? task.engine : "direct";
      const url = search ? task.url : job.sourceUrls[job.sourceCursor];
      await this.update(id, (j) => {
        j.message = search
          ? `Truy vấn ${j.cursor + 1}/${total}: ${query}`
          : `Đọc nguồn ${j.sourceCursor + 1}/${j.sourceUrls.length}`;
      });
      if (generation !== this.generation) return;
      let page: ResearchPage;
      try {
        page = await this.browser.read(
          url,
          search,
          resume,
          job.input.accountId,
          engine === "direct" && search
            ? Math.max(24, PEOPLE_BUDGETS[job.input.depth].results)
            : PEOPLE_BUDGETS[job.input.depth].results,
        );
      } catch (error) {
        if (generation !== this.generation) return;
        if (error instanceof ResearchPausedError) {
          await this.update(id, (j) => {
            j.status = "paused";
            j.message = error.message;
          });
          return;
        }
        await this.update(id, (j) => {
          j.errors.push(
            search
              ? `Không đọc được truy vấn ${j.cursor + 1} (${engine}).`
              : `Không đọc được nguồn: ${url}`,
          );
          if (search) j.cursor++;
          else {
            j.sourceCursor++;
            for (const e of j.evidence)
              if (canonicalResearchUrl(e.url) === url)
                e.error = "Không đọc được nội dung nguồn.";
          }
        });
        resume = false;
        continue;
      }
      if (generation !== this.generation) return;
      if (page.state !== "ready") {
        await this.update(id, (j) => {
          j.status = "waiting";
          j.message =
            page.reason ||
            "Trang chưa có nội dung đọc được. Kiểm tra trình duyệt rồi bấm Tiếp tục.";
        });
        await this.browser.show(undefined, job.input.accountId);
        return;
      }
      await this.update(id, (j) => {
        if (search) {
          for (const hit of page.hits.slice(
            0,
            engine === "direct"
              ? Math.max(24, PEOPLE_BUDGETS[j.input.depth].results)
              : PEOPLE_BUDGETS[j.input.depth].results,
          ))
            try {
              const clean = canonicalResearchUrl(hit.url);
              if (
                !j.evidence.some(
                  (e) =>
                    canonicalResearchUrl(e.url) === clean &&
                    e.query === query &&
                    e.engine === engine,
                )
              )
                j.evidence.push({
                  ...hit,
                  url: clean,
                  title: hit.title.slice(0, 400),
                  snippet: hit.snippet.slice(0, 1400),
                  id: randomUUID(),
                  query,
                  engine,
                  capturedAt: Date.now(),
                });
            } catch {}
          if (
            page.nextUrl &&
            engine !== "direct" &&
            PEOPLE_BUDGETS[j.input.depth].results > 10 &&
            (task.page || 1) < 5
          ) {
            try {
              const next = new URL(canonicalResearchUrl(page.nextUrl)),
                current = new URL(url);
              if (
                next.hostname === current.hostname &&
                next.pathname === current.pathname &&
                next.searchParams.get("q") === query &&
                !tasks.some((t) => t.url === next.toString())
              ) {
                j.tasks ||= tasks;
                j.tasks.splice(j.cursor + 1, 0, {
                  ...task,
                  url: next.toString(),
                  page: (task.page || 1) + 1,
                });
              }
            } catch {}
          }
          j.cursor++;
        } else {
          // The transport checks navigation identity; do not turn a SERP lead into verified identity.
          const e = j.evidence.find((e) => canonicalResearchUrl(e.url) === url);
          if (e) {
            e.text = page.text.slice(0, 60000);
            e.metadata = page.metadata;
            e.readAt = Date.now();
            e.title = page.title.slice(0, 400) || e.title;
            delete e.error;
            // Follow discovered public profile/activity links in two bounded rounds.
            let depth = 0,
              parent = e;
            const seen = new Set<string>();
            while (parent.discoveredFrom && !seen.has(parent.id)) {
              seen.add(parent.id);
              depth++;
              const p = j.evidence.find(
                (row) => row.id === parent.discoveredFrom,
              );
              if (!p) break;
              parent = p;
            }
            const owner = page.metadata?.displayName || page.title;
            const target = nameTarget(j.input);
            const nameMatched = target
              ? Boolean(
                  classifyNameVariant(owner.split(/\s*[|·]\s*/)[0], target),
                ) ||
                containsNameSequence(
                  owner,
                  j.input.fullName || target.display.join(" "),
                )
              : false;
            if (depth < 2 && nameMatched)
              for (const link of (page.metadata?.links || []).slice(0, 8)) {
                try {
                  const clean = canonicalResearchUrl(link.url);
                  if (
                    j.evidence.some(
                      (row) => canonicalResearchUrl(row.url) === clean,
                    ) ||
                    j.sourceUrls.length >= PEOPLE_BUDGETS[j.input.depth].sources
                  )
                    continue;
                  j.evidence.push({
                    id: randomUUID(),
                    url: clean,
                    title: link.label || clean,
                    snippet: `Liên kết ${link.kind} được trang nguồn công bố; chưa xác minh danh tính.`,
                    query: "Liên kết từ nguồn",
                    engine: "direct",
                    capturedAt: Date.now(),
                    discoveredFrom: e.id,
                  });
                  j.sourceUrls.push(clean);
                } catch {}
              }
          }
          j.sourceCursor++;
        }
      });
      resume = false;
    }
  }
}
