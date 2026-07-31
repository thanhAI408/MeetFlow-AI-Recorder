import { guardErrorResponse, guardRequest } from "@/lib/server/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SDP_BYTES = 128 * 1024;
const MAX_CONTEXT_BYTES = 8 * 1024;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function decodeMeetingPrompt(value: string | null): string {
  if (!value) return "Cuộc họp chủ yếu bằng tiếng Việt, có thể xen thuật ngữ tiếng Anh.";
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength > MAX_CONTEXT_BYTES) return "Cuộc họp chủ yếu bằng tiếng Việt.";
    return new TextDecoder().decode(bytes).slice(0, 4_500);
  } catch {
    return "Cuộc họp chủ yếu bằng tiếng Việt.";
  }
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return jsonError("Server chưa cấu hình OPENAI_API_KEY.", 503);

  try {
    guardRequest(request, {
      id: "realtime-session",
      maxRequests: 12,
      maxContentLength: MAX_SDP_BYTES,
    });
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/sdp")) {
      return jsonError("Realtime session yêu cầu SDP offer.", 415);
    }
    const sdp = await request.text();
    if (!sdp.trim().startsWith("v=0") || new TextEncoder().encode(sdp).byteLength > MAX_SDP_BYTES) {
      return jsonError("SDP offer không hợp lệ.", 400);
    }

    const prompt = decodeMeetingPrompt(request.headers.get("x-meeting-context"));
    const session = {
      type: "transcription",
      audio: {
        input: {
          noise_reduction: { type: "far_field" },
          transcription: {
            model:
              process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() ||
              "gpt-realtime-whisper",
            language: "vi",
            prompt,
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 450,
          },
        },
      },
    };

    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(session));
    const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    if (!upstream.ok) {
      if (upstream.status === 429) return jsonError("Realtime đang bị giới hạn; hệ thống sẽ dùng chế độ dự phòng.", 429);
      return jsonError("Không thể tạo phiên Realtime; hệ thống sẽ dùng chế độ dự phòng.", 502);
    }
    const answer = await upstream.text();
    if (!answer.trim().startsWith("v=0")) return jsonError("Realtime trả về SDP không hợp lệ.", 502);
    return new Response(answer, {
      headers: { "Content-Type": "application/sdp", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const guarded = guardErrorResponse(error);
    if (guarded) return guarded;
    console.error("Realtime session error", error);
    return jsonError("Không thể kết nối Realtime; hệ thống sẽ dùng chế độ dự phòng.", 502);
  }
}
