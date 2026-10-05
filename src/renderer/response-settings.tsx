import React, { useEffect, useRef, useState } from "react";
import type {
  Command,
  ModelSelection,
  PublicAIConfig,
  ResponseSettings as Settings,
  Snapshot,
} from "../core/types.ts";
import {
  TYPING_SAMPLE,
  replyDelay,
  typingMeasurement,
} from "../core/response-style.ts";
import {
  reviewSelection,
  isDifferentReviewModel,
} from "../core/reply-quality.ts";
type Runner = (command: Command) => Promise<Snapshot | null>;
export function ResponseSettings({
  settings,
  config,
  busy,
  run,
}: {
  settings?: Settings;
  config: PublicAIConfig;
  busy: boolean;
  run: Runner;
}) {
  const [value, setValue] = useState<Settings>(settings ?? {});
  const [typed, setTyped] = useState(""),
    [elapsed, setElapsed] = useState(0),
    [running, setRunning] = useState(false),
    [result, setResult] = useState<ReturnType<typeof typingMeasurement>>(null);
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setElapsed(performance.now() - started.current!),
      250,
    );
    return () => clearInterval(timer);
  }, [running]);
  const typing = value.typing ?? {},
    media = value.media ?? {};
  const transcription = media.transcription ?? {};
  const audioMode =
    transcription.mode ?? (media.audioModel ? "provider" : "local");
  const reviewer = reviewSelection(config, value.review);
  const writer = config.tasks.reply ?? config.default;
  function modelInput(kind: "imageModel" | "audioModel", label: string) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={
            media[kind]
              ? JSON.stringify([media[kind]!.providerId, media[kind]!.modelId])
              : ""
          }
          onChange={(e) => {
            const pair = e.target.value
              ? (JSON.parse(e.target.value) as string[])
              : null;
            const selection: ModelSelection | null = pair
              ? { providerId: pair[0], modelId: pair[1] }
              : null;
            setValue({ ...value, media: { ...media, [kind]: selection } });
          }}
        >
          <option value="">
            {kind === "audioModel"
              ? "Chọn model Whisper/phiên âm"
              : "Dùng model trả lời hiện tại"}
          </option>
          {config.providers
            .filter((p) => p.enabled)
            .flatMap((p) =>
              p.models
                .filter(
                  (modelId) =>
                    kind !== "audioModel" ||
                    (!["google", "anthropic"].includes(p.type) &&
                      /whisper|transcrib/i.test(modelId)),
                )
                .map((modelId) => (
                  <option
                    key={p.id + modelId}
                    value={JSON.stringify([p.id, modelId])}
                  >
                    {p.name} · {modelId}
                  </option>
                )),
            )}
        </select>
      </label>
    );
  }
  return (
    <form
      className="response-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ type: "response.save", settings: value });
      }}
    >
      <p>Mọi thiết lập đều tùy chọn. Để trống để dùng mặc định.</p>
      <div className="settings-grid">
        <section className="card">
          <h3>Phong cách trả lời chung</h3>
          <label>
            Mô tả về bản thân
            <textarea
              rows={3}
              maxLength={4000}
              value={value.aboutMe ?? ""}
              onChange={(e) => setValue({ ...value, aboutMe: e.target.value })}
              placeholder="Công việc, sở thích hoặc thông tin bạn muốn AI biết…"
            />
          </label>
          <label>
            Tính cách và giọng điệu
            <textarea
              rows={3}
              maxLength={4000}
              value={value.personality ?? ""}
              onChange={(e) =>
                setValue({ ...value, personality: e.target.value })
              }
              placeholder="Ví dụ: ngắn gọn, thân thiện, ít emoji, xưng mình/bạn…"
            />
          </label>
          <label>
            Instructions chung
            <textarea
              rows={3}
              maxLength={8000}
              value={value.instructions ?? ""}
              onChange={(e) =>
                setValue({ ...value, instructions: e.target.value })
              }
              placeholder="Các chỉ dẫn chung khi viết phản hồi…"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.learnStyle !== false}
              onChange={(e) =>
                setValue({ ...value, learnStyle: e.target.checked })
              }
            />
            Tự dựng hồ sơ quan hệ và phong cách từng người
          </label>
          <small>
            Dùng ít nhất 50 tin có nội dung của hai phía. Phong cách học từ tin
            bạn tự gửi, loại tin AI. Hồ sơ được lưu và cập nhật khi có thêm 10
            tin; chưa đủ dữ liệu thì dùng phong cách chung và ngữ cảnh bạn nhập.
          </small>
          <label className="check">
            <input
              type="checkbox"
              checked={value.providerCache !== false}
              onChange={(e) =>
                setValue({ ...value, providerCache: e.target.checked })
              }
            />
            Tái sử dụng instructions qua cache của provider
          </label>
          <small>
            Ngữ cảnh được tóm tắt và kết quả đọc tệp được lưu để dùng lại. Cache
            phụ thuộc model, độ dài và thời hạn của provider; khi chưa có cache,
            API vẫn nhận instructions.
          </small>
        </section>
        <section className="card">
          <h3>Kiểm tra độ tự nhiên bằng model khác</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={value.review?.enabled !== false}
              onChange={(e) =>
                setValue({
                  ...value,
                  review: { ...value.review, enabled: e.target.checked },
                })
              }
            />
            Kiểm tra trước khi dùng bản nháp AI
          </label>
          <label>
            Model kiểm tra câu trả lời
            <select
              aria-label="Model kiểm tra câu trả lời"
              value={
                value.review?.model
                  ? JSON.stringify([
                      value.review.model.providerId,
                      value.review.model.modelId,
                    ])
                  : ""
              }
              onChange={(e) => {
                const pair = e.target.value
                  ? (JSON.parse(e.target.value) as string[])
                  : null;
                setValue({
                  ...value,
                  review: {
                    ...value.review,
                    model: pair
                      ? { providerId: pair[0], modelId: pair[1] }
                      : null,
                  },
                });
              }}
            >
              <option value="">
                Tự chọn model khác trong cùng provider trả lời
              </option>
              {config.providers
                .filter((p) => p.enabled)
                .flatMap((p) =>
                  p.models
                    .filter(
                      (modelId) =>
                        !/whisper|transcrib|embed|tts|speech/i.test(modelId) &&
                        (!writer ||
                          isDifferentReviewModel(writer, {
                            providerId: p.id,
                            modelId,
                          })),
                    )
                    .map((modelId) => (
                      <option
                        key={p.id + modelId}
                        value={JSON.stringify([p.id, modelId])}
                      >
                        {p.name} · {modelId}
                      </option>
                    )),
                )}
            </select>
          </label>
          <p>
            {value.review?.enabled === false
              ? "Đã tắt bước kiểm tra."
              : reviewer
                ? `Đang chọn: ${config.providers.find((p) => p.id === reviewer.providerId)?.name ?? reviewer.providerId} · ${reviewer.modelId}`
                : "Chưa có model khác. Bản nháp sẽ ghi rõ chưa được kiểm tra; chọn thêm model khi cần."}
          </p>
          <small>
            Kiểm tra xưng hô, độ dài, câu văn sáo và việc kéo chủ đề cũ vào tin
            mới. Tự sửa phản hồi khi có lưu ý. Trong chế độ tự động, kết quả
            kiểm tra được lưu nhưng không yêu cầu duyệt thủ công.
          </small>
        </section>
        <section className="card">
          <h3>Ảnh và tin nhắn âm thanh</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={media.enabled !== false}
              onChange={(e) =>
                setValue({
                  ...value,
                  media: { ...media, enabled: e.target.checked },
                })
              }
            />
            Đọc nội dung tệp trước khi phản hồi
          </label>
          {modelInput("imageModel", "Model đọc ảnh (tùy chọn)")}
          <h3>Phiên âm trước khi trả lời</h3>
          <label>
            Cách chuyển âm thanh thành văn bản
            <select
              value={audioMode}
              onChange={(e) =>
                setValue({
                  ...value,
                  media: {
                    ...media,
                    audioModel: null,
                    transcription: {
                      ...transcription,
                      mode: e.target.value as "local" | "provider",
                    },
                  },
                })
              }
            >
              <option value="local">Trên máy (Whisper) · mặc định</option>
              <option value="provider">Dịch vụ phiên âm riêng</option>
            </select>
          </label>
          {audioMode === "local" ? (
            <>
              <p>
                Chuyển audio sang WAV trên máy, dùng Whisper chép lời nói rồi
                chỉ đưa văn bản cho model trả lời. Tự tìm công cụ đã cài hoặc
                dịch vụ Whisper local đã cấu hình.
              </p>
              <details>
                <summary>Đường dẫn Whisper trên máy (tùy chọn)</summary>
                <label>
                  Chương trình whisper-cli
                  <input
                    value={transcription.executable ?? ""}
                    placeholder="Tự tìm trên máy"
                    onChange={(e) =>
                      setValue({
                        ...value,
                        media: {
                          ...media,
                          transcription: {
                            ...transcription,
                            mode: "local",
                            executable: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Tệp model Whisper đa ngôn ngữ
                  <input
                    value={transcription.modelPath ?? ""}
                    placeholder="Ví dụ: /đường/dẫn/ggml-large-v3-turbo-q5_0.bin"
                    onChange={(e) =>
                      setValue({
                        ...value,
                        media: {
                          ...media,
                          transcription: {
                            ...transcription,
                            mode: "local",
                            modelPath: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Chương trình FFmpeg
                  <input
                    value={transcription.ffmpegPath ?? ""}
                    placeholder="Tự tìm trên máy"
                    onChange={(e) =>
                      setValue({
                        ...value,
                        media: {
                          ...media,
                          transcription: {
                            ...transcription,
                            mode: "local",
                            ffmpegPath: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </label>
              </details>
              <small>
                Dùng Whisper/model đi kèm nếu có; có thể cài hoặc chọn bản riêng
                trên máy. Nếu chưa có, tin thoại sẽ chờ; ứng dụng không tự
                chuyển sang gửi audio cho model chat.
              </small>
            </>
          ) : (
            <>
              {modelInput("audioModel", "Model phiên âm (tùy chọn)")}
              <small>
                Tệp chỉ gửi tới dịch vụ phiên âm bạn chọn; model trả lời nhận
                bản chép văn bản. Dịch vụ cloud cần quyền riêng của provider. Có
                thể dùng server Whisper local để giữ audio trên máy.
              </small>
            </>
          )}
          <label>
            Ngôn ngữ phiên âm
            <input
              maxLength={4}
              value={transcription.language ?? ""}
              placeholder="vi · tiếng Việt (hoặc auto, en)"
              onChange={(e) =>
                setValue({
                  ...value,
                  media: {
                    ...media,
                    transcription: {
                      ...transcription,
                      language:
                        e.target.value.trim().toLowerCase() || undefined,
                    },
                  },
                })
              }
            />
          </label>
          <p>
            Model đọc ảnh cần hỗ trợ hình ảnh. Bản chép âm thanh và kết quả đọc
            ảnh được lưu theo từng tin nhắn để dùng lại.
          </p>
          <small>
            Nếu tệp chưa tải được hoặc model không đọc được, hội thoại sẽ chờ
            bạn kiểm tra thay vì đoán nội dung. Tệp tối đa 20 MB.
          </small>
        </section>
        <section className="card">
          <h3>Nhịp trả lời tự động</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={typing.enabled ?? false}
              onChange={(e) =>
                setValue({
                  ...value,
                  typing: { ...typing, enabled: e.target.checked },
                })
              }
            />
            Chờ theo độ dài tin và tốc độ gõ
          </label>
          <label>
            Ký tự mỗi phút
            <input
              type="number"
              min={40}
              max={1200}
              placeholder="240"
              value={typing.charactersPerMinute ?? ""}
              onChange={(e) =>
                setValue({
                  ...value,
                  typing: {
                    ...typing,
                    charactersPerMinute:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            Thời gian suy nghĩ (giây)
            <input
              type="number"
              min={0}
              max={60}
              step={0.1}
              placeholder="1"
              value={
                typing.thinkingMs === undefined ? "" : typing.thinkingMs / 1000
              }
              onChange={(e) =>
                setValue({
                  ...value,
                  typing: {
                    ...typing,
                    thinkingMs:
                      e.target.value === ""
                        ? undefined
                        : Math.round(Number(e.target.value) * 1000),
                  },
                })
              }
            />
          </label>
          <label>
            Thời gian chờ tối đa (giây)
            <input
              type="number"
              min={1}
              max={300}
              placeholder="120"
              value={
                typing.maxDelayMs === undefined ? "" : typing.maxDelayMs / 1000
              }
              onChange={(e) =>
                setValue({
                  ...value,
                  typing: {
                    ...typing,
                    maxDelayMs:
                      e.target.value === ""
                        ? undefined
                        : Math.round(Number(e.target.value) * 1000),
                  },
                })
              }
            />
          </label>
          <p>
            Ví dụ: một phản hồi 100 ký tự sẽ chờ khoảng{" "}
            {Math.round(replyDelay("a".repeat(100), typing) / 1000)} giây. Gửi
            thủ công vẫn gửi ngay.
          </p>
        </section>
        <section className="card typing-test">
          <h3>Đo tốc độ gõ</h3>
          <p>
            Gõ lại đoạn dưới bằng bàn phím của bạn. Đồng hồ bắt đầu ở ký tự đầu
            tiên, kết thúc khi gõ đúng toàn bộ đoạn.
          </p>
          <blockquote>{TYPING_SAMPLE}</blockquote>
          <label>
            Đoạn bạn gõ
            <textarea
              rows={4}
              value={typed}
              disabled={Boolean(result)}
              onPaste={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              onChange={(e) => {
                const text = e.target.value;
                if (!text && started.current === null) return;
                if (started.current === null) {
                  started.current = performance.now();
                  setRunning(true);
                }
                setTyped(text);
                const duration = performance.now() - started.current;
                setElapsed(duration);
                if (text.normalize("NFC") === TYPING_SAMPLE) {
                  setRunning(false);
                  setResult(typingMeasurement(text, duration));
                }
              }}
            />
          </label>
          <p role="status">
            {Math.round(elapsed / 1000)} giây
            {result
              ? ` · ${result.charactersPerMinute} ký tự/phút · ${result.wordsPerMinute} từ/phút`
              : typed.normalize("NFC") === TYPING_SAMPLE
                ? " · Kết quả chưa hợp lệ, hãy thử lại bằng cách gõ."
                : ""}
          </p>
          <div className="inline">
            <button
              type="button"
              onClick={() => {
                started.current = null;
                setTyped("");
                setElapsed(0);
                setResult(null);
                setRunning(false);
              }}
            >
              Đo lại
            </button>
            {result && (
              <button
                type="button"
                onClick={() =>
                  setValue({
                    ...value,
                    typing: {
                      ...typing,
                      enabled: true,
                      charactersPerMinute: result.charactersPerMinute,
                    },
                  })
                }
              >
                Dùng tốc độ này
              </button>
            )}
          </div>
        </section>
      </div>
      <button className="primary" disabled={busy} type="submit">
        Lưu thiết lập trả lời
      </button>
    </form>
  );
}
