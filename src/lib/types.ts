export type AudioSource = "microphone" | "system" | "both";
export type TranscriptSource = "live" | "upload" | "demo";
export type SpeakerAttribution = "diarized" | "contextual" | "manual" | "unknown";

export interface MeetingParticipant {
  id: string;
  name: string;
  role: string;
}

export interface MeetingProfile {
  title: string;
  recorderName: string;
  recorderRole: string;
  topic: string;
  participantCount: number;
  participants: MeetingParticipant[];
  additionalContext: string;
  audioSource: AudioSource;
}

export interface TranscriptSegment {
  id: string;
  sequence: number;
  atSeconds: number;
  endSeconds: number | null;
  text: string;
  source: TranscriptSource;
  speakerLabel: string | null;
  speakerName: string | null;
  speakerConfidence: number | null;
  speakerReason: string | null;
  attribution: SpeakerAttribution;
}

export interface MeetingDecision {
  text: string;
  evidence: string;
}

export interface MeetingActionItem {
  task: string;
  owner: string | null;
  deadline: string | null;
}

export interface MeetingSummary {
  overview: string;
  decisions: MeetingDecision[];
  actionItems: MeetingActionItem[];
  openQuestions: string[];
}

export const EMPTY_SUMMARY: MeetingSummary = {
  overview: "",
  decisions: [],
  actionItems: [],
  openQuestions: [],
};

export const DEFAULT_MEETING_PROFILE: MeetingProfile = {
  title: "Họp phân công dự án hackathon",
  recorderName: "",
  recorderRole: "Sinh viên đang họp nhóm với các bạn",
  topic: "Phân công nhiệm vụ và thống nhất kế hoạch triển khai dự án",
  participantCount: 4,
  participants: [],
  additionalContext: "",
  audioSource: "both",
};
