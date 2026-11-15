import "server-only";
import { getNewsSnapshot } from "../rss.ts";
import { createAskSnapshot, createAskTools } from "./ask-retrieval.ts";
import { AskRetrievalError } from "./ask.ts";

// Opt-in internal loader, not a Server Action or public endpoint. The existing
// RSS per-feed cache owns freshness and concurrent fetch sharing; no forced refresh.
// All subsequent tool calls use this one immutable snapshot with no more I/O.
export async function loadAskTools(now?: Date) {
  try {
    const { articles, feedStatus } = await getNewsSnapshot();
    const snapshot = createAskSnapshot(articles, now ?? new Date(), feedStatus);
    return { snapshot, tools: createAskTools(snapshot) };
  } catch (error) {
    if (error instanceof AskRetrievalError) throw error;
    throw new AskRetrievalError("snapshot-unavailable");
  }
}
