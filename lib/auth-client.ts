export type AuthResult = { confirmationRequired?: boolean; message?: string };

export async function submitPasswordAuth(
  mode: "login" | "signup", email: string, password: string,
  fetcher: typeof fetch = fetch,
): Promise<AuthResult> {
  try {
    const response = await fetcher(`/api/auth/${mode}`, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
      signal: AbortSignal.timeout(20000),
    });
    let result: { error?: string; message?: string; confirmationRequired?: boolean };
    try { result = await response.json(); }
    catch { throw new Error(response.status === 404 ? "The sign-in service was not found. Restart the local server and try again." : "The sign-in service returned an unexpected response. Please try again."); }
    if (!result || typeof result !== "object") throw new Error("The sign-in service returned an unexpected response. Please try again.");
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to sign in right now. Please try again.");
    return result;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("Sign-in timed out. Please check your connection and try again.");
    if (error instanceof TypeError) throw new Error("Unable to reach the sign-in service. Please check your connection and try again.");
    throw error;
  }
}
