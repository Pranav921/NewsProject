import type { UserPreferences } from "@/lib/types";

export const DEFAULT_SOURCE_FILTER = "All Sources";
export const DEFAULT_TIME_FILTER = "all";
export const DEFAULT_VIEW_MODE = "standard";

export function getDefaultUserPreferences(): UserPreferences {
  return {
    defaultSourceFilter: DEFAULT_SOURCE_FILTER,
    defaultTimeFilter: DEFAULT_TIME_FILTER,
    defaultViewMode: DEFAULT_VIEW_MODE,
  };
}

export function normalizeUserPreferences(
  preferences: Partial<UserPreferences> | null | undefined,
): UserPreferences {
  const defaults = getDefaultUserPreferences();

  return {
    defaultSourceFilter:
      preferences?.defaultSourceFilter ?? defaults.defaultSourceFilter,
    defaultTimeFilter: preferences?.defaultTimeFilter ?? defaults.defaultTimeFilter,
    defaultViewMode: preferences?.defaultViewMode ?? defaults.defaultViewMode,
  };
}
