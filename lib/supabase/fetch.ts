// Bound network work that otherwise holds an auth refresh/storage lock indefinitely.
// Never inspect or log headers, tokens, request bodies, or credential-bearing URLs.
export function createSupabaseFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init) => fetcher(input, {
    ...init,
    signal: AbortSignal.any([AbortSignal.timeout(10000), ...(init?.signal ? [init.signal] : [])]),
  });
}
