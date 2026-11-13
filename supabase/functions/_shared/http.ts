const allowedOrigins = new Set([
  "https://osroma.github.io",
  "https://rodriguezom03.github.io",
  "http://localhost:8081",
  "http://127.0.0.1:8081"
]);

export function corsHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

export function isAllowedClient(request: Request): boolean {
  const expectedKey = Deno.env.get("BARBERIA_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  return Boolean(expectedKey && request.headers.get("apikey") === expectedKey);
}

export function methodNotAllowed(request: Request): Response {
  return jsonResponse(request, { error: "Método no permitido" }, 405);
}
