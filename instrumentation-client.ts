// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sentryPrivacyOptions } from "./lib/sentry";

const isProduction = process.env.NODE_ENV === "production";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: isProduction ? 0.1 : 1,
  // Replay is absent: future Ask questions/answers must not enter DOM recordings.
  ...sentryPrivacyOptions,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
