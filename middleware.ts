import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { consumeRateLimit } from "@/lib/rate-limit";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  if (pathname.startsWith("/api/auth") && request.method === "POST") {
    const limited = consumeRateLimit(`auth:ip:${ip}`, 10, 60_000);
    if (!limited) {
      return NextResponse.json({ error: "Too many auth attempts" }, { status: 429 });
    }

    const email = request.nextUrl.searchParams.get("email");
    if (email) {
      const emailLimited = consumeRateLimit(`auth:email:${email}`, 5, 60_000);
      if (!emailLimited) {
        return NextResponse.json({ error: "Too many email attempts" }, { status: 429 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/auth/:path*"]
};
