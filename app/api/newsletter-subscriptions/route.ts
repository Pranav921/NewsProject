import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type NewsletterSubscriptionRequest = {
  customFrequency?: string;
  email?: string;
  frequency?: string;
  preferredFrequency?: string;
};

const VALID_FREQUENCIES = new Set(["hourly", "daily", "weekly", "custom"]);

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id || !user.email) {
      return NextResponse.json(
        { message: "You must be logged in to manage newsletter settings." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as NewsletterSubscriptionRequest;
    const frequency =
      body.frequency?.trim().toLowerCase() ??
      body.preferredFrequency?.trim().toLowerCase() ??
      "";
    const customFrequency = body.customFrequency?.trim() ?? null;

    if (!VALID_FREQUENCIES.has(frequency)) {
      return NextResponse.json(
        { message: "Choose a valid newsletter frequency." },
        { status: 400 },
      );
    }

    if (frequency === "custom" && !customFrequency) {
      return NextResponse.json(
        { message: "Enter a custom newsletter frequency." },
        { status: 400 },
      );
    }

    const { error } = await supabase.from("newsletter_subscriptions").insert({
      custom_frequency: frequency === "custom" ? customFrequency : null,
      email: user.email.toLowerCase(),
      frequency,
      is_active: true,
      user_id: user.id,
    });

    if (error?.code === "23505") {
      return NextResponse.json(
        { message: "This account is already subscribed." },
        { status: 409 },
      );
    }

    if (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[newsletter-subscriptions][POST]", error);
      }

      return NextResponse.json(
        {
          message:
            error.message ||
            "Unable to save your newsletter sign-up right now.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: "You are on the list. Newsletter sending can be added later.",
    });
  } catch {
    return NextResponse.json(
      { message: "Unable to process this request." },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      return NextResponse.json(
        { message: "You must be logged in to manage newsletter settings." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as NewsletterSubscriptionRequest;
    const frequency =
      body.frequency?.trim().toLowerCase() ??
      body.preferredFrequency?.trim().toLowerCase() ??
      "";
    const customFrequency = body.customFrequency?.trim() ?? null;

    if (!VALID_FREQUENCIES.has(frequency)) {
      return NextResponse.json(
        { message: "Choose a valid newsletter frequency." },
        { status: 400 },
      );
    }

    if (frequency === "custom" && !customFrequency) {
      return NextResponse.json(
        { message: "Enter a custom newsletter frequency." },
        { status: 400 },
      );
    }

    const { error } = await supabase.from("newsletter_subscriptions").upsert(
      {
        custom_frequency: frequency === "custom" ? customFrequency : null,
        email: user.email.toLowerCase(),
        frequency,
        is_active: true,
        user_id: user.id,
      },
      {
        onConflict: "user_id,email",
      },
    );

    if (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[newsletter-subscriptions][PUT]", error);
      }

      return NextResponse.json(
        {
          message:
            error.message ||
            "Unable to update newsletter settings right now.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: "Newsletter settings updated.",
    });
  } catch {
    return NextResponse.json(
      { message: "Unable to process this request." },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      return NextResponse.json(
        { message: "You must be logged in to manage newsletter settings." },
        { status: 401 },
      );
    }

    const { error } = await supabase
      .from("newsletter_subscriptions")
      .update({
        custom_frequency: null,
        is_active: false,
      })
      .eq("user_id", user.id)
      .eq("email", user.email.toLowerCase());

    if (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[newsletter-subscriptions][DELETE]", error);
      }

      return NextResponse.json(
        {
          message: error.message || "Unable to unsubscribe right now.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: "You have been unsubscribed from newsletter emails.",
    });
  } catch {
    return NextResponse.json(
      { message: "Unable to process this request." },
      { status: 400 },
    );
  }
}
