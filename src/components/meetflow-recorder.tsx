"use client";

import {
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  CircleStop,
  Clipboard,
  Download,
  FileAudio,
  FileJson,
  FileText,
  Gauge,
  Info,
  LoaderCircle,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Users,
  Volume2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { LandingView } from "@/components/landing-view";
import { StartMeetingDialog } from "@/components/start-meeting-dialog";
import {
  captureAudio,
  extensionForMimeType,
  preferredRecordingMimeType,
  splitAudioFileIntoWavChunks,
  type CapturedAudio,
} from "@/lib/audio";
import {
  downloadBlob,
  downloadText,
  formatTime,
  sanitizeFilename,
  speakerDisplay,
  transcriptToMarkdown,
  transcriptToText,
} from "@/lib/download";
import { RealtimeTranscriptionClient, type RealtimeConnectionState } from "@/lib/realtime-client";
import {
  DEFAULT_MEETING_PROFILE,
  EMPTY_SUMMARY,
  type MeetingProfile,
  type MeetingSummary,
  type SpeakerAttribution,
  type TranscriptSegment,
  type TranscriptSource,
} from "@/lib/types";

interface MeetFlowRecorderProps {
  aiConfigured: boolean;
}

type RecordingStatus = "idle" | "connecting" | "recording" | "paused" | "stopping";
type WorkspaceMode = "live" | "upload";
type AppView = "landing" | "workspace";

interface QueueItem {
  blob: Blob;
  sequence: number;
  atSeconds: number;
  durationSeconds: number;
  realtimeThrough: number;
  source: TranscriptSource;
}

interface TranscriptionPayload {
  text?: string;
  segments?: Array<{
    id?: string;
    start?: number;
    end?: number | null;
    text?: string;
    speaker?: string | null;
  }>;
}

interface AttributionPayload {
  assignments?: Array<{
    id: string;
    speakerName: string | null;
    confidence: number;
    reason: string;
  }>;
}

const LIVE_CHUNK_MS = 12_000;
const MAX_DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;
const SUMMARY_DEBOUNCE_MS = 1_800;

const DEMO_LINES = [
  { speaker: "Thành", text: "Mình là Thành, hôm nay mình điều phối buổi họp và phụ trách phần AI." },
  { speaker: "Hải", text: "Mình là Hải, mình nhận phần giao diện upload file và trình phát audio." },
  { speaker: "Khánh", text: "Mình là Khánh, mình sẽ kiểm thử prompt và bộ dữ liệu đánh giá." },
  { speaker: "Thành", text: "Chúng ta thống nhất triển khai bản MVP lên Vercel trước 17 giờ hôm nay." },
  { speaker: "Hải", text: "Mình sẽ hoàn thiện giao diện trước 15 giờ để cả nhóm test." },
  { speaker: "Khánh", text: "Phần tự động gửi email mới chỉ là đề xuất, chưa đưa vào phạm vi hackathon." },
];

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readApiError(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function sourceLabel(source: MeetingProfile["audioSource"]): string {
  if (source === "microphone") return "Microphone";
  if (source === "system") return "Âm thanh hệ thống";
  return "Mic + hệ thống";
}

function sourceIcon(source: MeetingProfile["audioSource"]) {
  if (source === "microphone") return <Mic size={17} />;
  if (source === "system") return <Volume2 size={17} />;
  return <AudioLines size={17} />;
}

function buildRealtimePrompt(profile: MeetingProfile): string {
  const participants = profile.participants
    .filter((person) => person.name)
    .map((person) => `${person.name}${person.role ? ` — ${person.role}` : ""}`)
    .join("; ");
  return [
    "Cuộc họp chủ yếu bằng tiếng Việt, có thể xen thuật ngữ tiếng Anh.",
    "Giữ nguyên tên riêng và các thuật ngữ AI, RAG, Agent, API, Vercel, hackathon, deadline.",
    profile.recorderName ? `Người ghi âm: ${profile.recorderName}.` : "",
    profile.recorderRole ? `Vai trò người ghi âm: ${profile.recorderRole}.` : "",
    profile.topic ? `Chủ đề: ${profile.topic}.` : "",
    participants ? `Người tham gia: ${participants}.` : "",
    profile.additionalContext ? `Bối cảnh: ${profile.additionalContext}.` : "",
  ].filter(Boolean).join(" ");
}

function profileForApi(profile: MeetingProfile) {
  return {
    recorderName: profile.recorderName,
    recorderRole: profile.recorderRole,
    topic: profile.topic,
    participantCount: profile.participantCount,
    participantNames: profile.participants.map((person) => person.name),
    participants: profile.participants.map(({ name, role }) => ({ name, role })),
    additionalContext: profile.additionalContext,
  };
}

function confidenceLabel(value: number | null): string {
  if (value === null) return "";
  if (value >= 0.85) return "tin cậy cao";
  if (value >= 0.65) return "có khả năng";
  return "chưa chắc";
}

export function MeetFlowRecorder({ aiConfigured }: MeetFlowRecorderProps) {
  const [view, setView] = useState<AppView>("landing");
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [dialogPurpose, setDialogPurpose] = useState<"record" | "context">("record");
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("live");
  const [profile, setProfile] = useState<MeetingProfile>(DEFAULT_MEETING_PROFILE);
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<MeetingSummary>(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<Date | null>(null);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioFilename, setAudioFilename] = useState("meetflow-recording.webm");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [autoSummary, setAutoSummary] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [liveDraft, setLiveDraft] = useState("");
  const [realtimeState, setRealtimeState] = useState<RealtimeConnectionState | "fallback">("closed");

  const statusRef = useRef<RecordingStatus>("idle");
  const profileRef = useRef(profile);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const summaryRef = useRef<MeetingSummary>(EMPTY_SUMMARY);
  const elapsedRef = useRef(0);
  const clockRef = useRef<number | null>(null);
  const capturedAudioRef = useRef<CapturedAudio | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(false);
  const masterRecorderRef = useRef<MediaRecorder | null>(null);
  const masterChunksRef = useRef<Blob[]>([]);
  const masterMimeRef = useRef("audio/webm");
  const masterStopPromiseRef = useRef<Promise<void> | null>(null);
  const masterStopResolveRef = useRef<(() => void) | null>(null);
  const segmentRecorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<number | null>(null);
  const segmentStopPromiseRef = useRef<Promise<void> | null>(null);
  const segmentStopResolveRef = useRef<(() => void) | null>(null);
  const startSegmentCaptureRef = useRef<() => void>(() => {});
  const sequenceRef = useRef(0);
  const queueRef = useRef<QueueItem[]>([]);
  const queueBusyRef = useRef(false);
  const queueWaitersRef = useRef<Array<() => void>>([]);
  const mountedRef = useRef(true);
  const audioUrlRef = useRef<string | null>(null);
  const summaryTimerRef = useRef<number | null>(null);
  const summaryInFlightRef = useRef(false);
  const summaryPendingRef = useRef(false);
  const summarizedThroughRef = useRef(0);
  const requestSummaryRef = useRef<(manual?: boolean) => Promise<void>>(async () => {});
  const realtimeRef = useRef<RealtimeTranscriptionClient | null>(null);
  const realtimeDeltasRef = useRef(new Map<string, string>());
  const realtimeCommittedRef = useRef<Array<{ ordinal: number; text: string }>>([]);
  const realtimeOrdinalRef = useRef(0);

  const transcript = useMemo(() => transcriptToText(segments), [segments]);
  const baseFilename = sanitizeFilename(profile.title);
  const hasTranscript = transcript.trim().length > 0;
  const isLiveBusy = status !== "idle";
  const knownNames = useMemo(
    () =>
      Array.from(
        new Set(
          [profile.recorderName, ...profile.participants.map((person) => person.name)].filter(Boolean),
        ),
      ),
    [profile],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem("meetflow-theme");
      const next =
        saved === "dark" ||
        (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
      setDarkMode(next);
      document.documentElement.classList.toggle("dark", next);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleTheme = useCallback(() => {
    setDarkMode((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);
      window.localStorage.setItem("meetflow-theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  const setRecordingStatus = useCallback((next: RecordingStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const replaceAudioUrl = useCallback((blob: Blob | null) => {
    setAudioUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      const next = blob ? URL.createObjectURL(blob) : null;
      audioUrlRef.current = next;
      return next;
    });
  }, []);

  const resetOutput = useCallback(() => {
    setSegments([]);
    segmentsRef.current = [];
    setSummary(EMPTY_SUMMARY);
    summaryRef.current = EMPTY_SUMMARY;
    summarizedThroughRef.current = 0;
    setSummaryUpdatedAt(null);
    setError(null);
    setNotice(null);
    setAudioBlob(null);
    replaceAudioUrl(null);
    setUploadProgress(0);
    setLiveDraft("");
    realtimeDeltasRef.current.clear();
    realtimeCommittedRef.current = [];
    realtimeOrdinalRef.current = 0;
  }, [replaceAudioUrl]);

  const applySegments = useCallback((incoming: TranscriptSegment[]) => {
    if (!incoming.length || !mountedRef.current) return;
    const next = [...segmentsRef.current, ...incoming].sort(
      (left, right) => left.atSeconds - right.atSeconds || left.sequence - right.sequence,
    );
    segmentsRef.current = next;
    setSegments(next);
  }, []);

  const refreshLiveDraft = useCallback(() => {
    const committed = realtimeCommittedRef.current.map((item) => item.text);
    const deltas = Array.from(realtimeDeltasRef.current.values());
    setLiveDraft([...committed, ...deltas].filter(Boolean).join(" ").trim());
  }, []);

  const attributeSpeakers = useCallback(
    async (
      rawSegments: Array<{ id: string; speakerLabel: string | null; text: string }>,
    ): Promise<Map<string, { name: string | null; confidence: number; reason: string }>> => {
      const currentProfile = profileRef.current;
      const hasNames = Boolean(
        currentProfile.recorderName || currentProfile.participants.some((person) => person.name),
      );
      if (!hasNames || rawSegments.length === 0) return new Map();

      try {
        const response = await fetch("/api/attribute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meeting: {
              recorderName: currentProfile.recorderName,
              recorderRole: currentProfile.recorderRole,
              topic: currentProfile.topic,
              additionalContext: currentProfile.additionalContext,
              participants: currentProfile.participants.map(({ name, role }) => ({ name, role })),
            },
            recentTranscript: transcriptToText(segmentsRef.current.slice(-16)),
            segments: rawSegments,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as AttributionPayload;
        if (!response.ok || !payload.assignments) return new Map();
        return new Map(
          payload.assignments.map((item) => [
            item.id,
            {
              name: item.speakerName,
              confidence: item.confidence,
              reason: item.reason,
            },
          ]),
        );
      } catch {
        return new Map();
      }
    },
    [],
  );

  const transcribeBlob = useCallback(
    async (item: QueueItem): Promise<void> => {
      const extension = extensionForMimeType(item.blob.type);
      const form = new FormData();
      form.append("file", item.blob, `chunk-${item.sequence}.${extension}`);
      form.append("sequence", String(item.sequence));
      form.append("context", JSON.stringify(profileForApi(profileRef.current)));

      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const payload = (await response.json().catch(() => ({}))) as TranscriptionPayload;
      if (!response.ok) {
        throw new Error(readApiError(payload, "Không thể chuyển audio thành transcript."));
      }

      const sourceSegments =
        payload.segments?.filter((segment) => segment.text?.trim()) ??
        (payload.text?.trim()
          ? [{ id: `fallback-${item.sequence}`, start: 0, end: null, text: payload.text, speaker: null }]
          : []);
      if (!sourceSegments.length) return;

      const rawToClientId = new Map<string, string>();
      const rawForAttribution = sourceSegments.map((segment, index) => {
        const rawId = segment.id || `${item.sequence}-${index}`;
        const clientId = createId();
        rawToClientId.set(rawId, clientId);
        return {
          id: rawId,
          speakerLabel: segment.speaker?.trim() || null,
          text: segment.text?.trim() || "",
        };
      });

      const normalized: TranscriptSegment[] = sourceSegments.map((segment, index) => {
        const rawId = segment.id || `${item.sequence}-${index}`;
        const speakerLabel = segment.speaker?.trim() || null;
        return {
          id: rawToClientId.get(rawId) || createId(),
          sequence: item.sequence * 100 + index,
          atSeconds: item.atSeconds + Math.max(0, Number(segment.start ?? 0)),
          endSeconds:
            typeof segment.end === "number"
              ? item.atSeconds + Math.max(0, segment.end)
              : null,
          text: segment.text?.trim() || "",
          source: item.source,
          speakerLabel,
          speakerName: null,
          speakerConfidence: null,
          speakerReason: null,
          attribution: speakerLabel ? "diarized" : "unknown",
        };
      });
      applySegments(normalized);
      if (item.source === "live") {
        realtimeCommittedRef.current = realtimeCommittedRef.current.filter(
          (line) => line.ordinal > item.realtimeThrough,
        );
        refreshLiveDraft();
      }

      void attributeSpeakers(rawForAttribution).then((assignments) => {
        if (!mountedRef.current || assignments.size === 0) return;
        const assignmentByClientId = new Map<
          string,
          { name: string | null; confidence: number; reason: string }
        >();
        for (const [rawId, assignment] of assignments) {
          const clientId = rawToClientId.get(rawId);
          if (clientId) assignmentByClientId.set(clientId, assignment);
        }
        if (assignmentByClientId.size === 0) return;

        const next = segmentsRef.current.map((segment): TranscriptSegment => {
          const assignment = assignmentByClientId.get(segment.id);
          if (!assignment || !assignment.name) return segment;
          return {
            ...segment,
            speakerName: assignment.name,
            speakerConfidence: assignment.confidence,
            speakerReason: assignment.reason,
            attribution: "contextual",
          };
        });
        segmentsRef.current = next;
        setSegments(next);
        summarizedThroughRef.current = 0;
      });
    },
    [applySegments, attributeSpeakers, refreshLiveDraft],
  );

  const resolveQueueWaiters = useCallback(() => {
    if (queueBusyRef.current || queueRef.current.length > 0) return;
    const waiters = queueWaitersRef.current.splice(0);
    waiters.forEach((resolve) => resolve());
  }, []);

  const processQueue = useCallback(async () => {
    if (queueBusyRef.current) return;
    queueBusyRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift();
        setPendingChunks(queueRef.current.length + 1);
        if (!item) continue;
        try {
          await transcribeBlob(item);
        } catch (queueError) {
          setError(
            queueError instanceof Error ? queueError.message : "Một audio chunk không thể xử lý.",
          );
        }
      }
    } finally {
      queueBusyRef.current = false;
      setPendingChunks(0);
      resolveQueueWaiters();
    }
  }, [resolveQueueWaiters, transcribeBlob]);

  const enqueueChunk = useCallback(
    (
      blob: Blob,
      source: TranscriptSource,
      atSeconds: number,
      durationSeconds: number,
      realtimeThrough: number,
    ) => {
      if (!mountedRef.current || blob.size < 1_000) return;
      sequenceRef.current += 1;
      queueRef.current.push({
        blob,
        sequence: sequenceRef.current,
        atSeconds,
        durationSeconds,
        realtimeThrough,
        source,
      });
      setPendingChunks(queueRef.current.length + (queueBusyRef.current ? 1 : 0));
      void processQueue();
    },
    [processQueue],
  );

  const waitForQueue = useCallback((): Promise<void> => {
    if (!queueBusyRef.current && queueRef.current.length === 0) return Promise.resolve();
    return new Promise((resolve) => queueWaitersRef.current.push(resolve));
  }, []);

  const startSegmentCapture = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !activeRef.current || pausedRef.current) return;

    const mimeType = preferredRecordingMimeType();
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    segmentRecorderRef.current = recorder;
    segmentStopPromiseRef.current = new Promise((resolve) => {
      segmentStopResolveRef.current = resolve;
    });
    const chunkStartedAt = elapsedRef.current;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => setError("Trình duyệt gặp lỗi khi chia audio để nhận dạng.");
    recorder.onstop = () => {
      if (segmentTimerRef.current !== null) {
        window.clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      if (segmentRecorderRef.current === recorder) segmentRecorderRef.current = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      enqueueChunk(
        blob,
        "live",
        chunkStartedAt,
        Math.max(0.1, elapsedRef.current - chunkStartedAt),
        realtimeOrdinalRef.current,
      );
      segmentStopResolveRef.current?.();
      segmentStopResolveRef.current = null;
      if (activeRef.current && !pausedRef.current) {
        window.setTimeout(() => startSegmentCaptureRef.current(), 60);
      }
    };

    recorder.start();
    segmentTimerRef.current = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, LIVE_CHUNK_MS);
  }, [enqueueChunk]);

  useEffect(() => {
    startSegmentCaptureRef.current = startSegmentCapture;
  }, [startSegmentCapture]);

  const stopSegmentRecorder = useCallback(async () => {
    if (segmentTimerRef.current !== null) {
      window.clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    const recorder = segmentRecorderRef.current;
    const stopped = segmentStopPromiseRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (stopped) await stopped;
  }, []);

  const stopClock = useCallback(() => {
    if (clockRef.current !== null) {
      window.clearInterval(clockRef.current);
      clockRef.current = null;
    }
  }, []);

  const startClock = useCallback(() => {
    stopClock();
    clockRef.current = window.setInterval(() => {
      if (statusRef.current !== "recording") return;
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
    }, 1_000);
  }, [stopClock]);

  const stopMasterRecorder = useCallback(async (): Promise<Blob> => {
    const recorder = masterRecorderRef.current;
    const stopPromise = masterStopPromiseRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (stopPromise) await stopPromise;
    return new Blob(masterChunksRef.current, { type: masterMimeRef.current });
  }, []);

  const releaseCapture = useCallback(async () => {
    realtimeRef.current?.close();
    realtimeRef.current = null;
    setRealtimeState("closed");
    const capture = capturedAudioRef.current;
    capturedAudioRef.current = null;
    streamRef.current = null;
    if (capture) await capture.stop();
  }, []);

  const startLiveRecording = useCallback(
    async (nextProfile: MeetingProfile) => {
      if (!aiConfigured) {
        setStartError("Server chưa có OPENAI_API_KEY. Hãy cấu hình file .env.local trước.");
        return;
      }

      setStartBusy(true);
      setStartError(null);
      setProfile(nextProfile);
      profileRef.current = nextProfile;
      resetOutput();
      setWorkspaceMode("live");
      setRecordingStatus("connecting");
      setElapsedSeconds(0);
      elapsedRef.current = 0;
      sequenceRef.current = 0;
      queueRef.current = [];
      masterChunksRef.current = [];
      activeRef.current = false;
      pausedRef.current = false;

      try {
        const captured = await captureAudio(nextProfile.audioSource);
        capturedAudioRef.current = captured;
        streamRef.current = captured.stream;
        const mimeType = preferredRecordingMimeType();
        const recorder = new MediaRecorder(captured.stream, mimeType ? { mimeType } : undefined);
        masterRecorderRef.current = recorder;
        masterMimeRef.current = recorder.mimeType || mimeType || "audio/webm";
        masterStopPromiseRef.current = new Promise((resolve) => {
          masterStopResolveRef.current = resolve;
        });
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) masterChunksRef.current.push(event.data);
        };
        recorder.onerror = () => setError("Không thể lưu bản ghi âm đầy đủ.");
        recorder.onstop = () => {
          masterStopResolveRef.current?.();
          masterStopResolveRef.current = null;
        };
        recorder.start(1_000);

        const realtime = new RealtimeTranscriptionClient({
          stream: captured.stream,
          meetingPrompt: buildRealtimePrompt(nextProfile),
          onDelta: ({ key, text }) => {
            realtimeDeltasRef.current.set(
              key,
              `${realtimeDeltasRef.current.get(key) ?? ""}${text}`,
            );
            refreshLiveDraft();
          },
          onCompleted: ({ key, text }) => {
            realtimeDeltasRef.current.delete(key);
            const cleaned = text.trim();
            if (cleaned) {
              realtimeOrdinalRef.current += 1;
              realtimeCommittedRef.current.push({
                ordinal: realtimeOrdinalRef.current,
                text: cleaned,
              });
            }
            refreshLiveDraft();
          },
          onConnection: (connection) => {
            if (connection === "connected" || connection === "connecting") {
              setRealtimeState(connection);
            } else if (connection === "failed" || connection === "disconnected") {
              setRealtimeState("fallback");
            } else {
              setRealtimeState(connection);
            }
          },
          onError: () => {
            if (realtimeRef.current !== realtime) return;
            realtime.close();
            realtimeRef.current = null;
            setRealtimeState("fallback");
            setNotice("Realtime bị gián đoạn; transcript vẫn tiếp tục bằng audio chunk dự phòng.");
          },
        });
        realtimeRef.current = realtime;
        setRealtimeState("connecting");
        void realtime.connect().catch(() => {
          if (realtimeRef.current !== realtime) return;
          realtime.close();
          realtimeRef.current = null;
          setRealtimeState("fallback");
          setNotice("Không kết nối được Realtime; đã chuyển sang near real-time dự phòng.");
        });

        activeRef.current = true;
        pausedRef.current = false;
        setView("workspace");
        setStartDialogOpen(false);
        setRecordingStatus("recording");
        startClock();
        startSegmentCaptureRef.current();
        setNotice(
          `Đang ghi ${sourceLabel(nextProfile.audioSource)}. Realtime hiển thị bản nháp; diarization xác nhận và cập nhật summary liên tục.`,
        );
      } catch (captureError) {
        await releaseCapture();
        setRecordingStatus("idle");
        setStartError(
          captureError instanceof Error
            ? captureError.message
            : "Không thể truy cập nguồn âm thanh.",
        );
      } finally {
        setStartBusy(false);
      }
    },
    [aiConfigured, refreshLiveDraft, releaseCapture, resetOutput, setRecordingStatus, startClock],
  );

  const pauseLiveRecording = useCallback(async () => {
    if (statusRef.current !== "recording") return;
    pausedRef.current = true;
    setRecordingStatus("paused");
    if (masterRecorderRef.current?.state === "recording") masterRecorderRef.current.pause();
    realtimeRef.current?.pause();
    await stopSegmentRecorder();
    setNotice("Đã tạm dừng. Audio và transcript trước đó vẫn được giữ nguyên.");
  }, [setRecordingStatus, stopSegmentRecorder]);

  const resumeLiveRecording = useCallback(() => {
    if (statusRef.current !== "paused") return;
    pausedRef.current = false;
    if (masterRecorderRef.current?.state === "paused") masterRecorderRef.current.resume();
    realtimeRef.current?.resume();
    setRecordingStatus("recording");
    startSegmentCaptureRef.current();
    setNotice("Đã tiếp tục ghi âm.");
  }, [setRecordingStatus]);

  const requestSummary = useCallback(async (manual = false): Promise<void> => {
    const currentSegments = segmentsRef.current;
    if (currentSegments.length === 0) {
      if (manual) setError("Chưa có transcript để tóm tắt.");
      return;
    }
    if (summaryInFlightRef.current) {
      summaryPendingRef.current = true;
      return;
    }

    const fromIndex = manual && summarizedThroughRef.current >= currentSegments.length
      ? 0
      : summarizedThroughRef.current;
    const newSegments = currentSegments.slice(fromIndex);
    if (!newSegments.length) return;

    summaryInFlightRef.current = true;
    summaryPendingRef.current = false;
    setSummaryLoading(true);
    if (manual) setError(null);
    try {
      const currentProfile = profileRef.current;
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousSummary: summaryRef.current,
          newTranscript: transcriptToText(newSegments),
          meeting: {
            recorderName: currentProfile.recorderName,
            recorderRole: currentProfile.recorderRole,
            topic: currentProfile.topic,
            participantCount: currentProfile.participantCount,
            participants: currentProfile.participants.map(({ name, role }) => ({ name, role })),
            additionalContext: currentProfile.additionalContext,
          },
        }),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readApiError(payload, "Không thể tạo tóm tắt."));
      const nextSummary = payload as MeetingSummary;
      setSummary(nextSummary);
      summaryRef.current = nextSummary;
      summarizedThroughRef.current = currentSegments.length;
      setSummaryUpdatedAt(new Date());
      if (manual) setNotice("AI đã cập nhật biên bản từ toàn bộ nội dung hiện có.");
    } catch (summaryError) {
      if (manual) {
        setError(summaryError instanceof Error ? summaryError.message : "Không thể tạo tóm tắt.");
      }
    } finally {
      summaryInFlightRef.current = false;
      setSummaryLoading(false);
      if (
        summaryPendingRef.current &&
        segmentsRef.current.length > summarizedThroughRef.current
      ) {
        summaryPendingRef.current = false;
        window.setTimeout(() => void requestSummaryRef.current(false), 100);
      }
    }
  }, []);

  useEffect(() => {
    requestSummaryRef.current = requestSummary;
  }, [requestSummary]);

  useEffect(() => {
    if (!autoSummary || !aiConfigured || segments.length <= summarizedThroughRef.current) return;
    if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = window.setTimeout(() => {
      void requestSummary(false);
    }, SUMMARY_DEBOUNCE_MS);
    return () => {
      if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
    };
  }, [aiConfigured, autoSummary, requestSummary, segments]);

  const stopLiveRecording = useCallback(async () => {
    if (statusRef.current === "idle" || statusRef.current === "stopping") return;
    setRecordingStatus("stopping");
    activeRef.current = false;
    pausedRef.current = false;
    stopClock();

    try {
      await stopSegmentRecorder();
      const fullRecording = await stopMasterRecorder();
      await releaseCapture();
      await waitForQueue();
      realtimeDeltasRef.current.clear();
      realtimeCommittedRef.current = [];
      setLiveDraft("");
      if (fullRecording.size > 0) {
        setAudioBlob(fullRecording);
        const extension = extensionForMimeType(fullRecording.type);
        setAudioFilename(`${sanitizeFilename(profileRef.current.title)}.${extension}`);
        replaceAudioUrl(fullRecording);
      }
      await requestSummary(false);
      setNotice("Đã dừng. Bản ghi âm, transcript và biên bản đã sẵn sàng để tải xuống.");
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Không thể kết thúc bản ghi.");
      await releaseCapture();
    } finally {
      setRecordingStatus("idle");
    }
  }, [releaseCapture, replaceAudioUrl, requestSummary, setRecordingStatus, stopClock, stopMasterRecorder, stopSegmentRecorder, waitForQueue]);

  const transcribeUploadedFile = useCallback(async () => {
    if (!selectedFile) {
      setError("Hãy chọn một file audio trước.");
      return;
    }
    if (!aiConfigured) {
      setError("Server chưa có OPENAI_API_KEY. Hãy cấu hình file .env.local trước.");
      return;
    }

    resetOutput();
    setUploadBusy(true);
    setError(null);
    setNotice("Đang đọc file và chuẩn bị các audio chunk…");
    sequenceRef.current = 0;
    setAudioBlob(selectedFile);
    setAudioFilename(selectedFile.name);
    replaceAudioUrl(selectedFile);

    try {
      let chunks: Array<{ blob: Blob; startSeconds: number }>;
      try {
        chunks = await splitAudioFileIntoWavChunks(selectedFile, 45);
      } catch {
        if (selectedFile.size > MAX_DIRECT_UPLOAD_BYTES) {
          throw new Error(
            "Trình duyệt không giải mã được file để chia nhỏ. Hãy chuyển sang MP3, WAV, M4A hoặc dùng file dưới 4 MB.",
          );
        }
        chunks = [{ blob: selectedFile, startSeconds: 0 }];
      }

      if (chunks.length === 0) throw new Error("File audio không có dữ liệu.");
      setNotice(`Đang chuyển ${chunks.length} đoạn audio thành văn bản…`);
      for (let index = 0; index < chunks.length; index += 1) {
        sequenceRef.current += 1;
        await transcribeBlob({
          blob: chunks[index].blob,
          sequence: sequenceRef.current,
          atSeconds: chunks[index].startSeconds,
          durationSeconds: 45,
          realtimeThrough: 0,
          source: "upload",
        });
        setUploadProgress(Math.round(((index + 1) / chunks.length) * 100));
      }
      await requestSummary(false);
      setNotice("Đã tạo transcript và biên bản từ file audio.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không thể xử lý file audio.");
    } finally {
      setUploadBusy(false);
    }
  }, [aiConfigured, replaceAudioUrl, requestSummary, resetOutput, selectedFile, transcribeBlob]);

  const loadDemo = useCallback((demoProfile?: MeetingProfile) => {
    const nextProfile: MeetingProfile = demoProfile ?? {
      ...DEFAULT_MEETING_PROFILE,
      recorderName: "Thành",
      recorderRole: "Sinh viên, trưởng nhóm, phụ trách AI",
      participantCount: 4,
      participants: [
        { id: createId(), name: "Hải", role: "Phụ trách frontend" },
        { id: createId(), name: "Khánh", role: "Phụ trách prompt và đánh giá" },
        { id: createId(), name: "Ninh", role: "Phụ trách kiểm thử" },
      ],
    };
    setProfile(nextProfile);
    profileRef.current = nextProfile;
    resetOutput();
    setWorkspaceMode("live");
    const demoSegments: TranscriptSegment[] = DEMO_LINES.map((item, index) => ({
      id: createId(),
      sequence: index + 1,
      atSeconds: index * 12,
      endSeconds: index * 12 + 8,
      text: item.text,
      source: "demo",
      speakerLabel: String.fromCharCode(65 + (index % 3)),
      speakerName: item.speaker,
      speakerConfidence: 0.98,
      speakerReason: "Dữ liệu demo có tên người nói được xác định sẵn.",
      attribution: "manual",
    }));
    setSegments(demoSegments);
    segmentsRef.current = demoSegments;
    const demoSummary: MeetingSummary = {
      overview: "Nhóm sinh viên phân công hoàn thiện MVP MeetFlow AI và thống nhất mốc triển khai trong ngày.",
      decisions: [
        {
          text: "Triển khai bản MVP lên Vercel trước 17 giờ hôm nay.",
          evidence: "Chúng ta thống nhất triển khai bản MVP lên Vercel trước 17 giờ hôm nay.",
        },
      ],
      actionItems: [
        { task: "Hoàn thiện giao diện upload file", owner: "Hải", deadline: "15 giờ hôm nay" },
        { task: "Điều phối và hoàn thiện phần AI", owner: "Thành", deadline: null },
        { task: "Kiểm thử prompt và bộ dữ liệu đánh giá", owner: "Khánh", deadline: null },
      ],
      openQuestions: ["Phần tự động gửi email có được đưa vào phiên bản sau hackathon không?"],
    };
    setSummary(demoSummary);
    summaryRef.current = demoSummary;
    setSummaryUpdatedAt(new Date());
    summarizedThroughRef.current = demoSegments.length;
    setView("workspace");
    setStartDialogOpen(false);
    setNotice("Đây là dữ liệu mô phỏng có tên người nói và summary mẫu.");
  }, [resetOutput]);

  const updateSegmentText = useCallback((id: string, text: string) => {
    setSegments((current) => {
      const next = current.map((segment) => (segment.id === id ? { ...segment, text } : segment));
      segmentsRef.current = next;
      return next;
    });
    summarizedThroughRef.current = 0;
  }, []);

  const updateSegmentSpeaker = useCallback((id: string, speakerName: string) => {
    setSegments((current) => {
      const next = current.map((segment): TranscriptSegment => {
        if (segment.id !== id) return segment;
        const attribution: SpeakerAttribution = speakerName
          ? "manual"
          : segment.speakerLabel
            ? "diarized"
            : "unknown";
        return {
          ...segment,
          speakerName: speakerName || null,
          speakerConfidence: speakerName ? 1 : null,
          speakerReason: speakerName ? "Người dùng xác nhận thủ công." : null,
          attribution,
        };
      });
      segmentsRef.current = next;
      return next;
    });
    summarizedThroughRef.current = 0;
  }, []);

  const removeSegment = useCallback((id: string) => {
    setSegments((current) => {
      const next = current.filter((segment) => segment.id !== id);
      segmentsRef.current = next;
      return next;
    });
    summarizedThroughRef.current = 0;
  }, []);

  const copyTranscript = useCallback(async () => {
    if (!hasTranscript) return;
    await navigator.clipboard.writeText(transcript);
    setNotice("Đã sao chép transcript vào clipboard.");
  }, [hasTranscript, transcript]);

  const downloadTranscript = useCallback(
    (format: "txt" | "md" | "json") => {
      if (!hasTranscript) return;
      if (format === "txt") {
        downloadText(transcript, `${baseFilename}-transcript.txt`);
        return;
      }
      if (format === "md") {
        downloadText(
          transcriptToMarkdown(profile.title, profile, segments, summary),
          `${baseFilename}-meeting-notes.md`,
          "text/markdown",
        );
        return;
      }
      downloadText(
        JSON.stringify({ meeting: profile, transcript: segments, summary }, null, 2),
        `${baseFilename}-meeting-data.json`,
        "application/json",
      );
    },
    [baseFilename, hasTranscript, profile, segments, summary, transcript],
  );

  const openUploadWorkspace = useCallback(() => {
    setDialogPurpose("context");
    setStartError(null);
    setStartDialogOpen(true);
  }, []);

  const returnHome = useCallback(() => {
    if (statusRef.current !== "idle" || uploadBusy) return;
    setView("landing");
  }, [uploadBusy]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      stopClock();
      if (segmentTimerRef.current !== null) window.clearTimeout(segmentTimerRef.current);
      if (summaryTimerRef.current !== null) window.clearTimeout(summaryTimerRef.current);
      if (segmentRecorderRef.current?.state !== "inactive") segmentRecorderRef.current?.stop();
      if (masterRecorderRef.current?.state !== "inactive") masterRecorderRef.current?.stop();
      realtimeRef.current?.close();
      realtimeRef.current = null;
      void capturedAudioRef.current?.stop();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    };
  }, [stopClock]);

  if (view === "landing") {
    return (
      <>
        <LandingView
          aiConfigured={aiConfigured}
          onDemo={() => loadDemo()}
          onStart={() => {
            setDialogPurpose("record");
            setStartError(null);
            setStartDialogOpen(true);
          }}
          onUpload={openUploadWorkspace}
          darkMode={darkMode}
          onToggleTheme={toggleTheme}
        />
        <StartMeetingDialog
          aiConfigured={aiConfigured}
          busy={startBusy}
          error={startError}
          initialProfile={profile}
          open={startDialogOpen}
          purpose={dialogPurpose}
          onClose={() => setStartDialogOpen(false)}
          onStart={(nextProfile, demo) => {
            if (dialogPurpose === "context") {
              setProfile(nextProfile);
              profileRef.current = nextProfile;
              setWorkspaceMode("upload");
              setView("workspace");
              setStartDialogOpen(false);
              setNotice("Bối cảnh đã lưu. Hãy chọn file audio để tạo transcript và summary.");
              return;
            }
            if (demo) loadDemo(nextProfile);
            else void startLiveRecording(nextProfile);
          }}
        />
      </>
    );
  }

  return (
    <main className="app-shell workspace-app">
      <header className="topbar workspace-topbar">
        <div className="workspace-title-group">
          <button
            className="icon-button"
            aria-label="Về trang chủ"
            disabled={isLiveBusy || uploadBusy}
            onClick={returnHome}
            type="button"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="app-brand-mark"><Sparkles size={20} /></div>
          <div>
            <strong>{profile.title}</strong>
            <span>{profile.recorderRole || "MeetFlow AI Recorder"}</span>
          </div>
        </div>
        <div className="workspace-statuses">
          <span className={`api-badge ${aiConfigured ? "ready" : "missing"}`}>
            <span /> {aiConfigured ? "AI sẵn sàng" : "Thiếu API key"}
          </span>
          {status === "recording" && (
            <>
              <span className={`realtime-badge ${realtimeState}`}>
                <i />
                {realtimeState === "connected"
                  ? "Realtime"
                  : realtimeState === "connecting"
                    ? "Đang nối Realtime"
                    : "Near real-time dự phòng"}
              </span>
              <span className="live-badge"><i /> LIVE · {formatTime(elapsedSeconds)}</span>
            </>
          )}
        </div>
      </header>

      <section className="context-ribbon">
        <div><UserRound size={16} /><span><strong>Người ghi âm:</strong> {profile.recorderName || "Chưa nêu"}</span></div>
        <div><Users size={16} /><span><strong>Thành viên:</strong> {profile.participantCount} người · {knownNames.join(", ") || "chưa khai báo tên"}</span></div>
        <div><Info size={16} /><span><strong>Chủ đề:</strong> {profile.topic || "Chưa nêu"}</span></div>
      </section>

      <div className="mode-tabs" role="tablist" aria-label="Nguồn audio">
        <button
          className={workspaceMode === "live" ? "active" : ""}
          type="button"
          onClick={() => setWorkspaceMode("live")}
          disabled={isLiveBusy || uploadBusy}
        >
          <Mic size={18} /> Ghi âm trực tiếp
        </button>
        <button
          className={workspaceMode === "upload" ? "active" : ""}
          type="button"
          onClick={() => setWorkspaceMode("upload")}
          disabled={isLiveBusy || uploadBusy}
        >
          <Upload size={18} /> Đưa file ghi âm
        </button>
      </div>

      <section className="workspace-grid">
        <div className="control-column">
          <article className="panel control-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">NGUỒN ĐẦU VÀO</p>
                <h2>{workspaceMode === "live" ? "Điều khiển cuộc họp" : "Transcribe file audio"}</h2>
              </div>
              {workspaceMode === "live" && (
                <div className={`recording-pill ${status}`}>
                  <span />
                  {status === "recording"
                    ? formatTime(elapsedSeconds)
                    : status === "paused"
                      ? "Đã tạm dừng"
                      : status === "connecting"
                        ? "Đang kết nối"
                        : status === "stopping"
                          ? "Đang hoàn tất"
                          : "Sẵn sàng"}
                </div>
              )}
            </div>

            {workspaceMode === "live" ? (
              <>
                <div className="active-source">
                  {sourceIcon(profile.audioSource)}
                  <div><span>Nguồn đang dùng</span><strong>{sourceLabel(profile.audioSource)}</strong></div>
                </div>
                <div className="primary-actions">
                  {status === "idle" && (
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => {
                        setDialogPurpose("record");
                        setStartError(null);
                        setStartDialogOpen(true);
                      }}
                    >
                      <Mic size={18} /> Bắt đầu phiên mới
                    </button>
                  )}
                  {status === "recording" && (
                    <>
                      <button className="secondary-button" type="button" onClick={() => void pauseLiveRecording()}>
                        <Pause size={18} /> Tạm dừng
                      </button>
                      <button className="danger-button" type="button" onClick={() => void stopLiveRecording()}>
                        <CircleStop size={18} /> Dừng và lưu
                      </button>
                    </>
                  )}
                  {status === "paused" && (
                    <>
                      <button className="primary-button" type="button" onClick={resumeLiveRecording}>
                        <Play size={18} /> Tiếp tục
                      </button>
                      <button className="danger-button" type="button" onClick={() => void stopLiveRecording()}>
                        <CircleStop size={18} /> Dừng và lưu
                      </button>
                    </>
                  )}
                  {(status === "connecting" || status === "stopping") && (
                    <button className="primary-button" type="button" disabled>
                      <LoaderCircle className="spin" size={18} /> Đang xử lý…
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <button
                  className="secondary-button context-edit-button"
                  type="button"
                  onClick={() => {
                    setDialogPurpose("context");
                    setStartError(null);
                    setStartDialogOpen(true);
                  }}
                  disabled={uploadBusy}
                >
                  <Users size={17} /> Chỉnh bối cảnh và thành viên
                </button>
                <label className={`upload-dropzone ${selectedFile ? "has-file" : ""}`}>
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac,.mpga,.mpeg"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0] ?? null)}
                    disabled={uploadBusy}
                  />
                  <FileAudio size={34} />
                  <strong>{selectedFile ? selectedFile.name : "Chọn file ghi âm"}</strong>
                  <span>
                    {selectedFile
                      ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                      : "MP3, WAV, M4A, OGG, WebM hoặc FLAC"}
                  </span>
                </label>
                <button
                  className="primary-button wide-button"
                  type="button"
                  onClick={() => void transcribeUploadedFile()}
                  disabled={!selectedFile || uploadBusy}
                >
                  {uploadBusy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
                  {uploadBusy ? `Đang xử lý ${uploadProgress}%` : "Tạo script và summary"}
                </button>
                {uploadBusy && (
                  <div className="progress-track" aria-label={`Tiến độ ${uploadProgress}%`}>
                    <span style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </>
            )}

            {error && <div className="message error-message">{error}</div>}
            {notice && <div className="message notice-message">{notice}</div>}
            {pendingChunks > 0 && (
              <div className="processing-row">
                <LoaderCircle className="spin" size={16} />
                AI đang xử lý {pendingChunks} audio chunk…
              </div>
            )}
          </article>

          <article className="panel context-panel">
            <div className="panel-heading compact">
              <div><p className="section-kicker">MEETING CONTEXT</p><h2>Bối cảnh AI đang dùng</h2></div>
            </div>
            <dl className="context-list">
              <div><dt>Vai trò người ghi âm</dt><dd>{profile.recorderRole || "Chưa nêu"}</dd></div>
              <div><dt>Vấn đề cuộc họp</dt><dd>{profile.topic || "Chưa nêu"}</dd></div>
              <div><dt>Thành viên</dt><dd>{profile.participants.length ? profile.participants.map((person) => `${person.name}${person.role ? ` (${person.role})` : ""}`).join(", ") : "Chưa có danh sách tên"}</dd></div>
              {profile.additionalContext && <div><dt>Bổ sung</dt><dd>{profile.additionalContext}</dd></div>}
            </dl>
            <div className="accuracy-tip"><Gauge size={16} /><span>Để gán đúng tên hơn, mỗi người nên tự giới thiệu tên một lần ở đầu buổi.</span></div>
          </article>

          <article className="panel audio-panel">
            <div className="panel-heading compact">
              <div><p className="section-kicker">BẢN GHI ÂM</p><h2>Nghe lại và tải xuống</h2></div>
              {audioBlob && (
                <button className="icon-text-button" type="button" onClick={() => downloadBlob(audioBlob, audioFilename)}>
                  <Download size={16} /> Tải audio
                </button>
              )}
            </div>
            {audioUrl ? (
              <><audio className="audio-player" controls src={audioUrl} /><p className="muted-text">{audioFilename}</p></>
            ) : (
              <div className="empty-audio"><FileAudio size={28} /><span>Bản ghi xuất hiện sau khi dừng hoặc chọn file.</span></div>
            )}
          </article>

          <article className="panel summary-panel">
            <div className="panel-heading compact">
              <div>
                <p className="section-kicker">LIVE MEETING NOTES</p>
                <h2>Biên bản thời gian thực</h2>
                <span className="muted-text">
                  {summaryUpdatedAt ? `Cập nhật ${summaryUpdatedAt.toLocaleTimeString("vi-VN")}` : "Chưa có dữ liệu"}
                </span>
              </div>
              <button
                className="icon-text-button accent"
                type="button"
                onClick={() => void requestSummary(true)}
                disabled={!hasTranscript || summaryLoading}
              >
                {summaryLoading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                Cập nhật ngay
              </button>
            </div>
            <label className="auto-summary-toggle">
              <input type="checkbox" checked={autoSummary} onChange={(event) => setAutoSummary(event.target.checked)} />
              <span>Tự động cập nhật khi có transcript mới</span>
              {summaryLoading && <LoaderCircle className="spin" size={14} />}
            </label>
            {summary.overview ? (
              <div className="summary-content">
                <p>{summary.overview}</p>
                <SummaryList title="Quyết định" items={summary.decisions.map((item) => `${item.text} — “${item.evidence}”`)} />
                <SummaryList title="Công việc" items={summary.actionItems.map((item) => `${item.task} · ${item.owner ?? "chưa rõ người phụ trách"} · ${item.deadline ?? "chưa rõ deadline"}`)} />
                <SummaryList title="Cần làm rõ" items={summary.openQuestions} />
              </div>
            ) : (
              <p className="muted-text">Biên bản sẽ tự xuất hiện sau khi AI nhận được đoạn transcript đầu tiên.</p>
            )}
          </article>
        </div>

        <article className="panel transcript-panel">
          <div className="panel-heading transcript-heading">
            <div>
              <p className="section-kicker">LIVE SCRIPT</p>
              <h2>Transcript theo người nói</h2>
              <span className="muted-text">{segments.length} lượt nói · {transcript.length.toLocaleString("vi-VN")} ký tự</span>
            </div>
            <div className="export-actions">
              <button type="button" title="Sao chép" onClick={() => void copyTranscript()} disabled={!hasTranscript}><Clipboard size={17} /></button>
              <button type="button" title="Tải TXT" onClick={() => downloadTranscript("txt")} disabled={!hasTranscript}><FileText size={17} /></button>
              <button type="button" title="Tải Markdown" onClick={() => downloadTranscript("md")} disabled={!hasTranscript}><Download size={17} /></button>
              <button type="button" title="Tải JSON" onClick={() => downloadTranscript("json")} disabled={!hasTranscript}><FileJson size={17} /></button>
              <button type="button" title="Xóa kết quả" onClick={resetOutput} disabled={!hasTranscript || isLiveBusy || uploadBusy}><RotateCcw size={17} /></button>
            </div>
          </div>

          <div className="speaker-legend">
            <CheckCircle2 size={15} />
            <span>Bản nháp Realtime xuất hiện trước; bản xác nhận sẽ được diarization tách người nói và thay thế liên tục.</span>
          </div>

          {liveDraft && (
            <div className="live-draft" aria-live="polite">
              <div><AudioLines size={17} /><strong>Đang nghe — bản nháp Realtime</strong></div>
              <p>{liveDraft}</p>
            </div>
          )}

          <div className="transcript-list">
            {segments.length === 0 ? (
              <div className="empty-transcript">
                <AudioLines size={42} />
                <h3>Đang chờ lời nói đầu tiên</h3>
                <p>Bản nháp xuất hiện ngay khi Realtime nhận lời nói; bản có người nói được xác nhận theo chu kỳ khoảng 12 giây.</p>
              </div>
            ) : (
              segments.map((segment) => (
                <div className="transcript-row speaker-transcript-row" key={segment.id}>
                  <div className="timestamp">{formatTime(segment.atSeconds)}</div>
                  <div className="speaker-editor">
                    <select
                      aria-label={`Người nói tại ${formatTime(segment.atSeconds)}`}
                      value={segment.speakerName ?? ""}
                      onChange={(event) => updateSegmentSpeaker(segment.id, event.target.value)}
                    >
                      <option value="">{segment.speakerLabel ? `Người nói ${segment.speakerLabel}` : "Chưa xác định"}</option>
                      {knownNames.map((name) => <option value={name} key={name}>{name}</option>)}
                    </select>
                    <div className="speaker-meta">
                      <strong>{speakerDisplay(segment)}</strong>
                      {segment.speakerName && segment.attribution !== "manual" && (
                        <span title={segment.speakerReason ?? "AI đối chiếu theo bối cảnh"}>
                          {confidenceLabel(segment.speakerConfidence)} · {Math.round((segment.speakerConfidence ?? 0) * 100)}%
                        </span>
                      )}
                      {segment.attribution === "manual" && <span>đã xác nhận thủ công</span>}
                    </div>
                  </div>
                  <textarea
                    value={segment.text}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateSegmentText(segment.id, event.target.value)}
                    aria-label={`Transcript tại ${formatTime(segment.atSeconds)}`}
                    rows={Math.max(2, Math.ceil(segment.text.length / 68))}
                  />
                  <button className="delete-segment" type="button" title="Xóa đoạn" onClick={() => removeSegment(segment.id)}><Trash2 size={16} /></button>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <StartMeetingDialog
        aiConfigured={aiConfigured}
        busy={startBusy}
        error={startError}
        initialProfile={profile}
        open={startDialogOpen}
        purpose={dialogPurpose}
        onClose={() => setStartDialogOpen(false)}
        onStart={(nextProfile, demo) => {
          if (dialogPurpose === "context") {
            setProfile(nextProfile);
            profileRef.current = nextProfile;
            setWorkspaceMode("upload");
            setStartDialogOpen(false);
            setNotice("Bối cảnh đã được cập nhật cho file ghi âm.");
            return;
          }
          if (demo) loadDemo(nextProfile);
          else void startLiveRecording(nextProfile);
        }}
      />

      <footer className="workspace-footer">
        Tên người nói là kết quả diarization và đối chiếu theo bối cảnh, không phải nhận dạng danh tính tuyệt đối.
      </footer>
    </main>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="summary-list">
      <h3>{title}</h3>
      {items.length ? (
        <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul>
      ) : (
        <span className="muted-text">Chưa có.</span>
      )}
    </div>
  );
}
