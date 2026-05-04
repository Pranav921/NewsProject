import { logApiError, logApiInfo } from "@/lib/api-logging";
import { enforceRateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type SignupRequestBody = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request, "auth-signup");

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = (await request.json()) as SignupRequestBody;
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Enter an email and password." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      logApiError("[auth][signup][error]", error, { email });
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    const confirmationRequired = Boolean(data.user && !data.session);

    logApiInfo("[auth][signup]", {
      confirmationRequired,
      email,
      userId: data.user?.id ?? null,
    });

    return NextResponse.json({
      confirmationRequired,
      message: confirmationRequired
        ? "Sign-up successful. Check your email to confirm your account."
        : "Sign-up successful.",
    });
  } catch (error) {
    logApiError("[auth][signup][unexpected]", error);
    return NextResponse.json(
      { error: "Unable to sign up right now." },
      { status: 400 },
    );
  }
}
