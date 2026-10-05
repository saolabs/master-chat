import React, { useState } from "react";
import type { Command, Snapshot } from "../core/types.ts";
import {
  PEOPLE_PLATFORMS,
  PEOPLE_BUDGETS,
  peopleCriteria,
  type PeopleSearchInput,
  type PeopleSearchJob,
  type PeoplePlatform,
} from "../core/people-search.ts";
import {
  buildPeopleProfile,
  type PeopleProfileReport,
} from "../core/people-profiles.ts";

const defaults: PeopleSearchInput = {
  fullName: "",
  familyName: "",
  givenName: "",
  email: "",
  phone: "",
  phoneCountry: "VN",
  username: "",
  profileUrl: "",
  organization: "",
  context: "",
  other: [],
  language: "vi",
  platforms: Object.keys(PEOPLE_PLATFORMS) as PeoplePlatform[],
  directPlatforms: ["facebook"],
  engines: ["google"],
  depth: "standard",
  analyzeOnComplete: true,
};
const labels = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
};
const statusLabels: Record<PeopleSearchJob["status"], string> = {
  running: "Đang tìm",
  waiting: "Chờ bạn xử lý",
  paused: "Bị gián đoạn",
  completed: "Hoàn tất",
  cancelled: "Đã dừng",
  failed: "Chưa hoàn tất",
};
const confidence = {
  criteria_mentioned: "Đủ tiêu chí được nhắc",
  partial: "Khớp một phần",
  name_only: "Chỉ thấy tên",
  unconfirmed: "Chưa đối chiếu",
};
const depths = {
  quick: "Khảo sát nhanh",
  standard: "Tiêu chuẩn",
  deep: "Mở rộng",
  exhaustive: "Toàn diện",
};
const fieldLabels = {
  fullName: ["Tên người cần tìm", "Nguyễn Văn An"],
  familyName: ["Họ", "Nguyễn"],
  givenName: ["Tên", "An"],
  email: ["Email", "name@example.com"],
  phone: ["Số điện thoại", "090 123 4567 hoặc +84…"],
  username: ["Username", "Tên tài khoản"],
  profileUrl: ["URL hồ sơ", "https://…"],
  organization: ["Nơi công tác / tổ chức", "Công ty, trường học…"],
  context: ["Thông tin bổ sung", "Thông tin giúp phân biệt người trùng tên"],
} as const;
function ProfileReport({ report }: { report: PeopleProfileReport }) {
  return (
    <div className="people-report">
      <div className="people-report-summary">
        <span className="badge">{confidence[report.confidence]}</span>
        <span className="badge">
          {report.identityState === "reviewed_link"
            ? "Đã đối chiếu liên kết thủ công"
            : report.identityState === "account_only"
              ? "Nguồn cùng tài khoản"
              : "Chưa xác định liên kết danh tính"}
        </span>
      </div>
      {report.sections.map((section) => (
        <section className="people-report-section" key={section.category}>
          <h4>{section.title}</h4>
          {section.claims.map((claim, index) => (
            <div key={index}>
              <p>{claim.detail}</p>
              <small>
                {claim.subject && `${claim.subject} · `}
                {claim.attribution === "self_reported"
                  ? "Tài khoản tự khai"
                  : "Nguồn công bố"}
                {claim.timeText && ` · ${claim.timeText}`}
              </small>
              <blockquote>
                {claim.quote}
                <footer>
                  Nguồn{" "}
                  {report.sources.findIndex((s) => s.id === claim.evidenceId) +
                    1}{" "}
                  · ký tự {claim.start}–{claim.end}
                </footer>
              </blockquote>
            </div>
          ))}
        </section>
      ))}
      {report.timeline.length > 0 && (
        <details className="people-timeline">
          <summary>Dòng thời gian · {report.timeline.length} dữ kiện</summary>
          <ol>
            {report.timeline.map((row, i) => (
              <li key={i}>
                <strong>{row.timeText || "Chưa rõ thời gian"}</strong>
                <p>{row.detail}</p>
                <small>{row.url}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
      <details>
        <summary>
          Đối chiếu tiêu chí và bằng chứng ·{" "}
          {report.criteria.filter((c) => c.status === "mentioned").length}/
          {report.criteria.length}
        </summary>
        <dl>
          {report.criteria.map((m) => (
            <div key={m.field}>
              <dt>
                {m.label}: {m.value}
              </dt>
              <dd>
                {m.status === "mentioned"
                  ? "Được nhắc trong nguồn"
                  : "Chưa có bằng chứng trong nguồn đã đọc"}
                {m.quote && <blockquote>{m.quote}</blockquote>}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <details>
        <summary>Nguồn dẫn · {report.sources.length}</summary>
        <ol>
          {report.sources.map((s) => (
            <li key={s.id}>
              <strong>{s.title}</strong>
              <code className="people-url">{s.url}</code>
              <small>
                {s.accessStatus === "read"
                  ? "Đã đọc nội dung"
                  : "Chưa đọc được nội dung"}{" "}
                · {s.engine}
                {s.readAt && ` · ${new Date(s.readAt).toLocaleString("vi-VN")}`}
              </small>
              {s.declaredLinks?.links.length ? (
                <ul>
                  {s.declaredLinks.links.map((l) => (
                    <li key={l.url}>
                      {l.kind}: {l.url} · liên kết trang công bố
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>
          Thiếu thông tin / giới hạn · {report.limitations.length}
        </summary>
        <ul>
          {report.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
export function PeopleSearch({
  snapshot,
  busy,
  run,
}: {
  snapshot: Snapshot;
  busy: boolean;
  run: (cmd: Command) => Promise<Snapshot | null>;
}) {
  const [input, setInput] = useState<PeopleSearchInput>(defaults),
    [selected, setSelected] = useState(""),
    [formOpen, setFormOpen] = useState(true);
  const [tab, setTab] = useState<"profiles" | "sources" | "library">(
      "profiles",
    ),
    [filter, setFilter] = useState("all"),
    [limit, setLimit] = useState(12);
  const [focus, setFocus] = useState(
      "Học tập, công việc và hoạt động nghề nghiệp",
    ),
    [reviewRight, setReviewRight] = useState(""),
    [reviewReason, setReviewReason] = useState("");
  const [savedId, setSavedId] = useState(""),
    [version, setVersion] = useState(0);
  const jobs = snapshot.data.peopleSearches || [],
    job = jobs.find((j) => j.id === selected) || jobs[0],
    active = jobs.some(
      (j) => ["running", "waiting", "paused"].includes(j.status) || j.analyzing,
    );
  const hasModel = Boolean(
      snapshot.data.ai.tasks.knowledge || snapshot.data.ai.default,
    ),
    saved = snapshot.data.savedPeopleProfiles || [],
    savedProfile = saved.find((p) => p.id === savedId) || saved[0];
  const advancedCount = [
    input.familyName,
    input.givenName,
    input.profileUrl,
    input.organization,
    input.context,
    ...(input.other || []).map((r) => r.value),
  ].filter((v) => v?.trim()).length;
  const title = (j: PeopleSearchJob) =>
    j.input.fullName ||
    [j.input.familyName, j.input.givenName].filter(Boolean).join(" ") ||
    j.input.email ||
    j.input.phone ||
    j.input.username ||
    j.input.organization ||
    "Hồ sơ nghiên cứu";
  const field = (key: keyof typeof fieldLabels) => (
    <label key={key}>
      {fieldLabels[key][0]}
      <input
        name={key}
        type={key === "email" ? "email" : key === "profileUrl" ? "url" : "text"}
        maxLength={key === "profileUrl" ? 2000 : key === "email" ? 320 : 500}
        value={input[key] || ""}
        placeholder={fieldLabels[key][1]}
        onChange={(e) => setInput({ ...input, [key]: e.target.value })}
      />
    </label>
  );
  const newSearch = async (cmd: Command) => {
    const result = await run(cmd);
    if (result) {
      setSelected(result.data.peopleSearches?.[0]?.id || "");
      setFormOpen(false);
      setTab("profiles");
      setLimit(12);
    }
  };
  const budget = job
      ? PEOPLE_BUDGETS[job.input.depth]
      : PEOPLE_BUDGETS[input.depth],
    total =
      job?.tasks?.length ||
      (job?.queries.length || 0) * (job?.input.engines.length || 1);
  return (
    <section className="people-workspace" aria-label="Tìm người chuyên sâu">
      <div className="card people-intro">
        <div>
          <h2>Tìm người chuyên sâu</h2>
          <p>
            Tìm từ những gì bạn biết, đối chiếu người trùng tên và dựng hồ sơ có
            nguồn dẫn. Kết quả và thư viện hồ sơ được lưu trong vault trên máy.
          </p>
        </div>
        <button
          onClick={() => {
            setTab("library");
            setFormOpen(false);
          }}
        >
          Thư viện hồ sơ · {saved.length}
        </button>
      </div>
      {!formOpen && (
        <div className="card people-search-summary">
          <div>
            <h3>{job ? title(job) : "Tìm kiếm chuyên sâu"}</h3>
            <p>
              {job
                ? peopleCriteria(job.input)
                    .map((c) => `${c.label}: ${c.value}`)
                    .join(" · ")
                : "Biểu mẫu đã thu gọn để ưu tiên kết quả."}
            </p>
          </div>
          <div className="people-actions">
            <button
              onClick={() => {
                if (job) setInput({ ...defaults, ...job.input });
                setFormOpen(true);
              }}
            >
              Sửa tìm kiếm
            </button>
            <button
              className="primary"
              onClick={() => {
                setInput({ ...defaults, other: [] });
                setFormOpen(true);
              }}
            >
              Tìm kiếm mới
            </button>
          </div>
        </div>
      )}
      <div
        className={`people-layout ${formOpen ? "" : "people-form-collapsed"}`}
      >
        {formOpen && (
          <form
            className="card people-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await newSearch({
                type: "people.start",
                input: {
                  ...input,
                  other: (input.other || []).filter(
                    (r) => r.label.trim() && r.value.trim(),
                  ),
                  analyzeOnComplete: input.analyzeOnComplete && hasModel,
                },
              });
            }}
          >
            <div className="people-heading">
              <h3>Tạo hồ sơ nghiên cứu</h3>
              {job && (
                <button type="button" onClick={() => setFormOpen(false)}>
                  Thu gọn
                </button>
              )}
            </div>
            <div className="people-fields">
              {(["fullName", "email", "phone", "username"] as const).map(field)}
            </div>
            <label>
              Mã quốc gia điện thoại
              <input
                name="phoneCountry"
                maxLength={2}
                value={input.phoneCountry || "VN"}
                placeholder="VN, US, GB…"
                onChange={(e) =>
                  setInput({
                    ...input,
                    phoneCountry: e.target.value.toUpperCase(),
                  })
                }
              />
            </label>
            <p className="footnote">
              Số không có mã quốc tế được chuẩn hóa theo quốc gia đã chọn.
            </p>
            <details className="people-advanced">
              <summary>
                Thông tin nâng cao
                {advancedCount > 0 && (
                  <span> · {advancedCount} thông tin đã nhập</span>
                )}
              </summary>
              <div className="people-fields">
                {(
                  [
                    "familyName",
                    "givenName",
                    "organization",
                    "profileUrl",
                    "context",
                  ] as const
                ).map(field)}
              </div>
              <div className="people-actions">
                {["Tỉnh/thành đang sinh sống", "Trường học", ""].map(
                  (label) => (
                    <button
                      key={label}
                      type="button"
                      disabled={(input.other?.length || 0) >= 10}
                      onClick={() =>
                        setInput({
                          ...input,
                          other: [...(input.other || []), { label, value: "" }],
                        })
                      }
                    >
                      +{" "}
                      {label === "Tỉnh/thành đang sinh sống"
                        ? "Tỉnh/thành"
                        : label || "Khác"}
                    </button>
                  ),
                )}
              </div>
              {(input.other || []).map((r, i) => (
                <div className="people-extra-row" key={i}>
                  <input
                    aria-label={`Loại thông tin bổ sung ${i + 1}`}
                    placeholder="Loại thông tin"
                    maxLength={100}
                    value={r.label}
                    onChange={(e) =>
                      setInput({
                        ...input,
                        other: input.other!.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`Giá trị thông tin bổ sung ${i + 1}`}
                    placeholder="Giá trị"
                    maxLength={500}
                    value={r.value}
                    onChange={(e) =>
                      setInput({
                        ...input,
                        other: input.other!.map((x, j) =>
                          j === i ? { ...x, value: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setInput({
                        ...input,
                        other: input.other!.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Bỏ
                  </button>
                </div>
              ))}
            </details>
            <fieldset>
              <legend>Nguồn mạng xã hội</legend>
              <div className="people-platforms">
                {(Object.keys(PEOPLE_PLATFORMS) as PeoplePlatform[]).map(
                  (p) => (
                    <div key={p}>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={input.platforms.includes(p)}
                          onChange={(e) =>
                            setInput({
                              ...input,
                              platforms: e.target.checked
                                ? [...input.platforms, p]
                                : input.platforms.filter((x) => x !== p),
                              directPlatforms: e.target.checked
                                ? input.directPlatforms
                                : (input.directPlatforms || []).filter(
                                    (x) => x !== p,
                                  ),
                            })
                          }
                        />
                        {labels[p]}
                      </label>
                      <label className="toggle people-direct">
                        <input
                          type="checkbox"
                          disabled={!input.platforms.includes(p)}
                          checked={input.directPlatforms?.includes(p) || false}
                          onChange={(e) =>
                            setInput({
                              ...input,
                              directPlatforms: e.target.checked
                                ? [...(input.directPlatforms || []), p]
                                : (input.directPlatforms || []).filter(
                                    (x) => x !== p,
                                  ),
                            })
                          }
                        />
                        Tìm trực tiếp
                      </label>
                    </div>
                  ),
                )}
              </div>
            </fieldset>
            <label>
              Phiên Facebook khi tìm trực tiếp / đọc nguồn
              <select
                value={input.accountId || ""}
                onChange={(e) =>
                  setInput({ ...input, accountId: e.target.value || undefined })
                }
              >
                <option value="">Phiên nghiên cứu riêng</option>
                {snapshot.data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="footnote">
              Trình duyệt tìm People/tài khoản, đọc nội dung đang hiển thị. Khi
              trang yêu cầu CAPTCHA hoặc đăng nhập, hoàn tất trong trình duyệt
              rồi bấm Tiếp tục.
            </p>
            <details className="people-advanced">
              <summary>Tùy chọn tìm kiếm</summary>
              <fieldset>
                <legend>Công cụ tìm kiếm web</legend>
                <div className="people-options">
                  {(["google", "bing", "duckduckgo"] as const).map((engine) => (
                    <label className="toggle" key={engine}>
                      <input
                        type="checkbox"
                        checked={input.engines.includes(engine)}
                        onChange={(e) =>
                          setInput({
                            ...input,
                            engines: e.target.checked
                              ? [...input.engines, engine]
                              : input.engines.filter((x) => x !== engine),
                          })
                        }
                      />
                      {engine === "duckduckgo"
                        ? "DuckDuckGo"
                        : engine[0].toUpperCase() + engine.slice(1)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                Phạm vi tìm kiếm
                <select
                  value={input.depth}
                  onChange={(e) =>
                    setInput({
                      ...input,
                      depth: e.target.value as PeopleSearchInput["depth"],
                    })
                  }
                >
                  {(Object.keys(depths) as PeopleSearchInput["depth"][]).map(
                    (d) => (
                      <option key={d} value={d}>
                        {depths[d]} · {PEOPLE_BUDGETS[d].queries} truy vấn /
                        công cụ · {PEOPLE_BUDGETS[d].sources} nguồn
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Ngôn ngữ kết quả
                <input
                  name="language"
                  value={input.language || "vi"}
                  maxLength={20}
                  placeholder="vi, en, ja…"
                  onChange={(e) =>
                    setInput({ ...input, language: e.target.value })
                  }
                />
              </label>
            </details>
            <label className="toggle">
              <input
                type="checkbox"
                disabled={!hasModel}
                checked={(input.analyzeOnComplete && hasModel) || false}
                onChange={(e) =>
                  setInput({ ...input, analyzeOnComplete: e.target.checked })
                }
              />
              Tự dựng báo cáo với AI sau khi đọc nguồn
            </label>
            {!hasModel && (
              <p className="footnote">
                Chọn model Tri thức hoặc model chung trong Cấu hình AI để dựng
                báo cáo.
              </p>
            )}
            <button
              className="primary"
              disabled={
                busy ||
                active ||
                !input.engines.length ||
                ![
                  input.fullName,
                  input.familyName,
                  input.givenName,
                  input.email,
                  input.phone,
                  input.username,
                  input.profileUrl,
                  input.organization,
                  input.context,
                  ...(input.other || []).map((r) => r.value),
                ].some((v) => v?.trim())
              }
            >
              Bắt đầu tìm người
            </button>
          </form>
        )}
        <div className="people-results">
          <nav className="people-tabs" aria-label="Kết quả tìm người">
            {(
              [
                ["profiles", "Hồ sơ ứng viên"],
                ["sources", "Nguồn & tiến trình"],
                ["library", "Thư viện đã lưu"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "library" ? (
            <div className="card people-library">
              <h3>Thư viện hồ sơ · {saved.length}</h3>
              {savedProfile ? (
                <>
                  <label>
                    Hồ sơ đã lưu
                    <select
                      value={savedProfile.id}
                      onChange={(e) => {
                        setSavedId(e.target.value);
                        setVersion(0);
                      }}
                    >
                      {saved.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.versions[0].report.displayName} ·{" "}
                          {p.versions.length} phiên bản
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Phiên bản
                    <select
                      value={Math.min(
                        version,
                        savedProfile.versions.length - 1,
                      )}
                      onChange={(e) => setVersion(Number(e.target.value))}
                    >
                      {savedProfile.versions.map((v, i) => (
                        <option key={i} value={i}>
                          {new Date(v.createdAt).toLocaleString("vi-VN")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <h3>
                    {
                      savedProfile.versions[
                        Math.min(version, savedProfile.versions.length - 1)
                      ].report.displayName
                    }
                  </h3>
                  <ProfileReport
                    report={
                      savedProfile.versions[
                        Math.min(version, savedProfile.versions.length - 1)
                      ].report
                    }
                  />
                  <label>
                    Hướng nghiên cứu tiếp
                    <input
                      value={focus}
                      maxLength={300}
                      onChange={(e) => setFocus(e.target.value)}
                    />
                  </label>
                  <div className="people-actions">
                    <button
                      disabled={busy || active || !focus.trim()}
                      onClick={() =>
                        void newSearch({
                          type: "people.deepenSaved",
                          profileId: savedProfile.id,
                          focus,
                        })
                      }
                    >
                      Nghiên cứu sâu hơn
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run({
                          type: "people.deleteProfile",
                          profileId: savedProfile.id,
                        })
                      }
                    >
                      Xóa khỏi thư viện
                    </button>
                  </div>
                </>
              ) : (
                <p>
                  Lưu hồ sơ ứng viên để giữ các phiên bản độc lập với lịch sử
                  lượt tìm kiếm.
                </p>
              )}
            </div>
          ) : (
            <>
              {jobs.length > 0 && (
                <label>
                  Lượt tìm kiếm
                  <select
                    aria-label="Lượt tìm kiếm"
                    value={job?.id || ""}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      setLimit(12);
                    }}
                  >
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {title(j)} · {statusLabels[j.status]} ·{" "}
                        {new Date(j.createdAt).toLocaleString("vi-VN")}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {job ? (
                <>
                  <div className="card people-progress" aria-live="polite">
                    <div className="people-heading">
                      <h3>
                        {job.analyzing
                          ? "Đang dựng báo cáo"
                          : statusLabels[job.status]}
                      </h3>
                      <span className="badge">
                        {job.candidates.length} ứng viên ·{" "}
                        {job.evidence.filter((e) => e.readAt).length} nguồn đã
                        đọc
                      </span>
                    </div>
                    <p>{job.message}</p>
                    <progress
                      aria-label="Tiến độ tìm kiếm"
                      max={
                        total + Math.max(budget.sources, job.sourceUrls.length)
                      }
                      value={
                        job.status === "completed"
                          ? total +
                            Math.max(budget.sources, job.sourceUrls.length)
                          : job.cursor + job.sourceCursor
                      }
                    />
                    <small>
                      {job.cursor}/{total} lượt tìm · {job.sourceCursor}/
                      {job.sourceUrls.length} nguồn đã xử lý
                    </small>
                    <div className="people-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run({ type: "people.browser", jobId: job.id })
                        }
                      >
                        Mở trình duyệt tìm kiếm
                      </button>
                      {["waiting", "paused"].includes(job.status) && (
                        <>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              void run({ type: "people.resume", jobId: job.id })
                            }
                          >
                            Tiếp tục
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run({ type: "people.skip", jobId: job.id })
                            }
                          >
                            Bỏ qua trang này
                          </button>
                        </>
                      )}
                      {["running", "waiting", "paused"].includes(
                        job.status,
                      ) && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run({ type: "people.cancel", jobId: job.id })
                          }
                        >
                          Dừng tìm kiếm
                        </button>
                      )}
                      {!active && (
                        <>
                          <button
                            disabled={busy || !hasModel}
                            onClick={() =>
                              void run({
                                type: "people.analyzeAll",
                                jobId: job.id,
                              })
                            }
                          >
                            Dựng báo cáo các hồ sơ
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run({ type: "people.export", jobId: job.id })
                            }
                          >
                            Xuất JSON
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run({
                                type: "people.exportCSV",
                                jobId: job.id,
                              })
                            }
                          >
                            Xuất CSV
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run({ type: "people.remove", jobId: job.id })
                            }
                          >
                            Xóa lượt tìm
                          </button>
                        </>
                      )}
                    </div>
                    {job.coverage && (
                      <p className="footnote">
                        Phạm vi đã lập:{" "}
                        {job.coverage.scheduledPlatforms
                          .map((p) => labels[p])
                          .join(", ") || "Web"}
                        . {job.coverage.deferredCriteria.length} tiêu chí /{" "}
                        {job.coverage.deferredPlatforms.length} nền tảng chưa có
                        truy vấn riêng trong ngân sách.
                      </p>
                    )}
                    <details>
                      <summary>
                        {job.queries.length} truy vấn đã lập ·{" "}
                        {job.tasks?.filter((t) => t.engine === "direct")
                          .length || 0}{" "}
                        lượt tìm trực tiếp
                      </summary>
                      <ol>
                        {job.queries.map((q, i) => (
                          <li key={i}>
                            <code>{q}</code>
                          </li>
                        ))}
                      </ol>
                      {job.tasks
                        ?.filter((t) => t.engine === "direct")
                        .map((t, i) => (
                          <p key={i}>
                            {t.platform && labels[t.platform]} People/tài khoản:{" "}
                            {t.query}
                          </p>
                        ))}
                    </details>
                    {job.errors.length > 0 && (
                      <details>
                        <summary>
                          {job.errors.length} lượt/nguồn chưa đọc được
                        </summary>
                        <ul>
                          {job.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {job.analysisErrors?.length ? (
                      <details>
                        <summary>
                          {job.analysisErrors.length} hồ sơ chưa phân tích được
                        </summary>
                        <ul>
                          {job.analysisErrors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                  <p className="people-evidence-note">
                    Hồ sơ ứng viên chưa xác minh danh tính ngoài đời. Nguồn cùng
                    tài khoản được tập hợp; những người trùng tên được giữ
                    riêng. Liên kết khác tài khoản cần bạn đối chiếu.
                  </p>
                  {tab === "sources" ? (
                    <div className="card">
                      <h3>Nguồn đã thu thập</h3>
                      {job.evidence.slice(0, limit).map((e) => (
                        <details className="people-source" key={e.id}>
                          <summary>
                            {e.title} ·{" "}
                            {e.readAt ? "Đã đọc" : e.error || "Đầu mối"}
                          </summary>
                          <code className="people-url">{e.url}</code>
                          <p>{e.snippet}</p>
                          <small>
                            {e.engine} · {e.query}
                            {e.discoveredFrom && " · Theo liên kết từ nguồn"}
                          </small>
                          {e.text && <pre>{e.text}</pre>}
                          <button
                            disabled={busy || active}
                            onClick={() =>
                              void run({
                                type: "people.browser",
                                jobId: job.id,
                                url: e.url,
                              })
                            }
                          >
                            Mở nguồn gốc
                          </button>
                        </details>
                      ))}
                      {job.evidence.length > limit && (
                        <button onClick={() => setLimit(limit + 20)}>
                          Xem thêm nguồn
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <label>
                        Lọc ứng viên
                        <select
                          value={filter}
                          onChange={(e) => {
                            setFilter(e.target.value);
                            setLimit(12);
                          }}
                        >
                          <option value="all">Tất cả ứng viên</option>
                          {Object.entries(confidence).map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {job.candidates
                        .filter(
                          (c) => filter === "all" || c.confidence === filter,
                        )
                        .slice(0, limit)
                        .map((candidate) => {
                          const report = buildPeopleProfile(job, candidate),
                            hasRead = candidate.evidenceIds.some((id) =>
                              job.evidence.some(
                                (e) => e.id === id && e.readAt && e.text,
                              ),
                            );
                          return (
                            <article
                              className="card people-candidate"
                              key={candidate.id}
                            >
                              <h3>{report.displayName}</h3>
                              <code className="people-url">
                                {candidate.url}
                              </code>
                              <p>
                                <span className="badge">
                                  {confidence[candidate.confidence]}
                                </span>{" "}
                                · {report.sources.length} nguồn ·{" "}
                                {report.sections.reduce(
                                  (n, s) => n + s.claims.length,
                                  0,
                                )}{" "}
                                dữ kiện
                              </p>
                              <details>
                                <summary>Mở hồ sơ tổng hợp</summary>
                                <ProfileReport report={report} />
                              </details>
                              <div className="people-actions">
                                {hasRead && (
                                  <button
                                    disabled={busy || active || !hasModel}
                                    onClick={() =>
                                      void run({
                                        type: "people.analyze",
                                        jobId: job.id,
                                        candidateId: candidate.id,
                                      })
                                    }
                                  >
                                    {report.sections.length
                                      ? "Đọc lại hồ sơ với AI"
                                      : "Đọc hồ sơ với AI"}
                                  </button>
                                )}
                                <button
                                  disabled={busy || active}
                                  onClick={() =>
                                    void run({
                                      type: "people.saveProfile",
                                      jobId: job.id,
                                      candidateId: candidate.id,
                                    })
                                  }
                                >
                                  Lưu hồ sơ
                                </button>
                                <button
                                  disabled={busy || active}
                                  onClick={() =>
                                    void run({
                                      type: "people.browser",
                                      jobId: job.id,
                                      url: job.evidence.find(
                                        (e) =>
                                          e.id === candidate.evidenceIds[0],
                                      )!.url,
                                    })
                                  }
                                >
                                  Mở nguồn gốc
                                </button>
                              </div>
                              <details>
                                <summary>Nghiên cứu sâu hơn</summary>
                                <label>
                                  Thông tin cần bổ sung
                                  <input
                                    value={focus}
                                    maxLength={300}
                                    onChange={(e) => setFocus(e.target.value)}
                                  />
                                </label>
                                <div className="people-actions">
                                  {[
                                    "Học tập",
                                    "Công việc",
                                    "Sự kiện và thành tựu",
                                    "Nội dung chuyên môn chia sẻ",
                                  ].map((f) => (
                                    <button key={f} onClick={() => setFocus(f)}>
                                      {f}
                                    </button>
                                  ))}
                                </div>
                                <button
                                  disabled={busy || active || !focus.trim()}
                                  onClick={() =>
                                    void newSearch({
                                      type: "people.deepen",
                                      jobId: job.id,
                                      candidateId: candidate.id,
                                      focus,
                                    })
                                  }
                                >
                                  Tìm tiếp cho hồ sơ này
                                </button>
                              </details>
                              <details>
                                <summary>
                                  Đối chiếu hai nguồn / tài khoản
                                </summary>
                                <label>
                                  Nguồn thứ hai
                                  <select
                                    value={reviewRight}
                                    onChange={(e) =>
                                      setReviewRight(e.target.value)
                                    }
                                  >
                                    <option value="">
                                      Chọn nguồn để đối chiếu
                                    </option>
                                    {job.evidence
                                      .filter(
                                        (e, i, rows) =>
                                          e.id !== candidate.evidenceIds[0] &&
                                          rows.findIndex(
                                            (x) => x.url === e.url,
                                          ) === i,
                                      )
                                      .map((e) => (
                                        <option key={e.id} value={e.id}>
                                          {e.title} · {e.url}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                <label>
                                  Lý do đối chiếu
                                  <input
                                    value={reviewReason}
                                    maxLength={1000}
                                    onChange={(e) =>
                                      setReviewReason(e.target.value)
                                    }
                                    placeholder="Liên kết hồ sơ và bằng chứng nhận dạng…"
                                  />
                                </label>
                                <div className="people-actions">
                                  {(
                                    [
                                      ["same", "Cùng người"],
                                      ["different", "Khác người"],
                                      ["uncertain", "Chưa rõ"],
                                    ] as const
                                  ).map(([decision, label]) => (
                                    <button
                                      key={decision}
                                      disabled={
                                        busy ||
                                        active ||
                                        !reviewRight ||
                                        reviewReason.trim().length < 5
                                      }
                                      onClick={() =>
                                        void run({
                                          type: "people.review",
                                          jobId: job.id,
                                          left: candidate.evidenceIds[0],
                                          right: reviewRight,
                                          decision,
                                          reason: reviewReason,
                                        })
                                      }
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </details>
                            </article>
                          );
                        })}
                      {job.candidates.filter(
                        (c) => filter === "all" || c.confidence === filter,
                      ).length > limit && (
                        <button onClick={() => setLimit(limit + 12)}>
                          Xem thêm ứng viên
                        </button>
                      )}
                      {!job.candidates.length && (
                        <div className="card empty">
                          Chưa có nguồn phù hợp được thu thập.
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="card empty">
                  <h3>Tìm từ một hoặc nhiều đầu mối</h3>
                  <p>
                    Nhập tên, liên hệ, tổ chức hoặc thông tin khác. Tìm trực
                    tiếp trên mạng xã hội và web, đọc nguồn, sau đó dựng hồ sơ
                    có dẫn chứng.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
