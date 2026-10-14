const hexToBytes = (hex: string) =>
  new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);

/** Verifies Discord's Ed25519 request signature. Returns the raw body if valid. */
export async function verifyDiscordRequest(
  request: Request,
  publicKey: string,
): Promise<string | null> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const body = await request.text();
  if (!signature || !timestamp) return null;
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), { name: "Ed25519" }, false, [
      "verify",
    ]);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
    return ok ? body : null;
  } catch {
    return null;
  }
}
