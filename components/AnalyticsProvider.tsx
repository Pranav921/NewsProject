"use client";

import { trackPageView } from "@/lib/analytics";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function AnalyticsProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const search = searchParams?.toString();
    const path = search ? `${pathname}?${search}` : pathname;

    trackPageView(path);
  }, [pathname, searchParams]);

  return null;
}
