import type { AudioSource } from "@/lib/types";

export interface CapturedAudio {
  stream: MediaStream;
  stop: () => Promise<void>;
}

export function preferredRecordingMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  return "webm";
}

function ensureAudioTracks(stream: MediaStream, label: string): void {
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(`${label} không cung cấp audio. Hãy chọn tab có âm thanh và bật chia sẻ audio.`);
  }
}

export async function captureAudio(source: AudioSource): Promise<CapturedAudio> {
  const rawStreams: MediaStream[] = [];
  let audioContext: AudioContext | null = null;

  try {
    if (source === "microphone") {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      rawStreams.push(microphone);
      return {
        stream: microphone,
        stop: async () => microphone.getTracks().forEach((track) => track.stop()),
      };
    }

    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    rawStreams.push(display);
    ensureAudioTracks(display, "Nguồn chia sẻ màn hình");

    if (source === "system") {
      return {
        stream: new MediaStream(display.getAudioTracks()),
        stop: async () => display.getTracks().forEach((track) => track.stop()),
      };
    }

    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    rawStreams.push(microphone);

    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    for (const stream of [display, microphone]) {
      const sourceNode = audioContext.createMediaStreamSource(
        new MediaStream(stream.getAudioTracks()),
      );
      sourceNode.connect(destination);
    }

    return {
      stream: destination.stream,
      stop: async () => {
        rawStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
        await audioContext?.close();
      },
    };
  } catch (error) {
    rawStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    await audioContext?.close();
    throw error;
  }
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function audioBufferSliceToWav(
  buffer: AudioBuffer,
  startFrame: number,
  endFrame: number,
): Blob {
  const frameCount = Math.max(0, endFrame - startFrame);
  const bytesPerSample = 2;
  const dataSize = frameCount * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  let byteOffset = 44;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    let monoSample = 0;
    for (const channel of channels) monoSample += channel[frame] ?? 0;
    monoSample /= Math.max(1, channels.length);
    const clamped = Math.max(-1, Math.min(1, monoSample));
    view.setInt16(
      byteOffset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
    byteOffset += bytesPerSample;
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export interface AudioFileChunk {
  blob: Blob;
  startSeconds: number;
}

export async function splitAudioFileIntoWavChunks(
  file: File,
  chunkSeconds = 45,
): Promise<AudioFileChunk[]> {
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
    const requestedFrames = Math.max(1, Math.floor(decoded.sampleRate * chunkSeconds));
    // Giữ mỗi WAV chunk dưới khoảng 3.5 MB để phù hợp hơn với serverless upload.
    const maximumFramesByBytes = Math.floor((3.5 * 1024 * 1024 - 44) / 2);
    const framesPerChunk = Math.min(requestedFrames, maximumFramesByBytes);
    const chunks: AudioFileChunk[] = [];
    for (let start = 0; start < decoded.length; start += framesPerChunk) {
      chunks.push({
        blob: audioBufferSliceToWav(
          decoded,
          start,
          Math.min(start + framesPerChunk, decoded.length),
        ),
        startSeconds: start / decoded.sampleRate,
      });
    }
    return chunks;
  } finally {
    await audioContext.close();
  }
}
