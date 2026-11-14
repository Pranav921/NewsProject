export function shouldRefreshSession(pathname: string, cookieNames: string[]) {
  // API handlers authenticate independently; polling/public assets need no auth
  // round trip. A cookie's presence only triggers verification, never grants access.
  return !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")
    && pathname !== "/monitoring"
    && cookieNames.some((name) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}
