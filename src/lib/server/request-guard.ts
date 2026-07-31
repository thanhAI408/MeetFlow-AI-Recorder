export class RequestGuardError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestGuardError";
  }
}

interface GuardOptions {
  id: string;
  maxRequests: number;
  windowMs?: number;
  maxContentLength?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientId(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "local";
}

export function guardRequest(request: Request, options: GuardOptions): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new RequestGuardError(403, "CROSS_ORIGIN_REQUEST", "Yêu cầu không cùng nguồn.");
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    options.maxContentLength &&
    Number.isFinite(contentLength) &&
    contentLength > options.maxContentLength
  ) {
    throw new RequestGuardError(413, "REQUEST_TOO_LARGE", "Dữ liệu gửi lên quá lớn.");
  }

  const now = Date.now();
  const key = `${options.id}:${clientId(request)}`;
  const existing = buckets.get(key);
  const windowMs = options.windowMs ?? 60_000;
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > options.maxRequests) {
    throw new RequestGuardError(429, "RATE_LIMITED", "Có quá nhiều yêu cầu. Hãy thử lại sau ít phút.");
  }

  if (buckets.size > 2_000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }
}

export function guardErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RequestGuardError)) return null;
  return Response.json(
    { error: error.message, code: error.code },
    { status: error.status },
  );
}
