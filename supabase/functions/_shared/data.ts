const statePath = "/rest/v1/barberia_state";
const settingsPath = "/rest/v1/barberia_settings";

function serviceHeaders(prefer?: string): HeadersInit {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("Falta configurar SUPABASE_SERVICE_ROLE_KEY en Supabase Functions");
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { "Prefer": prefer } : {})
  };
}

async function databaseRequest(path: string, init: RequestInit): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("Falta configurar SUPABASE_URL en Supabase Functions");
  const response = await fetch(`${url}${path}`, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase respondió ${response.status}: ${detail}`);
  }
  return response;
}

export async function getState(): Promise<Record<string, unknown>> {
  const response = await databaseRequest(
    `${statePath}?key=eq.shared-state&select=state`,
    { headers: serviceHeaders() }
  );
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]?.state) throw new Error("No existe el estado inicial de la barbería");
  return rows[0].state;
}

export async function saveState(state: Record<string, unknown>): Promise<void> {
  await databaseRequest(
    `${statePath}?on_conflict=key`,
    {
      method: "POST",
      headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify({ key: "shared-state", state })
    }
  );
}

export async function getAdminPassword(): Promise<string | null> {
  const response = await databaseRequest(
    `${settingsPath}?key=eq.admin-password&select=value`,
    { headers: serviceHeaders() }
  );
  const rows = await response.json();
  return Array.isArray(rows) && typeof rows[0]?.value === "string" ? rows[0].value : null;
}

export async function saveAdminPassword(password: string): Promise<void> {
  await databaseRequest(
    `${settingsPath}?on_conflict=key`,
    {
      method: "POST",
      headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify({ key: "admin-password", value: password })
    }
  );
}
