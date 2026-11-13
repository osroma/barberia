import { createStaffToken, staffFromRequest } from "../_shared/auth.ts";
import { getAdminPassword, getState, saveAdminPassword, saveState } from "../_shared/data.ts";
import { corsHeaders, isAllowedClient, jsonResponse, methodNotAllowed } from "../_shared/http.ts";
import { hashPassword, verifyPassword } from "../_shared/password.ts";

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (!isAllowedClient(request)) return jsonResponse(request, { error: "Clave pública inválida" }, 401);

  if (request.method === "PUT") return updateAdminPassword(request);
  if (request.method !== "POST") return methodNotAllowed(request);

  let credentials: Record<string, unknown>;
  try {
    credentials = await request.json();
  } catch {
    return jsonResponse(request, { error: "JSON inválido" }, 400);
  }

  if (credentials.role === "admin" && credentials.username === "admin") {
    const password = await getAdminPassword();
    if (!password) return jsonResponse(request, { error: "Configura la contraseña inicial del administrador" }, 503);
    if (typeof credentials.password !== "string" || !(await verifyPassword(credentials.password, password))) {
      return jsonResponse(request, { error: "Usuario o contraseña incorrectos" }, 401);
    }
    if (!password.startsWith("$pbkdf2-sha256$")) await saveAdminPassword(await hashPassword(password));
    const token = await createStaffToken({ sub: "admin", role: "admin", barber: null });
    return jsonResponse(request, { role: "admin", username: "admin", barber: null, token });
  }

  if (credentials.role !== "barber" || typeof credentials.username !== "string" || typeof credentials.password !== "string") {
    return jsonResponse(request, { error: "Usuario o contraseña incorrectos" }, 401);
  }
  const state = await getState();
  const barbers = Array.isArray(state.barbers) ? state.barbers : [];
  const barber = barbers.find((item: Record<string, unknown>) =>
    item.active !== false && item.username === credentials.username
  );
  const storedPassword = barber?.passwordHash || barber?.password;
  if (!barber || typeof storedPassword !== "string" || !(await verifyPassword(credentials.password, storedPassword))) {
    return jsonResponse(request, { error: "Usuario o contraseña incorrectos" }, 401);
  }
  if (!barber.passwordHash) {
    barber.passwordHash = await hashPassword(credentials.password);
    delete barber.password;
    await saveState(state);
  }

  const token = await createStaffToken({
    sub: String(barber.username),
    role: "barber",
    barber: String(barber.name)
  });
  const { password: _password, passwordHash: _passwordHash, ...account } = barber;
  return jsonResponse(request, { ...account, role: "barber", token });
});

async function updateAdminPassword(request: Request): Promise<Response> {
  const identity = await staffFromRequest(request);
  if (!identity || identity.role !== "admin") {
    return jsonResponse(request, { error: "Solo el administrador puede cambiar esta contraseña" }, 401);
  }
  let credentials: Record<string, unknown>;
  try {
    credentials = await request.json();
  } catch {
    return jsonResponse(request, { error: "JSON inválido" }, 400);
  }
  const currentPassword = await getAdminPassword();
  if (!currentPassword || credentials.currentPassword !== currentPassword) {
    return jsonResponse(request, { error: "La contraseña actual no es correcta" }, 401);
  }
  if (typeof credentials.newPassword !== "string" || credentials.newPassword.length < 10) {
    return jsonResponse(request, { error: "La nueva contraseña debe tener al menos 10 caracteres" }, 400);
  }
  await saveAdminPassword(await hashPassword(credentials.newPassword));
  return jsonResponse(request, { success: true });
}
