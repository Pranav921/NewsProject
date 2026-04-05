import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleEnv } from "@/lib/supabase/env";

export function createSupabaseAdminClient() {
  const { supabaseServiceRoleKey, supabaseUrl } = getSupabaseServiceRoleEnv();

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
