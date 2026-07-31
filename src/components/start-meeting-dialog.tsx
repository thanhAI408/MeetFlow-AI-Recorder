"use client";

import {
  Check,
  Info,
  Laptop,
  Mic,
  Plus,
  Radio,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import {
  DEFAULT_MEETING_PROFILE,
  type AudioSource,
  type MeetingParticipant,
  type MeetingProfile,
} from "@/lib/types";

interface StartMeetingDialogProps {
  open: boolean;
  aiConfigured: boolean;
  busy: boolean;
  error: string | null;
  initialProfile?: MeetingProfile;
  purpose?: "record" | "context";
  onClose(): void;
  onStart(profile: MeetingProfile, demo: boolean): void;
}

const SOURCES: Array<{
  value: AudioSource;
  icon: typeof Mic;
  label: string;
  description: string;
}> = [
  {
    value: "microphone",
    icon: Mic,
    label: "Chỉ microphone",
    description: "Phù hợp khi mọi người ngồi cùng phòng hoặc dùng loa ngoài.",
  },
  {
    value: "system",
    icon: Laptop,
    label: "Âm thanh màn hình",
    description: "Chọn tab/cửa sổ họp và bật Chia sẻ âm thanh.",
  },
  {
    value: "both",
    icon: Radio,
    label: "Microphone + màn hình",
    description: "Ghi cả giọng của bạn và âm thanh Zoom/Meet/Teams.",
  },
];

function createParticipant(index: number): MeetingParticipant {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    role: "",
  };
}

