import React, { useState } from "react";
import {
  BookOpen,
  FileText,
  Plus,
  Upload,
  Pencil,
  Trash2,
  Save,
  X,
  ArrowLeft,
  Search,
} from "lucide-react";
import type {
  Bridge,
  Command,
  DocumentImport,
  Knowledge,
  Snapshot,
} from "../core/types.ts";
import {
  MAX_DOCUMENT_FILES,
  MAX_DOCUMENT_TEXT,
} from "../core/document-limits.ts";

type Runner = (command: Command) => Promise<Snapshot | null>;
type Accounts = Snapshot["data"]["accounts"];
type ImportedSource = { fileName: string; title: string; text: string };

function ScopeField({
  accounts,
  value,
  onChange,
}: {
  accounts: Accounts;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label>
      Phạm vi
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Dùng chung các tài khoản</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SourceEditor({
  source,
  accounts,
  busy,
  run,
  close,
}: {
  source?: Knowledge;
  accounts: Accounts;
  busy: boolean;
  run: Runner;
  close: () => void;
}) {
  const [title, setTitle] = useState(source?.title ?? "");
  const [text, setText] = useState(source?.text ?? "");
  const [accountId, setAccountId] = useState(source?.accountId ?? "");
  return (
    <form
      className="knowledge-editor"
      aria-label={source ? "Sửa tri thức" : "Thêm tri thức"}
      onSubmit={async (e) => {
        e.preventDefault();
        const fields = { title, text, accountId: accountId || null };
        const result = await run(
          source
            ? { type: "knowledge.update", knowledgeId: source.id, ...fields }
            : { type: "knowledge.add", ...fields },
        );
        if (result) close();
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Tên nguồn
          <input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <ScopeField
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
        />
        <label>
          Nội dung
          <textarea
            required
            rows={12}
            maxLength={MAX_DOCUMENT_TEXT}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <small>{text.length.toLocaleString("vi-VN")} / 100.000 ký tự</small>
        <div className="inline form-actions">
          <button className="primary" disabled={!title.trim() || !text.trim()}>
            <Save size={16} />
            {source ? "Lưu thay đổi" : "Lưu tri thức"}
          </button>
          <button type="button" onClick={close}>
            Hủy
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function KnowledgeSettings({
  sources,
  accounts,
  busy,
  run,
  importDocuments,
}: {
  sources: Knowledge[];
  accounts: Accounts;
  busy: boolean;
  run: Runner;
  importDocuments: Bridge["importDocuments"];
}) {
  const [view, setView] = useState<"list" | "new" | "import">("list");
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [accountId, setAccountId] = useState("");
  const [documents, setDocuments] = useState<ImportedSource[]>([]);
  const [failures, setFailures] = useState<DocumentImport[]>([]);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const locked = busy || reading;
  const filtered = sources.filter(
    (s) =>
      (scope === "all" || (s.accountId ?? "") === scope) &&
      `${s.title}\n${s.text}\n${s.fileName ?? ""}`
        .toLocaleLowerCase("vi-VN")
        .includes(query.trim().toLocaleLowerCase("vi-VN")),
  );

  async function read(files?: File[]) {
    if (locked) return;
    setReading(true);
    setError("");
    try {
      if (files && files.length > MAX_DOCUMENT_FILES)
        throw new Error("Mỗi lần chỉ nhập tối đa 30 file.");
      if (
        files &&
        files.reduce((sum, f) => sum + f.size, 0) > 100 * 1024 * 1024
      )
        throw new Error("Tổng dung lượng vượt quá 100 MB.");
      const oversized = files?.filter((f) => f.size > 20 * 1024 * 1024) ?? [];
      const uploads = files
        ? await Promise.all(
            files
              .filter((f) => !oversized.includes(f))
              .map(async (f) => ({
                name: f.name,
                data: new Uint8Array(await f.arrayBuffer()),
              })),
          )
        : undefined;
      const results: DocumentImport[] = [
        ...(await importDocuments(uploads)),
        ...oversized.map((f) => ({
          fileName: f.name,
          error: "File vượt quá giới hạn 20 MB.",
        })),
      ];
      if (!results.length) return;
      const successful = results.filter(
        (r): r is ImportedSource => typeof r.text === "string",
      );
      if (
        (view === "import" ? documents.length : 0) + successful.length >
        MAX_DOCUMENT_FILES
      )
        throw new Error("Mỗi đợt chỉ lưu tối đa 30 tài liệu.");
      setDocuments((old) =>
        view === "import" ? [...old, ...successful] : successful,
      );
      setFailures((old) =>
        view === "import"
          ? [...old, ...results.filter((r) => r.error)]
          : results.filter((r) => r.error),
      );
      setView("import");
      setEditing(null);
      setRemoving(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  }
  function close() {
    setView("list");
    setEditing(null);
    setDocuments([]);
    setFailures([]);
    setError("");
  }

  return (
    <section
      className={`knowledge-settings${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (
          view !== "new" &&
          !editing &&
          e.dataTransfer.types.includes("Files")
        ) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (view !== "new" && !editing)
          void read(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="section-heading knowledge-heading">
        <div>
          <h2>Kho tri thức</h2>
          <small>{sources.length} nguồn · Lưu trên máy</small>
        </div>
        {view === "list" ? (
          <div className="inline knowledge-actions">
            <button disabled={locked || !!editing} onClick={() => void read()}>
              <Upload size={16} />
              {reading ? "Đang đọc tài liệu…" : "Nhập tài liệu"}
            </button>
            <button
              className="primary"
              disabled={locked || !!editing}
              onClick={() => {
                setView("new");
                setError("");
              }}
            >
              <Plus size={16} />
              Thêm nội dung
            </button>
          </div>
        ) : (
          <button disabled={locked} onClick={close}>
            <ArrowLeft size={16} />
            Quay lại kho
          </button>
        )}
      </div>
      {error && (
        <p className="knowledge-error" role="alert">
          {error}
        </p>
      )}
      {view === "new" ? (
        <>
          <h3 className="knowledge-subheading">Thêm tri thức riêng</h3>
          <SourceEditor
            accounts={accounts}
            busy={locked}
            run={run}
            close={close}
          />
        </>
      ) : view === "import" ? (
        <form
          className="knowledge-import"
          aria-label="Nhập tài liệu"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!documents.length || locked) return;
            const result = await run({
              type: "knowledge.import",
              sources: documents,
              accountId: accountId || null,
            });
            if (result) close();
          }}
        >
          <div className="section-heading">
            <h3>{documents.length} tài liệu sẵn sàng nhập</h3>
            <button type="button" disabled={locked} onClick={() => void read()}>
              <Upload size={16} />
              {reading ? "Đang đọc…" : "Chọn thêm file"}
            </button>
          </div>
          <fieldset disabled={locked}>
            <ScopeField
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
            />
            {failures.map((f, i) => (
              <div
                className="document-failure"
                role="alert"
                key={`${f.fileName}-${i}`}
              >
                <span>
                  <b>{f.fileName}</b>
                  <br />
                  {f.error}
                </span>
                <button
                  type="button"
                  title="Bỏ thông báo"
                  aria-label={`Bỏ lỗi ${f.fileName}`}
                  onClick={() =>
                    setFailures((old) => old.filter((_, n) => n !== i))
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            {documents.map((doc, i) => (
              <details
                className="document-preview"
                key={`${doc.fileName}-${i}`}
                open={i === 0 ? true : undefined}
              >
                <summary>
                  <FileText size={16} />
                  <span>{doc.fileName}</span>
                  <small>{doc.text.length.toLocaleString("vi-VN")} ký tự</small>
                </summary>
                <label>
                  Tên nguồn
                  <input
                    required
                    maxLength={200}
                    value={doc.title}
                    onChange={(e) =>
                      setDocuments((old) =>
                        old.map((d, n) =>
                          n === i ? { ...d, title: e.target.value } : d,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Nội dung trích xuất
                  <textarea
                    required
                    rows={8}
                    maxLength={MAX_DOCUMENT_TEXT}
                    value={doc.text}
                    onChange={(e) =>
                      setDocuments((old) =>
                        old.map((d, n) =>
                          n === i ? { ...d, text: e.target.value } : d,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDocuments((old) => old.filter((_, n) => n !== i))
                  }
                >
                  <Trash2 size={16} />
                  Bỏ tài liệu
                </button>
              </details>
            ))}
            <div className="inline form-actions">
              <button
                className="primary"
                disabled={
                  !documents.length ||
                  documents.some((d) => !d.title.trim() || !d.text.trim())
                }
              >
                <Save size={16} />
                Lưu {documents.length} nguồn tri thức
              </button>
              <button type="button" onClick={close}>
                Hủy
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          {sources.length > 0 && (
            <div className="knowledge-filters">
              <div className="knowledge-search">
                <Search size={16} />
                <input
                  type="search"
                  aria-label="Tìm nguồn tri thức"
                  placeholder="Tìm nguồn tri thức"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                aria-label="Lọc phạm vi"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="all">Tất cả phạm vi</option>
                <option value="">Dùng chung</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!sources.length ? (
            <div className="knowledge-empty">
              <BookOpen size={32} />
              <h3>Chưa có nguồn tri thức</h3>
              <p>PDF, DOC, DOCX, HTML, TXT, MD</p>
              <small>Tối đa 30 file mỗi đợt · 20 MB mỗi file</small>
            </div>
          ) : !filtered.length ? (
            <div className="empty compact">Không có nguồn phù hợp.</div>
          ) : (
            <div className="knowledge-list">
              {filtered.map((source) => (
                <article
                  className={`knowledge-source${editing === source.id ? " editing" : ""}`}
                  key={source.id}
                  aria-label={`Nguồn ${source.title}`}
                >
                  <div className="section-heading">
                    <div className="knowledge-source-title">
                      <FileText size={18} />
                      <div>
                        <h3>{source.title}</h3>
                        <small>
                          {accounts.find((a) => a.id === source.accountId)
                            ?.name ?? "Dùng chung"}
                          {source.fileName ? ` · ${source.fileName}` : ""} ·{" "}
                          {source.text.length.toLocaleString("vi-VN")} ký tự
                        </small>
                      </div>
                    </div>
                    <div className="inline">
                      <button
                        title="Chỉnh sửa"
                        aria-label={`Chỉnh sửa ${source.title}`}
                        disabled={
                          locked || (!!editing && editing !== source.id)
                        }
                        onClick={() => {
                          setEditing(source.id);
                          setRemoving(null);
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        title="Xóa nguồn"
                        aria-label={`Xóa ${source.title}`}
                        disabled={locked || !!editing}
                        onClick={() => setRemoving(source.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {editing === source.id ? (
                    <SourceEditor
                      key={source.id}
                      source={source}
                      accounts={accounts}
                      busy={locked}
                      run={run}
                      close={() => setEditing(null)}
                    />
                  ) : (
                    <p className="knowledge-excerpt">
                      {source.text.slice(0, 300)}
                      {source.text.length > 300 ? "…" : ""}
                    </p>
                  )}
                  {removing === source.id && (
                    <div className="knowledge-remove">
                      <span>Xóa nguồn “{source.title}”?</span>
                      <button
                        disabled={locked}
                        onClick={async () => {
                          if (
                            await run({
                              type: "knowledge.remove",
                              knowledgeId: source.id,
                            })
                          )
                            setRemoving(null);
                        }}
                      >
                        Xác nhận xóa
                      </button>
                      <button
                        disabled={locked}
                        onClick={() => setRemoving(null)}
                      >
                        Hủy
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
