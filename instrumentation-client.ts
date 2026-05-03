// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isProduction = process.env.NODE_ENV === "production";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  integrations: [Sentry.replayIntegration()],
  tracesSampleRate: isProduction ? 0.1 : 1,
  enableLogs: !isProduction,
  replaysSessionSampleRate: isProduction ? 0 : 0.1,
  replaysOnErrorSampleRate: isProduction ? 0.1 : 1,
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
