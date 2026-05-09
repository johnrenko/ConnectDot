import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.CONNECTDOT_API_URL ?? "http://127.0.0.1:8000/vectorize";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  try {
    const response = await fetch(API_URL, { method: "POST", body: form });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
    });
  } catch {
    return NextResponse.json({ detail: "Vectorization service is unavailable." }, { status: 503 });
  }
}
