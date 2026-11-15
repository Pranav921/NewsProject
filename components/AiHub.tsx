"use client";

import { AiNewsBriefing } from "@/components/AiNewsBriefing";
import { AskKicker } from "@/components/AskKicker";

// One centered reading column: Ask Kicker is the primary interaction, the briefing
// sits below it. Each component still enforces its own server-side AI switch.
export function AiHub({ askKickerEnabled, briefingEnabled }: { askKickerEnabled: boolean; briefingEnabled: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-2 pt-4 sm:space-y-5 sm:pt-6">
      {askKickerEnabled && <AskKicker />}
      {briefingEnabled && <AiNewsBriefing />}
    </div>
  );
}
