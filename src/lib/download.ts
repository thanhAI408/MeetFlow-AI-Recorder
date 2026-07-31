import type { MeetingProfile, MeetingSummary, TranscriptSegment } from "@/lib/types";

export function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remaining = safeSeconds % 60;
  return hours > 0
    ? [hours, minutes, remaining].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, remaining].map((part) => String(part).padStart(2, "0")).join(":");
}

export function sanitizeFilename(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return normalized || "meetflow-session";
}

export function speakerDisplay(segment: TranscriptSegment): string {
  if (segment.speakerName) return segment.speakerName;
  if (segment.speakerLabel) return `Người nói ${segment.speakerLabel}`;
  return "Chưa xác định";
}

export function transcriptToText(segments: TranscriptSegment[]): string {
  return segments
    .filter((segment) => segment.text.trim())
    .map(
      (segment) =>
        `[${formatTime(segment.atSeconds)}] ${speakerDisplay(segment)}: ${segment.text.trim()}`,
    )
    .join("\n");
}

function contextToMarkdown(profile: MeetingProfile): string {
  const participants = profile.participants.length
    ? profile.participants
        .map((person) => `- ${person.name}${person.role ? ` — ${person.role}` : ""}`)
        .join("\n")
    : "- Chưa khai báo tên người tham gia.";

  return `## Bối cảnh cuộc họp\n\n- Người ghi âm: ${profile.recorderName || "Chưa nêu"}\n- Vai trò người ghi âm: ${profile.recorderRole || "Chưa nêu"}\n- Chủ đề: ${profile.topic || "Chưa nêu"}\n- Số người dự kiến: ${profile.participantCount}\n- Bối cảnh bổ sung: ${profile.additionalContext || "Không có"}\n\n### Người tham gia\n\n${participants}`;
}

export function transcriptToMarkdown(
  title: string,
  profile: MeetingProfile,
  segments: TranscriptSegment[],
  summary: MeetingSummary,
): string {
  const decisions = summary.decisions.length
    ? summary.decisions.map((item) => `- ${item.text}\n  - Căn cứ: “${item.evidence}”`).join("\n")
    : "- Chưa có quyết định rõ ràng.";
  const actions = summary.actionItems.length
    ? summary.actionItems
        .map(
          (item) =>
            `- ${item.task} — Người phụ trách: ${item.owner ?? "chưa rõ"}; Hạn: ${item.deadline ?? "chưa rõ"}`,
        )
        .join("\n")
    : "- Chưa có công việc rõ ràng.";
  const questions = summary.openQuestions.length
    ? summary.openQuestions.map((item) => `- ${item}`).join("\n")
    : "- Không có.";

  return `# ${title.trim() || "MeetFlow AI session"}\n\n${contextToMarkdown(
    profile,
  )}\n\n## Tóm tắt\n\n${
    summary.overview || "Chưa tạo tóm tắt AI."
  }\n\n## Quyết định\n\n${decisions}\n\n## Công việc\n\n${actions}\n\n## Điểm cần làm rõ\n\n${questions}\n\n## Transcript\n\n${transcriptToText(
    segments,
  )}\n`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function downloadText(text: string, filename: string, type = "text/plain"): void {
  downloadBlob(new Blob(["\ufeff", text], { type: `${type};charset=utf-8` }), filename);
}
