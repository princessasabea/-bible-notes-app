import { NextResponse } from "next/server";

export async function POST(): Promise<Response> {
  return NextResponse.json({
    status: "disabled",
    message: "On-demand OpenAI chapter generation is intentionally disabled. Generate narration offline, upload it to Firebase Storage, and stream the prepared chapter audio."
  }, { status: 403 });
}
