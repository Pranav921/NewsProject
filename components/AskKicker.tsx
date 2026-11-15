"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ASK_UI_LIMITS, buildAskBody, coverageNotes, coverageWindowLabel, describeAskFailure, indexAskSources,
  normalizeQuestionInput, parseAskResponse, questionProblem,
  type AskCoverage, type AskFailure, type AskSource, type AskSuccess,
} from "@/lib/ai/ask-ui";

// A few varied starting points; shown only before the first question.
const EXAMPLES = [
  "What's the latest on AI?",
  "How are publishers covering Nvidia?",
  "Summarize today's economy news",
];

type View =
  | { phase: "idle" }
  | { phase: "loading"; question: string }
  | { phase: "answer"; question: string; result: AskSuccess; reused: boolean }
  | { phase: "error"; question: string; failure: AskFailure };

const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
// Shared button label typography (applied to inner spans; utilities on the buttons work too).
const label = "text-sm font-semibold";
const secondaryButton = `min-h-11 rounded-xl border border-border-strong bg-surface px-4 text-accent hover:bg-background ${focusRing}`;

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={path} />
    </svg>
  );
}
const ICONS = {
  spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  alert: "M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z",
  chevron: "M6 9l6 6 6-6",
};

export function AskKicker() {
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [input, setInput] = useState("");
  const [view, setView] = useState<View>({ phase: "idle" });
  const [last, setLast] = useState<{ question: string; result: AskSuccess } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(0);

  const loading = view.phase === "loading";
  const secondsLeft = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const blocked = secondsLeft > 0;
  const empty = !normalizeQuestionInput(input);
  const unavailable = loading || blocked || empty;

  // Abort an in-flight request if the dashboard unmounts; never keep work alive.
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) { clearInterval(timer); setAnnouncement("You can ask Ask Kicker a question again."); }
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  function fail(question: string, failure: AskFailure) {
    setView({ phase: "error", question, failure });
    const wait = failure.canRetry ? failure.retryAfterSeconds : null;
    if (wait && wait <= ASK_UI_LIMITS.blockRetryUpToSeconds) { setNow(Date.now()); setRetryAt(Date.now() + wait * 1000); }
  }

  async function ask(rawQuestion: string) {
    if (inFlight.current || blocked) return;
    const question = normalizeQuestionInput(rawQuestion);
    const problem = questionProblem(question);
    if (problem) { setHint(problem); setAnnouncement(problem); return; }
    setHint(null);
    // The server would return the same private cached answer; reuse it locally
    // instead of spending one of the user's rate-limited requests.
    if (last && last.question === question && Date.parse(last.result.expiresAt) > Date.now()) {
      setView({ phase: "answer", question, result: last.result, reused: true });
      setAnnouncement(`Showing your answer from ${timeOnly(last.result.generatedAt)}. No new request was needed.`);
      return;
    }
    inFlight.current = true;
    setView({ phase: "loading", question });
    setAnnouncement("Asking Kicker. Searching available coverage and checking citations.");
    const request = new AbortController();
    controller.current = request;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; request.abort(); }, ASK_UI_LIMITS.clientTimeoutMs);
    try {
      // Only the question is sent. Identity comes from the session cookie on the
      // server; tools, article IDs and models are never chosen by the browser.
      const response = await fetch("/api/ai/ask", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: buildAskBody(question), signal: request.signal,
      });
      let payload: unknown = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) {
        const code = payload && typeof payload === "object" && typeof (payload as { code?: unknown }).code === "string"
          ? (payload as { code: string }).code : null;
        const failure = describeAskFailure({ status: response.status, code, retryAfter: Number(response.headers.get("Retry-After")) }, Date.now());
        fail(question, failure);
        setAnnouncement(`${failure.title}. ${failure.message}`);
        return;
      }
      const result = parseAskResponse(payload);
      if (!result) {
        const failure = { ...describeAskFailure({ status: 503 }, Date.now()), message: "Ask Kicker sent an unexpected response. Please try again." };
        fail(question, failure);
        setAnnouncement(`${failure.title}. ${failure.message}`);
        return;
      }
      setLast({ question, result });
      setView({ phase: "answer", question, result, reused: false });
      setAnnouncement(describeResult(result));
    } catch {
      if (request.signal.aborted && !timedOut) return; // unmounted
      const failure = describeAskFailure({ status: 0, network: timedOut ? "timeout" : "offline" }, Date.now());
      fail(question, failure);
      setAnnouncement(`${failure.title}. ${failure.message}`);
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      if (controller.current === request) controller.current = null;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(input);
  }

  function chooseExample(example: string) {
    setInput(example);
    setHint(null);
    inputRef.current?.focus();
  }

  function editQuestion() {
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  function startOver() {
    setInput("");
    setView({ phase: "idle" });
    setHint(null);
    inputRef.current?.focus();
  }

  const length = input.length;
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_24px_rgba(26,24,20,0.04)] sm:p-7" aria-labelledby={`${ids}-title`}>
      <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-accent">
        <Icon path={ICONS.spark} className="h-3.5 w-3.5" />AI-generated · Cited answers
      </p>
      <h2 id={`${ids}-title`} className="text-[22px] font-semibold leading-tight tracking-tight text-navy sm:text-2xl">Ask Kicker AI</h2>
      <p id={`${ids}-description`} className="mt-1.5 max-w-prose text-sm leading-relaxed text-text-sub">
        Ask about recent news. Ask Kicker answers using the headlines and short summaries from available news
        article metadata in Kicker&rsquo;s RSS feeds, and cites a publisher for every statement. It doesn&rsquo;t read full articles.
      </p>

      <form className="mt-5" onSubmit={onSubmit} aria-label="Ask Kicker AI a question" noValidate>
        <label htmlFor={`${ids}-question`} className="sr-only">Your question for Ask Kicker AI</label>
        {/* One prominent field; the focus ring is drawn on the whole group. */}
        <div className={`flex items-center gap-1.5 rounded-2xl border bg-background p-1.5 transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(173,0,104,0.14)] ${hint ? "border-breaking/60" : "border-border-strong"}`}>
          <Icon path={ICONS.search} className="ml-2 hidden h-5 w-5 shrink-0 text-text-muted sm:block" />
          <input
            ref={inputRef} id={`${ids}-question`} name="question" type="text" value={input}
            onChange={(event) => { setInput(event.target.value); if (hint) setHint(null); }}
            maxLength={ASK_UI_LIMITS.questionCharacters} autoComplete="off" enterKeyHint="send" spellCheck
            placeholder="Ask about today's news…"
            aria-describedby={`${ids}-description ${ids}-hint`} aria-invalid={hint ? true : undefined}
            // Deliberately no text-size class: it inherits 16px, and iOS Safari
            // zooms the page when focusing inputs smaller than 16px.
            className="min-h-12 min-w-0 flex-1 rounded-xl bg-transparent px-2.5 text-foreground outline-none placeholder:text-text-muted"
          />
          <button
            type="submit" aria-disabled={unavailable}
            onClick={(event) => { if (unavailable) { event.preventDefault(); if (empty && !loading) { setHint("Type a question first."); } } }}
            className={`editorial-primary-button inline-flex min-h-12 min-w-24 shrink-0 items-center justify-center gap-1.5 px-4 sm:px-5 ${focusRing} aria-disabled:cursor-not-allowed aria-disabled:opacity-55`}
          >
            {loading ? (
              <><span aria-hidden="true" className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white motion-safe:animate-spin" /><span className={label}>Asking…</span></>
            ) : blocked ? <span className={label}>Wait {secondsLeft}s</span> : <><span className={label}>Ask</span><Icon path={ICONS.arrow} className="h-4 w-4" /></>}
          </button>
        </div>
        <div id={`${ids}-hint`} className="mt-2 flex min-h-4 items-start justify-between gap-3 px-1 text-xs leading-4 text-text-sub">
          <span className={hint ? "font-medium text-breaking" : undefined}>{hint ?? "One standalone question at a time. Answers are saved privately for a few minutes."}</span>
          {length > ASK_UI_LIMITS.questionCharacters - 100 && <span aria-hidden="true" className="shrink-0 font-mono">{length}/{ASK_UI_LIMITS.questionCharacters}</span>}
        </div>
      </form>

      {view.phase === "idle" && (
        <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span id={`${ids}-examples`} className="text-xs font-medium text-text-sub">Try asking</span>
          <ul className="flex min-w-0 flex-wrap gap-2" aria-labelledby={`${ids}-examples`}>
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button type="button" onClick={() => chooseExample(example)}
                  className={`min-h-10 rounded-full border border-border bg-surface px-3.5 text-text-sub transition-colors hover:border-accent/40 hover:text-accent ${focusRing}`}>
                  <span className="text-[13px]">{example}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>

      <div aria-busy={loading} data-ask-state={view.phase === "answer" ? view.result.answer.status : view.phase}>
        {view.phase === "loading" && <LoadingState question={view.question} />}
        {view.phase === "error" && (
          <ErrorState question={view.question} failure={view.failure} blocked={blocked}
            onRetry={() => void ask(view.question)} onEdit={editQuestion} />
        )}
        {view.phase === "answer" && (
          <AnswerView question={view.question} result={view.result} reused={view.reused}
            onEdit={editQuestion} onStartOver={startOver} headingId={`${ids}-answer`} />
        )}
      </div>
    </section>
  );
}

