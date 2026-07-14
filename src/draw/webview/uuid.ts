// ---------------------------------------------------------------------------
// uuid.ts — UUID v4 generation for the webview context
// Uses the browser's crypto API (available in VS Code's Chromium webview).
// ---------------------------------------------------------------------------

export function randomUUID(): string {
  // crypto.randomUUID() is available in VS Code's Chromium runtime
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: manual v4 UUID via crypto.getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
