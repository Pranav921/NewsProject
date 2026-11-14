import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { shouldRefreshSession } from "./session-policy";
import { createSupabaseFetch } from "./fetch";

export function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });
  if (!shouldRefreshSession(request.nextUrl.pathname, request.cookies.getAll().map((cookie) => cookie.name))) return Promise.resolve(response);
  const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: createSupabaseFetch() },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Verified claims still refresh expired tokens and propagate cookies. With
  // asymmetric signing keys, verification can use cached JWKS instead of /user.
  return supabase.auth.getClaims().then(() => response);
}
