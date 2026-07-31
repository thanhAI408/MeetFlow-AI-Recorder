import OpenAI, { toFile } from "openai";
import { z } from "zod";

import { guardErrorResponse, guardRequest } from "@/lib/server/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/flac": "flac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
};
const ALLOWED_EXTENSIONS = new Set(["flac", "mp3", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);

const ContextSchema = z.object({
  recorderName: z.string().max(100).optional().default(""),
  recorderRole: z.string().max(300).optional().default(""),
  topic: z.string().max(500).optional().default(""),
  participantNames: z.array(z.string().max(100)).max(30).optional().default([]),
  additionalContext: z.string().max(2_000).optional().default(""),
});

interface DiarizedSegment {
  id?: string;
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
}

function extensionForFile(file: File): string {
  const mime = file.type.split(";", 1)[0].trim().toLowerCase();
  if (mime && MIME_TO_EXTENSION[mime]) return MIME_TO_EXTENSION[mime];
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ALLOWED_EXTENSIONS.has(extension)) return extension;
  throw new Error("UNSUPPORTED_AUDIO_TYPE");
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function parseContext(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return ContextSchema.parse({});
  try {
    return ContextSchema.parse(JSON.parse(value));
  } catch {
    return ContextSchema.parse({});
  }
}

function buildPrompt(context: z.infer<typeof ContextSchema>): string {
  const names = context.participantNames.length
    ? `Tên người tham gia có thể xuất hiện: ${context.participantNames.join(", ")}. `
    : "";
  return [
    "Bản ghi cuộc họp chủ yếu bằng tiếng Việt, có thể xen tiếng Anh.",
    "Giữ nguyên tên riêng và thuật ngữ AI, RAG, Agent, API, Vercel, hackathon, deadline.",
    names,
    context.recorderName ? `Người ghi âm tên ${context.recorderName}.` : "",
    context.recorderRole ? `Vai trò người ghi âm: ${context.recorderRole}.` : "",
    context.topic ? `Chủ đề cuộc họp: ${context.topic}.` : "",
    context.additionalContext ? `Bối cảnh: ${context.additionalContext}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return errorResponse("Server chưa cấu hình OPENAI_API_KEY.", 503);

  try {
    guardRequest(request, {
      id: "transcribe",
      maxRequests: 30,
      maxContentLength: MAX_AUDIO_BYTES + 512 * 1024,
    });
    const form = await request.formData();
    const audio = form.get("file");
    const sequenceValue = form.get("sequence");
    const context = parseContext(form.get("context"));
    if (!(audio instanceof File) || audio.size === 0) {
      return errorResponse("Không tìm thấy file audio.", 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return errorResponse("Mỗi audio chunk phải nhỏ hơn hoặc bằng 8 MB.", 413);
    }

    const extension = extensionForFile(audio);
    const normalizedMime = audio.type.split(";", 1)[0].trim() || undefined;
    const upload = await toFile(
      new Uint8Array(await audio.arrayBuffer()),
      `audio.${extension}`,
      normalizedMime ? { type: normalizedMime } : undefined,
    );
    const client = new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000 });
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-transcribe-diarize";

    let text = "";
    let segments: Array<{
      id: string;
      start: number;
      end: number | null;
      text: string;
      speaker: string | null;
    }> = [];

    if (model.includes("diarize")) {
      const result = (await client.audio.transcriptions.create({
        file: upload,
        model,
        language: "vi",
        response_format: "diarized_json",
        chunking_strategy: "auto",
      } as never)) as unknown as { text?: string; segments?: DiarizedSegment[] };

      text = result.text?.trim() ?? "";
      segments = (result.segments ?? [])
        .map((segment, index) => ({
          id: segment.id || `segment-${index + 1}`,
          start: Math.max(0, Number(segment.start ?? 0)),
          end: typeof segment.end === "number" ? Math.max(0, segment.end) : null,
          text: segment.text?.trim() ?? "",
          speaker: segment.speaker?.trim() || null,
        }))
        .filter((segment) => segment.text);
    } else {
      const result = await client.audio.transcriptions.create({
        file: upload,
        model,
        language: "vi",
        prompt: buildPrompt(context),
      });
      text = result.text.trim();
      if (text) {
        segments = [{ id: "segment-1", start: 0, end: null, text, speaker: null }];
      }
    }

    const sequence =
      typeof sequenceValue === "string" && /^\d+$/.test(sequenceValue)
        ? Number(sequenceValue)
        : undefined;
    return Response.json({ text, segments, sequence });
  } catch (error) {
    const guarded = guardErrorResponse(error);
    if (guarded) return guarded;
    const message = error instanceof Error ? error.message : "Không thể chuyển audio thành văn bản.";
    if (message === "UNSUPPORTED_AUDIO_TYPE") {
      return errorResponse("Định dạng audio chưa được hỗ trợ.", 415);
    }
    console.error("Transcription error", error);
    return errorResponse("Không thể chuyển audio thành văn bản. Hãy thử lại.", 502);
  }
}
