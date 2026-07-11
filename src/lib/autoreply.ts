// Erkennung automatischer E-Mails (Abwesenheitsnotizen, Bounces, Newsletter),
// damit keine Benachrichtigungs-Schleifen entstehen und Bounces nicht als
// Kundenantworten einsortiert werden.

export interface HeaderLike {
  /** Header-Zugriff, case-insensitiv; Wert oder undefined. */
  get(name: string): string | undefined;
}

export function headersFromMap(map: Map<string, unknown>): HeaderLike {
  return {
    get(name) {
      const value = map.get(name.toLowerCase());
      if (value === undefined || value === null) return undefined;
      if (typeof value === "string") return value;
      // mailparser liefert für manche Header Objekte ({ value, params })
      if (typeof value === "object" && "value" in (value as Record<string, unknown>)) {
        return String((value as { value: unknown }).value);
      }
      return String(value);
    },
  };
}

export function isAutoSubmitted(headers: HeaderLike): boolean {
  const autoSubmitted = headers.get("auto-submitted")?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;

  const precedence = headers.get("precedence")?.toLowerCase();
  if (precedence === "bulk" || precedence === "auto_reply" || precedence === "junk") return true;

  if (headers.get("x-autoreply") || headers.get("x-autorespond")) return true;

  const msFeedback = headers.get("x-auto-response-suppress");
  if (msFeedback) return true;

  return false;
}

export function isBounce(headers: HeaderLike, from: string | undefined): boolean {
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/report") && contentType.includes("delivery-status")) {
    return true;
  }
  const fromAddr = (from ?? "").toLowerCase();
  return fromAddr.startsWith("mailer-daemon@") || fromAddr.startsWith("postmaster@");
}