function describeResult({ answer, cacheHit }: AskSuccess) {
  const saved = cacheHit ? " This is a saved answer; no new AI request was made." : "";
  if (answer.status === "answered") {
    const citations = answer.statements.reduce((total, statement) => total + statement.citations.length, 0);
    return `Answer ready with ${answer.statements.length} statement${answer.statements.length === 1 ? "" : "s"} and ${citations} citation${citations === 1 ? "" : "s"}.${saved}`;
  }
  if (answer.status === "no_results") return `No matching coverage found in the available articles.${saved}`;
  if (answer.status === "needs_clarification") return `Ask Kicker needs more detail: ${answer.clarification ?? "please rephrase your question."}${saved}`;
  return `This question is outside what Ask Kicker can answer.${saved}`;
}

function Asked({ question }: { question: string }) {
  return (
    <p className="wrap-break-word text-sm leading-relaxed text-text-sub">
      <span className="font-medium">You asked:</span> <q className="text-foreground">{question}</q>
    </p>
  );
}

function LoadingState({ question }: { question: string }) {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <Asked question={question} />
      <p className="mt-3 text-sm text-text-sub">Searching available coverage and checking citations. This can take up to 30 seconds.</p>
      <div aria-hidden="true" className="mt-4 space-y-2.5">
        {["w-11/12", "w-9/12", "w-10/12"].map((width) => (
          <div key={width} className={`h-3 rounded-full bg-border motion-safe:animate-pulse ${width}`} />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ question, failure, blocked, onRetry, onEdit }: {
  question: string; failure: AskFailure; blocked: boolean; onRetry: () => void; onEdit: () => void;
}) {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <Asked question={question} />
      <div role="alert" data-ask-failure={failure.kind}
        className="mt-3 flex gap-2.5 rounded-xl border border-breaking/25 bg-breaking/4 p-3.5 text-sm">
        <Icon path={ICONS.alert} className="mt-0.5 h-4 w-4 shrink-0 text-breaking" />
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{failure.title}</p>
          <p className="mt-0.5 leading-relaxed text-text-sub">{failure.message}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {failure.canRetry && (
          <button type="button" onClick={onRetry} aria-disabled={blocked}
            className={`${secondaryButton} aria-disabled:cursor-not-allowed aria-disabled:opacity-55`}>
            <span className={label}>Try again</span>
          </button>
        )}
        {failure.kind === "invalid" && (
          <button type="button" onClick={onEdit} className={secondaryButton}><span className={label}>Edit your question</span></button>
        )}
      </div>
    </div>
  );
}

const STATUS_LABELS = {
  answered: { label: "Answer", tone: "bg-accent/10 text-accent" },
  no_results: { label: "No matching coverage", tone: "bg-background text-text-sub border border-border" },
  needs_clarification: { label: "Needs more detail", tone: "bg-navy/7 text-navy" },
  unsupported: { label: "Outside Ask Kicker's scope", tone: "bg-background text-text-sub border border-border" },
} as const;

function AnswerView({ question, result, reused, onEdit, onStartOver, headingId }: {
  question: string; result: AskSuccess; reused: boolean; onEdit: () => void; onStartOver: () => void; headingId: string;
}) {
  const { answer, generatedAt, cacheHit } = result;
  const status = STATUS_LABELS[answer.status];
  const { sources, markers } = indexAskSources(answer.statements);
  const showsCoverage = answer.status === "answered" || answer.status === "no_results";
  const notes = showsCoverage ? coverageNotes(answer.coverage) : [];
  return (
    <article className="mt-6 border-t border-border pt-5" aria-labelledby={headingId}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-sub">You asked</p>
      <h3 id={headingId} className="mt-1 wrap-break-word text-lg font-semibold leading-snug tracking-tight text-navy sm:text-xl">{question}</h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-sub">
          {answer.status !== "answered" && <span className={`rounded-full px-2 py-0.5 font-semibold ${status.tone}`}>{status.label}</span>}
          <span>Generated <time dateTime={generatedAt}>{timeOnly(generatedAt)}</time></span>
          <span aria-hidden="true">·</span>
          <span data-ask-cache={cacheHit || reused ? "cached" : "fresh"}>
            {cacheHit || reused ? "Saved answer (no new AI request)" : "Fresh answer"}
          </span>
        </p>
        <button type="button" onClick={onStartOver}
          className={`-mx-2.5 ml-auto min-h-10 shrink-0 rounded-lg px-2.5 text-accent hover:bg-background ${focusRing}`}>
          <span className="text-xs font-semibold">New question</span>
        </button>
      </div>

      {answer.status === "answered" && (
        <>
          {/* Prose first; each statement ends with numbered links to the exact articles it cites. */}
          <ul className="mt-4 space-y-3.5" aria-label="Answer">
            {answer.statements.map((statement, index) => (
              <li key={index} className="flex gap-3">
                <span aria-hidden="true" className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                <p className="min-w-0 wrap-break-word text-[15px] leading-7 text-foreground sm:text-base sm:leading-7">
                  {statement.text}
                  <span className="ml-1.5 inline-flex flex-wrap gap-1 align-[0.12em]" role="group" aria-label={`Sources for statement ${index + 1}`}>
                    {markers[index].map((number) => <SourceMarker key={number} source={sources[number - 1]} />)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
          <SourceList sources={sources} headingId={`${headingId}-sources`} />
        </>
      )}

      {answer.status === "no_results" && (
        <Notice title="No matching coverage found">
          <p>Ask Kicker didn&rsquo;t find articles in the available feeds that answer this question. It matches keywords, not meanings, so try:</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            <li>a specific name, company, place or topic</li>
            <li>a broader question or a longer time period, such as &ldquo;this week&rdquo;</li>
            <li>different wording or spelling</li>
          </ul>
        </Notice>
      )}

      {answer.status === "needs_clarification" && (
        <Notice title="Ask Kicker needs a bit more detail">
          <p className="text-foreground">{answer.clarification}</p>
          <button type="button" onClick={onEdit} className={`mt-2.5 ${secondaryButton}`}>
            <span className={label}>Edit your question</span>
          </button>
        </Notice>
      )}

      {answer.status === "unsupported" && (
        <Notice title="This question is outside what Ask Kicker can answer">
          <p>Ask Kicker answers questions about recent headlines and summaries from available RSS feeds. It can&rsquo;t read full articles, browse the web, see your account or private data, or verify facts.</p>
        </Notice>
      )}

      {/* Incomplete-coverage warnings stay visible; the routine details are one click away. */}
      {notes.length > 0 && (
        <ul className="mt-4 space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs leading-relaxed text-amber-950" aria-label="Coverage warnings">
          {notes.map((note) => (
            <li key={note} className="flex gap-2"><Icon path={ICONS.alert} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />{note}</li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-text-sub">{answer.disclaimer}</p>

      {showsCoverage && <AboutAnswer coverage={answer.coverage} cached={cacheHit || reused} />}
    </article>
  );
}

// Compact inline link: the visible number matches the Sources list; the accessible
// name carries the publisher and headline. Colour sits on the inner span because the
// global `a` rule overrides colour utilities placed on links (KN-UI-006).
function SourceMarker({ source }: { source: AskSource }) {
  const content = (
    <>
      <span className="sr-only">Source </span>{source.number}
      <span className="sr-only">: {source.source}, {source.title}</span>
    </>
  );
  const shape = "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none tabular-nums";
  if (!source.href) return <span className={`${shape} border border-border bg-background text-text-sub`}>{content}</span>;
  return (
    <a href={source.href} target="_blank" rel="noopener noreferrer" title={`${source.source}: ${source.title}`}
      className={`group ${shape} bg-accent/10 transition-colors hover:bg-accent ${focusRing}`}>
      <span className="text-accent group-hover:text-white">{content}</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function SourceList({ sources, headingId }: { sources: AskSource[]; headingId: string }) {
  return (
    <section className="mt-5" aria-labelledby={headingId}>
      <h4 id={headingId} className="text-[11px] font-semibold uppercase tracking-wider text-text-sub">Sources</h4>
      <ol className="mt-2 grid gap-2 sm:grid-cols-2">
        {sources.map((source) => {
          const body = (
            <>
              <span className="mt-px inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 px-1 text-[11px] font-semibold tabular-nums text-accent">{source.number}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-navy">{source.source}</span>
                <span className="sr-only">: </span>
                <span className="line-clamp-2 wrap-break-word text-[13px] leading-snug text-text-sub group-hover:text-foreground">{source.title}</span>
              </span>
            </>
          );
          return (
            <li key={source.number} className="min-w-0">
              {source.href ? (
                <a href={source.href} target="_blank" rel="noopener noreferrer" title={source.title}
                  className={`group flex min-h-11 items-start gap-2.5 rounded-xl border border-border bg-background/60 px-3 py-2.5 transition-colors hover:border-accent/40 ${focusRing}`}>
                  {body}
                  <Icon path={ICONS.external} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted group-hover:text-accent" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <div className="flex min-h-11 items-start gap-2.5 rounded-xl border border-border px-3 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-background/70 p-3.5 text-sm leading-relaxed text-text-sub">
      <p className="font-semibold text-foreground">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function AboutAnswer({ coverage, cached }: { coverage: AskCoverage; cached: boolean }) {
  const { from, to } = coverage.availableWindow;
  const stats = [
    ["Time window", coverageWindowLabel(coverage)],
    ["Articles available", String(coverage.snapshotArticleCount)],
    ["Sources", String(coverage.sourceCount)],
    ["Matching articles", String(coverage.matchingArticleCount)],
  ];
  return (
    <details className="group mt-3 rounded-xl border border-border bg-background/50">
      <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 text-xs font-semibold text-text-sub hover:text-foreground [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <Icon path={ICONS.info} className="h-4 w-4" />About this answer
        <Icon path={ICONS.chevron} className="ml-auto h-4 w-4 group-open:rotate-180" />
      </summary>
      <section className="border-t border-border px-3.5 pb-3.5 pt-3" aria-label="Coverage used for this answer">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          {stats.map(([term, value]) => (
            <div key={term} className="min-w-0">
              <dt className="text-[11px] text-text-sub">{term}</dt>
              <dd className="text-sm font-semibold text-navy">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-text-sub">
          {from && to
            ? <>Available articles were published between <time dateTime={from}>{dateTime(from)}</time> and <time dateTime={to}>{dateTime(to)}</time>. </>
            : <>No articles were available in the feed snapshot. </>}
          Feeds checked at <time dateTime={coverage.asOf}>{timeOnly(coverage.asOf)}</time>.
          {cached ? " This saved answer was reused, so no new AI request was made." : ""}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-text-sub">
          <span className="font-semibold text-foreground">RSS coverage is incomplete.</span> Kicker only sees the recent headlines
          and short summaries publishers put in their feeds, not every article or the full text. Open the cited articles for details.
        </p>
      </section>
    </details>
  );
}
