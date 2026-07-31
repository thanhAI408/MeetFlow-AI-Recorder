import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { guardErrorResponse, guardRequest } from "@/lib/server/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SegmentSchema = z.object({
  id: z.string().min(1).max(200),
  speakerLabel: z.string().nullable(),
  text: z.string().min(1).max(8_000),
});

const RequestSchema = z.object({
  meeting: z.object({
    recorderName: z.string().max(100),
    recorderRole: z.string().max(300),
    topic: z.string().max(500),
    additionalContext: z.string().max(2_000),
    participants: z.array(
      z.object({
        name: z.string().min(1).max(100),
        role: z.string().max(200),
      }),
    ).max(30),
  }),
  recentTranscript: z.string().max(40_000),
  segments: z.array(SegmentSchema).min(1).max(80),
});

const AssignmentSchema = z.object({
  assignments: z.array(
    z.object({
      id: z.string(),
      speakerName: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `Bạn là bộ gán tên người nói cực kỳ thận trọng cho MeetFlow AI.

Dữ liệu đầu vào có nhãn diarization như A/B/C. Nhãn này chỉ phân biệt giọng nói trong audio chunk hiện tại và có thể đổi giữa các chunk.

Chỉ gán speakerName bằng đúng một tên trong danh sách participants hoặc recorderName khi có căn cứ đủ mạnh, ví dụ:
- người nói tự giới thiệu tên;
- người khác gọi đích danh rồi người đó trả lời rõ;
- nội dung chứa vai trò/nhiệm vụ độc nhất khớp mạnh với bối cảnh đã cung cấp;
- recentTranscript có chuỗi hội thoại đủ rõ để nối tiếp.

Không được đoán theo giới tính, giọng vùng miền, tên phổ biến hoặc thứ tự danh sách. Tên đã xuất hiện trong recentTranscript có thể là dự đoán trước đó, nên không được dùng riêng nó làm bằng chứng. Trong cùng một request, các segment có cùng speakerLabel phải được xử lý nhất quán. Nếu thiếu căn cứ, speakerName phải là null. Nếu confidence dưới 0.65 thì speakerName phải là null. reason phải ngắn, trung thực. Trả đủ một assignment cho mỗi segment id.`;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: "Server chưa cấu hình OPENAI_API_KEY." }, { status: 503 });

  try {
    guardRequest(request, {
      id: "speaker-attribution",
      maxRequests: 30,
      maxContentLength: 256 * 1024,
    });
    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Dữ liệu nhận diện người nói không hợp lệ." }, { status: 422 });
    }

    const allowedNames = new Set([
      parsed.data.meeting.recorderName,
      ...parsed.data.meeting.participants.map((person) => person.name),
    ].filter(Boolean));

    if (allowedNames.size === 0) {
      return Response.json({
        assignments: parsed.data.segments.map((segment) => ({
          id: segment.id,
          speakerName: null,
          confidence: 0,
          reason: "Chưa có danh sách tên để đối chiếu.",
        })),
      });
    }

    const client = new OpenAI({ apiKey, maxRetries: 2, timeout: 45_000 });
    const response = await client.responses.parse({
      model: process.env.OPENAI_SUMMARY_MODEL?.trim() || "gpt-5-mini",
      store: false,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(parsed.data) },
      ],
      text: { format: zodTextFormat(AssignmentSchema, "speaker_assignments") },
    });

    if (!response.output_parsed) {
      throw new Error("Không có kết quả gán người nói.");
    }

    const output = AssignmentSchema.parse(response.output_parsed) as {
      assignments: Array<{
        id: string;
        speakerName: string | null;
        confidence: number;
        reason: string;
      }>;
    };
    const byId = new Map<string, (typeof output.assignments)[number]>(
      output.assignments.map((item) => [item.id, item]),
    );
    const validated = parsed.data.segments.map((segment) => {
      const item = byId.get(segment.id);
      const validName = item?.speakerName && allowedNames.has(item.speakerName)
        ? item.speakerName
        : null;
      return {
        segment,
        validName,
        confidence: item?.confidence ?? 0,
        reason: item?.reason || "Chưa đủ căn cứ.",
      };
    });

    const labelCandidates = new Map<
      string,
      Array<{ name: string; confidence: number; reason: string }>
    >();
    for (const item of validated) {
      const label = item.segment.speakerLabel;
      if (!label || !item.validName || item.confidence < 0.75) continue;
      const candidates = labelCandidates.get(label) ?? [];
      candidates.push({ name: item.validName, confidence: item.confidence, reason: item.reason });
      labelCandidates.set(label, candidates);
    }

    const resolvedLabels = new Map<
      string,
      { name: string; confidence: number; reason: string } | null
    >();
    for (const [label, candidates] of labelCandidates) {
      const uniqueNames = new Set(candidates.map((candidate) => candidate.name));
      if (uniqueNames.size !== 1) {
        resolvedLabels.set(label, null);
        continue;
      }
      const strongest = candidates.reduce((best, candidate) =>
        candidate.confidence > best.confidence ? candidate : best,
      );
      resolvedLabels.set(label, strongest);
    }

    return Response.json({
      assignments: validated.map((item) => {
        const labelResolution = item.segment.speakerLabel
          ? resolvedLabels.get(item.segment.speakerLabel)
          : undefined;
        if (item.validName && item.confidence >= 0.65) {
          return {
            id: item.segment.id,
            speakerName: item.validName,
            confidence: item.confidence,
            reason: item.reason,
          };
        }
        if (labelResolution) {
          return {
            id: item.segment.id,
            speakerName: labelResolution.name,
            confidence: Math.min(0.82, labelResolution.confidence),
            reason: `Cùng nhãn người nói ${item.segment.speakerLabel} với một đoạn có căn cứ rõ.`,
          };
        }
        return {
          id: item.segment.id,
          speakerName: null,
          confidence: item.confidence,
          reason:
            item.segment.speakerLabel && resolvedLabels.get(item.segment.speakerLabel) === null
              ? "Có bằng chứng mâu thuẫn cho cùng nhãn người nói."
              : item.reason,
        };
      }),
    });
  } catch (error) {
    const guarded = guardErrorResponse(error);
    if (guarded) return guarded;
    console.error("Speaker attribution error", error);
    return Response.json({ error: "Không thể đối chiếu tên người nói." }, { status: 502 });
  }
}
