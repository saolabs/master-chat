import React, { useState } from "react";
import type {
  Command,
  Conversation,
  ProfileObservation,
  Snapshot,
} from "../core/types.ts";
import { profileSamples } from "../core/contact-profile.ts";
import { messageContent } from "../core/response-style.ts";

export function ContactProfilePanel({
  c,
  snapshot,
  busy,
  run,
  showEvidence,
}: {
  c: Conversation;
  snapshot: Snapshot;
  busy: boolean;
  run: (command: Command) => Promise<Snapshot | null>;
  showEvidence: (id: string) => void;
}) {
  const [style, setStyle] = useState(c.responseStyle ?? "");
  const [context, setContext] = useState(c.relationshipContext ?? "");
  const [direction, setDirection] = useState(c.conversationDirection ?? "");
  const [learn, setLearn] = useState(
    c.learnStyle === undefined ? "default" : c.learnStyle ? "on" : "off",
  );
  const enabled = c.learnStyle ?? snapshot.data.response?.learnStyle ?? true;
  const count = profileSamples(snapshot.data, c).length;
  const profile = c.contactProfile;
  function observation(label: string, value: ProfileObservation | null) {
    return (
      <div className="profile-observation">
        <strong>{label}</strong>
        <p>{value?.detail || "Chưa đủ bằng chứng."}</p>
        {value && (
          <details>
            <summary>Xem tin dẫn chứng · {value.evidenceIds.length}</summary>
            {value.evidenceIds.map((id) => {
              const m = c.messages.find((m) => m.id === id);
              return (
                <div key={id}>
                  <p>
                    {m
                      ? `${m.direction === "outgoing" ? "Bạn" : c.name}: ${messageContent(m).slice(0, 500)}`
                      : "Tin không còn trong lịch sử local."}
                  </p>
                  <button
                    type="button"
                    disabled={!m}
                    onClick={() => showEvidence(id)}
                  >
                    Xem trong lịch sử
                  </button>
                </div>
              );
            })}
          </details>
        )}
      </div>
    );
  }
  return (
    <details className="contact-style">
      <summary>Hồ sơ & định hướng với người này (tùy chọn)</summary>
      <label>
        Ngữ cảnh quan hệ
        <textarea
          aria-label="Ngữ cảnh quan hệ"
          rows={4}
          maxLength={12000}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Hai người quen nhau thế nào, dữ kiện hoặc vấn đề cần biết…"
        />
      </label>
      <small>
        Thông tin nền giúp hiểu quan hệ; không phải mục tiêu cần đạt trong mỗi
        tin nhắn.
      </small>
      <label>
        Định hướng trò chuyện
        <textarea
          aria-label="Định hướng trò chuyện"
          rows={4}
          maxLength={12000}
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="Ví dụ: lắng nghe và đồng hành; giải đáp nhu cầu khách hàng; gợi mở nhẹ nhàng khi phù hợp…"
        />
      </label>
      <small>
        Mục tiêu dài hạn được áp dụng khi đúng lúc. Khi người kia đổi chủ đề,
        phản hồi theo tin mới thay vì ép quay lại mục tiêu.
      </small>
      <label>
        Phong cách riêng
        <textarea
          aria-label="Phong cách riêng"
          rows={3}
          maxLength={4000}
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          placeholder="Để trống để học từ lịch sử hoặc dùng phong cách chung…"
        />
      </label>
      <label>
        Tự dựng hồ sơ
        <select
          aria-label="Tự dựng hồ sơ"
          value={learn}
          onChange={(e) => setLearn(e.target.value)}
        >
          <option value="default">Theo thiết lập chung</option>
          <option value="on">Bật riêng</option>
          <option value="off">Tắt riêng</option>
        </select>
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run({
            type: "conversation.style",
            conversationId: c.id,
            style,
            relationshipContext: context,
            conversationDirection: direction,
            ...(learn === "default" ? {} : { learnStyle: learn === "on" }),
          })
        }
      >
        Lưu hồ sơ & định hướng
      </button>
      <p>
        {!enabled
          ? "Đã tắt tự học; phần bạn nhập vẫn áp dụng."
          : profile
            ? `Hồ sơ đã học từ ${profile.messageCount} tin, trong đó ${profile.ownerMessageCount} tin bạn tự gửi. Cập nhật: ${new Date(profile.updatedAt).toLocaleString("vi-VN")}.`
            : `Có ${count}/50 tin đủ nội dung. ${count < 50 ? "Chưa đủ hồ sơ; dùng phong cách chung và ngữ cảnh bạn nhập." : "Có thể dựng hồ sơ từ lịch sử hiện có."}`}
      </p>
      {c.profileError && <p role="status">{c.profileError}</p>}
      <div className="inline">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run({ type: "conversation.backfill", conversationId: c.id })
          }
        >
          Nạp thêm lịch sử
        </button>
        <button
          type="button"
          disabled={busy || !enabled || count < 50}
          onClick={() =>
            void run({ type: "style.learn", conversationId: c.id })
          }
        >
          Dựng lại hồ sơ
        </button>
      </div>
      <small>
        Nạp thêm lịch sử từ Messenger khi còn tải được. Hồ sơ dùng lịch sử hai
        phía; giọng của bạn được học từ các tin bạn tự gửi, loại tin AI.
      </small>
      {profile && (
        <details className="learned-profile">
          <summary>Xem hồ sơ đã học</summary>
          {observation("Mối quan hệ", profile.relationship)}
          {observation("Cách xưng hô", profile.address)}
          {observation("Cách bạn nói chuyện", profile.style)}
          {profile.facts.map((fact, i) => (
            <React.Fragment key={i}>
              {observation("Dữ kiện liên quan", fact)}
            </React.Fragment>
          ))}
          {profile.cautions.length > 0 && (
            <>
              <strong>Điểm chưa chắc / cần lưu ý</strong>
              {profile.cautions.map((x, i) => (
                <p key={i}>{x}</p>
              ))}
            </>
          )}
        </details>
      )}
    </details>
  );
}
