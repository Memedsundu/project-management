/** Map a browser WebAuthn error to one of our message keys. */
export function browserErrorCode(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "cancelled";
  if (name === "NotSupportedError" || name === "SecurityError") return "unsupported";
  // The authenticator already holds a passkey for this workspace.
  if (name === "InvalidStateError") return "exists";
  return "verify";
}
