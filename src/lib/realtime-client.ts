export type RealtimeConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export interface RealtimeTranscriptDelta {
  key: string;
  text: string;
}

export interface RealtimeTranscriptCompleted {
  key: string;
  text: string;
}

interface RealtimeClientOptions {
  stream: MediaStream;
  meetingPrompt: string;
  endpoint?: string;
  onDelta?(event: RealtimeTranscriptDelta): void;
  onCompleted?(event: RealtimeTranscriptCompleted): void;
  onConnection?(state: RealtimeConnectionState): void;
  onError?(error: Error): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value.slice(0, 4_500));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Low-latency transcription transport. It clones the source audio tracks, so
 * closing or pausing Realtime never stops the master recording/fallback path.
 */
export class RealtimeTranscriptionClient {
  private readonly options: RealtimeClientOptions;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private realtimeTracks: MediaStreamTrack[] = [];
  private controller: AbortController | null = null;
  private closed = false;
  private lastState: RealtimeConnectionState | null = null;

  constructor(options: RealtimeClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error("Phiên Realtime đã đóng.");
    const sourceTracks = this.options.stream.getAudioTracks();
    if (!sourceTracks.length) throw new Error("Nguồn đã chọn không có audio track.");

    this.emit("connecting");
    try {
      const pc = new RTCPeerConnection();
      this.peerConnection = pc;
      this.realtimeTracks = sourceTracks.map((track) => track.clone());
      const realtimeStream = new MediaStream(this.realtimeTracks);
      for (const track of this.realtimeTracks) pc.addTrack(track, realtimeStream);

      pc.onconnectionstatechange = () => {
        if (this.closed) return;
        if (pc.connectionState === "connected") this.emit("connected");
        else if (pc.connectionState === "disconnected") this.emit("disconnected");
        else if (pc.connectionState === "failed") {
          this.emit("failed");
          this.options.onError?.(new Error("Kết nối Realtime bị mất."));
        }
      };

      const channel = pc.createDataChannel("oai-events");
      this.dataChannel = channel;
      channel.onopen = () => this.emit("connected");
      channel.onmessage = (event) => this.handleMessage(event.data);
      channel.onerror = () => this.options.onError?.(new Error("Kênh transcript Realtime gặp lỗi."));
      channel.onclose = () => {
        if (!this.closed) this.emit("disconnected");
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = pc.localDescription?.sdp ?? offer.sdp;
      if (!sdp) throw new Error("Không tạo được SDP offer.");

      const controller = new AbortController();
      this.controller = controller;
      const response = await fetch(this.options.endpoint ?? "/api/realtime/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
          "X-Meeting-Context": encodeUtf8Base64(this.options.meetingPrompt),
        },
        body: sdp,
        cache: "no-store",
        signal: controller.signal,
      });
      this.controller = null;
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Không tạo được phiên Realtime (HTTP ${response.status}).`);
      }
      const answer = (await response.text()).trim();
      if (!answer.startsWith("v=0")) throw new Error("SDP answer không hợp lệ.");
      if (!this.closed) await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (error) {
      if (this.closed && error instanceof DOMException && error.name === "AbortError") return;
      this.emit("failed");
      this.closeResources();
      throw error instanceof Error ? error : new Error("Không thể kết nối Realtime.");
    }
  }

  pause(): void {
    for (const track of this.realtimeTracks) track.enabled = false;
  }

  resume(): void {
    for (const track of this.realtimeTracks) track.enabled = true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeResources();
    this.emit("closed");
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(event) || typeof event.type !== "string") return;

    if (event.type === "error") {
      const nested = isRecord(event.error) ? event.error : null;
      const message = nested && typeof nested.message === "string"
        ? nested.message
        : "OpenAI Realtime báo lỗi.";
      this.options.onError?.(new Error(message));
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.failed") {
      this.options.onError?.(new Error("Một lượt nói không thể nhận dạng qua Realtime."));
      return;
    }

    const itemId = typeof event.item_id === "string" ? event.item_id : "unknown";
    const contentIndex = typeof event.content_index === "number" ? event.content_index : 0;
    const key = `${itemId}:${contentIndex}`;

    if (
      event.type === "conversation.item.input_audio_transcription.delta" &&
      typeof event.delta === "string"
    ) {
      this.options.onDelta?.({ key, text: event.delta });
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      typeof event.transcript === "string"
    ) {
      this.options.onCompleted?.({ key, text: event.transcript });
    }
  }

  private closeResources(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.dataChannel && this.dataChannel.readyState !== "closed") this.dataChannel.close();
    this.dataChannel = null;
    if (this.peerConnection && this.peerConnection.connectionState !== "closed") {
      this.peerConnection.close();
    }
    this.peerConnection = null;
    for (const track of this.realtimeTracks) track.stop();
    this.realtimeTracks = [];
  }

  private emit(state: RealtimeConnectionState): void {
    if (this.lastState === state) return;
    this.lastState = state;
    this.options.onConnection?.(state);
  }
}
