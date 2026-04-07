import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type NewsletterSubscriptionRequest = {
  customFrequency?: string;
  email?: string;
  frequency?: string;
  preferredFrequency?: string;
};

const VALID_FREQUENCIES = new Set(["hourly", "daily", "weekly", "custom"]);

function getValidatedNewsletterSettings(
  body: NewsletterSubscriptionRequest,
) {
  const frequency =
    body.frequency?.trim().toLowerCase() ??
    body.preferredFrequency?.trim().toLowerCase() ??
    "";
  const normalizedCustomFrequency = body.customFrequency?.trim() ?? "";

  if (!VALID_FREQUENCIES.has(frequency)) {
    return {
      errorMessage: "Choose a valid newsletter frequency.",
      status: 400,
    };
  }

  if (frequency !== "custom") {
    return {
      customFrequency: null,
      frequency,
      status: 200,
    };
  }

  if (!/^[1-9]\d*$/.test(normalizedCustomFrequency)) {
    return {
      errorMessage: "Enter a whole number of hours greater than 0.",
      status: 400,
    };
  }

  return {
    customFrequency: normalizedCustomFrequency,
    frequency,
    status: 200,
  };
}

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
    const validatedSettings = getValidatedNewsletterSettings(body);

    if ("errorMessage" in validatedSettings) {
      return NextResponse.json(
        { message: validatedSettings.errorMessage },
        { status: validatedSettings.status },
      );
    }

    return await upsertNewsletterSubscription({
      actionLabel: "POST",
      customFrequency: validatedSettings.customFrequency,
      frequency: validatedSettings.frequency,
      successMessage: "You are on the list. Newsletter sending can be added later.",
      supabase,
      userEmail: user.email,
      userId: user.id,
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
    const validatedSettings = getValidatedNewsletterSettings(body);

    if ("errorMessage" in validatedSettings) {
      return NextResponse.json(
        { message: validatedSettings.errorMessage },
        { status: validatedSettings.status },
      );
    }

    return await upsertNewsletterSubscription({
      actionLabel: "PUT",
      customFrequency: validatedSettings.customFrequency,
      frequency: validatedSettings.frequency,
      successMessage: "Newsletter settings updated.",
      supabase,
      userEmail: user.email,
      userId: user.id,
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

async function upsertNewsletterSubscription({
  actionLabel,
  customFrequency,
  frequency,
  successMessage,
  supabase,
  userEmail,
  userId,
}: {
  actionLabel: "POST" | "PUT";
  customFrequency: string | null;
  frequency: string;
  successMessage: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userEmail: string;
  userId: string;
}) {
  const normalizedEmail = userEmail.toLowerCase();
  const { data: existingSubscription, error: lookupError } = await supabase
    .from("newsletter_subscriptions")
    .select("id, is_active")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (lookupError) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[newsletter-subscriptions][${actionLabel}][LOOKUP]`, lookupError);
    }

    return NextResponse.json(
      {
        message:
          lookupError.message ||
          "Unable to load your newsletter subscription right now.",
      },
      { status: 500 },
    );
  }

  if (existingSubscription?.is_active) {
    if (actionLabel === "PUT") {
      const { error: updateError } = await supabase
        .from("newsletter_subscriptions")
        .update({
          custom_frequency: customFrequency,
          frequency,
          is_active: true,
          updated_at: new Date().toISOString(),
          user_id: userId,
        })
        .eq("id", existingSubscription.id);

      if (updateError) {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[newsletter-subscriptions][${actionLabel}][UPDATE]`,
            updateError,
          );
        }

        return NextResponse.json(
          {
            message:
              updateError.message ||
              "Unable to update newsletter settings right now.",
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        message: successMessage,
      });
    }

    return NextResponse.json(
      { message: "This account is already subscribed." },
      { status: 409 },
    );
  }

  if (existingSubscription) {
    const { error: reactivateError } = await supabase
      .from("newsletter_subscriptions")
      .update({
        custom_frequency: customFrequency,
        frequency,
        is_active: true,
        updated_at: new Date().toISOString(),
        user_id: userId,
      })
      .eq("id", existingSubscription.id);

    if (reactivateError) {
      if (process.env.NODE_ENV !== "production") {
        console.error(
          `[newsletter-subscriptions][${actionLabel}][REACTIVATE]`,
          reactivateError,
        );
      }

      return NextResponse.json(
        {
          message:
            reactivateError.message ||
            "Unable to restore your newsletter subscription right now.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: actionLabel === "POST" ? "You have been resubscribed." : successMessage,
    });
  }

  const { error: insertError } = await supabase.from("newsletter_subscriptions").insert({
    custom_frequency: customFrequency,
    email: normalizedEmail,
    frequency,
    is_active: true,
    user_id: userId,
  });

  if (insertError) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[newsletter-subscriptions][${actionLabel}][INSERT]`, insertError);
    }

    return NextResponse.json(
      {
        message:
          insertError.message ||
          "Unable to save your newsletter sign-up right now.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: successMessage,
  });
}
