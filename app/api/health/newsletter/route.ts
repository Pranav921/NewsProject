import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      appBaseUrlConfigured: Boolean(process.env.APP_BASE_URL?.trim()),
      ok: true,
      resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
