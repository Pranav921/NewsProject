import {
  getValidatedNewsletterSettings,
  type NewsletterSubscriptionRequest,
} from "@/lib/newsletter-subscription-settings";
import { logApiError, logApiInfo } from "@/lib/api-logging";
import { enforceRateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request, "newsletter-subscribe");

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = (await request.json()) as NewsletterSubscriptionRequest;
    const validatedSettings = getValidatedNewsletterSettings(body);

    if ("errorMessage" in validatedSettings) {
      return NextResponse.json(
        { error: validatedSettings.errorMessage },
        { status: validatedSettings.status },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id || !user.email) {
      return NextResponse.json(
        { error: "You must be logged in to manage newsletter settings." },
        { status: 401 },
      );
    }

    const normalizedEmail = user.email.toLowerCase();
    const { data: existingSubscription, error: lookupError } = await supabase
      .from("newsletter_subscriptions")
      .select("id, is_active")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (lookupError) {
      logApiError("[newsletter][subscribe][lookup]", lookupError, {
        userId: user.id,
      });

      return NextResponse.json(
        { error: lookupError.message || "Unable to load newsletter settings right now." },
        { status: 500 },
      );
    }

    if (existingSubscription?.is_active) {
      return NextResponse.json(
        { error: "This account is already subscribed." },
        { status: 409 },
      );
    }

    if (existingSubscription) {
      const { error: reactivateError } = await supabase
        .from("newsletter_subscriptions")
        .update({
          article_mode: validatedSettings.articleMode,
          custom_frequency: validatedSettings.customFrequency,
          email_format: validatedSettings.emailFormat,
          frequency: validatedSettings.frequency,
          is_active: true,
          updated_at: new Date().toISOString(),
          user_id: user.id,
        })
        .eq("id", existingSubscription.id);

      if (reactivateError) {
        logApiError("[newsletter][subscribe][reactivate]", reactivateError, {
          userId: user.id,
        });

        return NextResponse.json(
          { error: reactivateError.message || "Unable to restore your newsletter subscription right now." },
          { status: 500 },
        );
      }

      logApiInfo("[newsletter][subscribe]", {
        action: "reactivate",
        userId: user.id,
      });

      return NextResponse.json({
        message: "You have been resubscribed.",
      });
    }

    const { error: insertError } = await supabase
      .from("newsletter_subscriptions")
      .insert({
        article_mode: validatedSettings.articleMode,
        custom_frequency: validatedSettings.customFrequency,
        email: normalizedEmail,
        email_format: validatedSettings.emailFormat,
        frequency: validatedSettings.frequency,
        is_active: true,
        user_id: user.id,
      });

    if (insertError) {
      logApiError("[newsletter][subscribe][insert]", insertError, {
        userId: user.id,
      });

      return NextResponse.json(
        { error: insertError.message || "Unable to save your newsletter sign-up right now." },
        { status: 500 },
      );
    }

    logApiInfo("[newsletter][subscribe]", {
      action: "insert",
      userId: user.id,
    });

    return NextResponse.json({
      message: "You are on the list. Newsletter sending can be added later.",
    });
  } catch (error) {
    logApiError("[newsletter][subscribe][unexpected]", error);
    return NextResponse.json(
      { error: "Unable to process this request." },
      { status: 400 },
    );
  }
}
