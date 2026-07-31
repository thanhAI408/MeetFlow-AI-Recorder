import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { guardErrorResponse, guardRequest } from "@/lib/server/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SummarySchema = z.object({
  overview: z.string(),
  decisions: z.array(
    z.object({
      text: z.string(),
      evidence: z.string(),
    }),
  ),
  actionItems: z.array(
    z.object({
      task: z.string(),
      owner: z.string().nullable(),
      deadline: z.string().nullable(),
    }),
  ),
  openQuestions: z.array(z.string()),
});

const RequestSchema = z.object({
  previousSummary: SummarySchema.optional(),
  newTranscript: z.string().min(1).max(100_000),
  meeting: z.object({
    recorderName: z.string().max(100),
    recorderRole: z.string().max(300),
    topic: z.string().max(500),
    participantCount: z.number().int().min(1).max(100),
    participants: z.array(z.object({ name: z.string(), role: z.string() })).max(30),
    additionalContext: z.string().max(2_000),
  }),
});

const SYSTEM_PROMPT = `Bạn là thư ký cuộc họp thận trọng của MeetFlow AI.
Hợp nhất previousSummary với newTranscript thành biên bản hiện tại bằng tiếng Việt.

Quy tắc bắt buộc:
- Chỉ dùng dữ liệu cuộc họp được cung cấp; không bịa.
- Tên người nói trong transcript có thể là dự đoán. Không biến dự đoán chưa chắc thành sự thật mới.
- Chỉ ghi quyết định khi có lời chốt/xác nhận rõ; mỗi quyết định phải có evidence ngắn.
- Đề xuất, câu hỏi và ý tưởng chưa chốt không phải quyết định.
- Chỉ điền owner/deadline khi transcript nói rõ. Nếu mơ hồ dùng null.
- Khi thông tin mới thay đổi nội dung cũ, giữ trạng thái mới nhất và loại bản trùng.
- Đưa điều chưa rõ vào openQuestions.
- Giữ nguyên tên riêng và thuật ngữ kỹ thuật Việt-Anh.
- Trả về đúng schema được cung cấp.`;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "Server chưa cấu hình OPENAI_API_KEY." }, { status: 503 });
  }

  try {
    guardRequest(request, {
      id: "summary",
      maxRequests: 15,
      maxContentLength: 512 * 1024,
    });
    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Transcript hoặc bối cảnh cuộc họp không hợp lệ." }, { status: 422 });
    }

    const client = new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000 });
    const response = await client.responses.parse({
      model: process.env.OPENAI_SUMMARY_MODEL?.trim() || "gpt-5-mini",
      store: false,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(parsed.data) },
      ],
      text: {
        format: zodTextFormat(SummarySchema, "meeting_summary"),
      },
    });

    if (!response.output_parsed) {
      return Response.json({ error: "AI chưa tạo được tóm tắt có cấu trúc." }, { status: 502 });
    }
    return Response.json(SummarySchema.parse(response.output_parsed));
  } catch (error) {
    const guarded = guardErrorResponse(error);
    if (guarded) return guarded;
    console.error("Summary error", error);
    return Response.json({ error: "Không thể cập nhật tóm tắt. Hãy thử lại." }, { status: 502 });
  }
}
