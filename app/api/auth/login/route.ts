import { logApiError, logApiInfo } from "@/lib/api-logging";
import { enforceRateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type LoginRequestBody = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request, "auth-login");

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = (await request.json()) as LoginRequestBody;
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Enter an email and password." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      logApiError("[auth][login][error]", error, { email });
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    logApiInfo("[auth][login]", {
      email,
      userId: data.user?.id ?? null,
    });

    return NextResponse.json({
      message: "Login successful.",
    });
  } catch (error) {
    logApiError("[auth][login][unexpected]", error);
    return NextResponse.json(
      { error: "Unable to log in right now." },
      { status: 400 },
    );
  }
}
