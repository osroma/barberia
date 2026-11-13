export interface StaffIdentity {
  sub: string;
  role: "admin" | "barber";
  barber: string | null;
  exp: number;
}

const encoder = new TextEncoder();

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function signingKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("BARBERIA_JWT_SECRET");
  if (!secret) throw new Error("Falta configurar BARBERIA_JWT_SECRET en Supabase Functions");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createStaffToken(
  identity: Omit<StaffIdentity, "exp">
): Promise<string> {
  const header = encodeBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({
    ...identity,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
  })));
  const content = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(content));
  return `${content}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function staffFromRequest(request: Request): Promise<StaffIdentity | null> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer ([\w.-]+)$/)?.[1];
  if (!token) return null;

  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) return null;
  try {
    const parsedHeader = JSON.parse(new TextDecoder().decode(decodeBase64Url(header)));
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
    const content = `${header}.${payload}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      decodeBase64Url(signature),
      encoder.encode(content)
    );
    if (!valid) return null;
    const identity = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as StaffIdentity;
    if (
      typeof identity.sub !== "string" ||
      !["admin", "barber"].includes(identity.role) ||
      typeof identity.exp !== "number" ||
      identity.exp <= Math.floor(Date.now() / 1000) ||
      (identity.role === "barber" && typeof identity.barber !== "string")
    ) return null;
    return identity;
  } catch {
    return null;
  }
}