export function StartMeetingDialog({
  open,
  aiConfigured,
  busy,
  error,
  initialProfile,
  purpose = "record",
  onClose,
  onStart,
}: StartMeetingDialogProps) {
  const titleId = useId();
  const [profile, setProfile] = useState<MeetingProfile>(() => ({
    ...DEFAULT_MEETING_PROFILE,
    participants: Array.from({ length: 3 }, (_, index) => createParticipant(index)),
  }));
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (!open || !initialProfile) return;

    const frame = window.requestAnimationFrame(() => {
      setProfile({
        ...initialProfile,
        participants: initialProfile.participants.length
          ? initialProfile.participants.map((person) => ({ ...person }))
          : Array.from(
              { length: Math.max(0, (initialProfile.participantCount || 4) - 1) },
              (_, index) => createParticipant(index),
            ),
      });
      setConsent(false);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialProfile, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  const contextOnly = purpose === "context";
  const namedParticipants = useMemo(
    () => profile.participants.filter((person) => person.name.trim()),
    [profile.participants],
  );

  if (!open) return null;

  const updateParticipant = (id: string, patch: Partial<MeetingParticipant>) => {
    setProfile((current) => ({
      ...current,
      participants: current.participants.map((person) =>
        person.id === id ? { ...person, ...patch } : person,
      ),
    }));
  };

  const removeParticipant = (id: string) => {
    setProfile((current) => ({
      ...current,
      participants: current.participants.filter((person) => person.id !== id),
    }));
  };

  const addParticipant = () => {
    setProfile((current) => ({
      ...current,
      participants: [...current.participants, createParticipant(current.participants.length)],
      participantCount: Math.max(current.participantCount, current.participants.length + 2),
    }));
  };

  const submit = (demo: boolean) => {
    onStart(
      {
        ...profile,
        title: profile.title.trim() || "Cuộc họp mới",
        recorderName: profile.recorderName.trim(),
        recorderRole: profile.recorderRole.trim(),
        topic: profile.topic.trim(),
        additionalContext: profile.additionalContext.trim(),
        participants: namedParticipants.map((person) => ({
          ...person,
          name: person.name.trim(),
          role: person.role.trim(),
        })),
      },
      demo,
    );
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="dialog-card dialog-card--meeting"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-card__header">
          <div>
            <span className="eyebrow">Thiết lập bối cảnh</span>
            <h2 id={titleId}>{contextOnly ? "Chuẩn bị file ghi âm" : "Bắt đầu cuộc họp"}</h2>
            <p>Thông tin càng rõ, transcript, tên người nói và biên bản càng chính xác.</p>
          </div>
          <button className="icon-button" disabled={busy} onClick={onClose} type="button" aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="dialog-form-grid">
          <label>
            <span className="field-label">Tên cuộc họp</span>
            <input
              className="text-input"
              maxLength={150}
              onChange={(event) => setProfile((current) => ({ ...current, title: event.target.value }))}
              placeholder="Ví dụ: Họp phân công dự án"
              value={profile.title}
            />
          </label>
          <label>
            <span className="field-label">Tên người ghi âm</span>
            <input
              className="text-input"
              maxLength={100}
              onChange={(event) => setProfile((current) => ({ ...current, recorderName: event.target.value }))}
              placeholder="Ví dụ: Nguyễn Văn Thành"
              value={profile.recorderName}
            />
          </label>
        </div>

        <label>
          <span className="field-label">Người ghi âm đang làm gì trong cuộc họp?</span>
          <input
            className="text-input"
            maxLength={300}
            onChange={(event) => setProfile((current) => ({ ...current, recorderRole: event.target.value }))}
            placeholder="Ví dụ: Sinh viên, trưởng nhóm, đang họp nhóm với các bạn"
            value={profile.recorderRole}
          />
        </label>

        <label>
          <span className="field-label">Cuộc họp về vấn đề gì?</span>
          <textarea
            className="text-area"
            maxLength={500}
            onChange={(event) => setProfile((current) => ({ ...current, topic: event.target.value }))}
            placeholder="Mục tiêu, vấn đề cần giải quyết, kết quả mong muốn..."
            rows={3}
            value={profile.topic}
          />
        </label>

        <div className="participants-header">
          <div>
            <span className="field-label">Các thành viên khác</span>
            <small>Không lặp lại người ghi âm; AI dùng tên và vai trò để đối chiếu người nói.</small>
          </div>
          <label className="count-field">
            <span>Tổng số, kể cả người ghi âm</span>
            <input
              min={1}
              max={100}
              type="number"
              value={profile.participantCount}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  participantCount: Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                }))
              }
            />
          </label>
        </div>

        <div className="participants-list">
          {profile.participants.map((person, index) => (
            <div className="participant-row" key={person.id}>
              <span className="participant-index">{index + 1}</span>
              <input
                aria-label={`Tên người tham gia ${index + 1}`}
                className="text-input"
                maxLength={100}
                onChange={(event) => updateParticipant(person.id, { name: event.target.value })}
                placeholder="Họ tên"
                value={person.name}
              />
              <input
                aria-label={`Vai trò người tham gia ${index + 1}`}
                className="text-input"
                maxLength={200}
                onChange={(event) => updateParticipant(person.id, { role: event.target.value })}
                placeholder="Vai trò/phần phụ trách"
                value={person.role}
              />
              <button
                aria-label={`Xóa người tham gia ${index + 1}`}
                className="icon-button icon-button--quiet icon-button--delete"
                onClick={() => removeParticipant(person.id)}
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button className="add-participant" onClick={addParticipant} type="button">
            <Plus size={15} /> Thêm người tham gia
          </button>
        </div>

        <label>
          <span className="field-label">Bối cảnh bổ sung</span>
          <textarea
            className="text-area"
            maxLength={2000}
            onChange={(event) => setProfile((current) => ({ ...current, additionalContext: event.target.value }))}
            placeholder="Ví dụ: Thành phụ trách AI, Hải phụ trách frontend; nhóm cần chốt deadline trước cuối buổi..."
            rows={3}
            value={profile.additionalContext}
          />
        </label>

        {!contextOnly && (
          <fieldset className="source-picker">
            <legend>Nguồn âm thanh</legend>
            <div className="source-picker-grid">
            {SOURCES.map((option) => {
              const Icon = option.icon;
              const selected = profile.audioSource === option.value;
              return (
                <button
                  aria-pressed={selected}
                  className={`source-option${selected ? " source-option--selected" : ""}`}
                  key={option.value}
                  onClick={() => setProfile((current) => ({ ...current, audioSource: option.value }))}
                  type="button"
                >
                  <span className="source-option__icon"><Icon size={20} /></span>
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                  {selected && <Check className="source-option__check" size={17} />}
                </button>
              );
            })}
            </div>
          </fieldset>
        )}

        <div className="speaker-note">
          <Info size={18} />
          <p>
            AI có thể tách các giọng thành A/B/C và đối chiếu tên theo lời tự giới thiệu, cách gọi tên,
            vai trò và mạch hội thoại. Khi chưa đủ chắc chắn, hệ thống sẽ giữ “Người nói A” thay vì gán sai.
            Đầu buổi nên để mỗi người nói một câu có tên của mình.
          </p>
        </div>

        <label className="consent-check">
          <input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
          <span>Tôi xác nhận <strong>tất cả người tham gia đã đồng ý việc ghi âm và xử lý giọng nói.</strong></span>
        </label>

        {!aiConfigured && (
          <div className="inline-notice inline-notice--warning">
            Chưa cấu hình OpenAI. Bạn vẫn có thể xem demo, nhưng ghi âm và xử lý file thật cần OPENAI_API_KEY.
          </div>
        )}
        {error && <div className="inline-notice inline-notice--error">{error}</div>}

        <div className={`dialog-actions${contextOnly ? " dialog-actions--end" : ""}`}>
          {!contextOnly && (
            <button className="button button--secondary" disabled={busy} onClick={() => submit(true)} type="button">
              <Sparkles size={17} /> Dùng dữ liệu mô phỏng
            </button>
          )}
          <button
            className="button button--primary"
            disabled={!consent || !profile.title.trim() || !aiConfigured || busy}
            onClick={() => submit(false)}
            type="button"
          >
            {busy ? <span className="spinner" /> : <Users size={17} />}
            {busy ? "Đang xử lý…" : contextOnly ? "Lưu bối cảnh và chọn file" : "Bắt đầu ghi"}
          </button>
        </div>
      </section>
    </div>
  );
}
