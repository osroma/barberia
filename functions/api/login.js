export async function onRequest(context) {
  if (context.request.method === "PUT") return updateAdminPassword(context);
  if (context.request.method !== "POST") return Response.json({ error: "Método no permitido" }, { status: 405 });
  let credentials;
  try {
    credentials = await context.request.json();
    const storedPassword = await context.env.BARBERIA_STATE.get("admin-password");
    if (storedPassword && credentials.role === "admin" && credentials.username === "admin" && credentials.password === storedPassword) {
      return new Response(JSON.stringify({ role: "admin", username: "admin", barber: null }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (error) {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const state = await context.env.BARBERIA_STATE.get("shared-state", "json");
  const barbers = state?.barbers || [];

  const barber = barbers.find(item =>
    item.active !== false &&
    item.username === credentials.username &&
    item.password === credentials.password
  );

  if (credentials.role === "barber" && barber) {
    return Response.json({ ...barber, role: "barber" });
  }

  return Response.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
}

async function updateAdminPassword(context) {
  const credentials = await context.request.json();
  const currentPassword = await context.env.BARBERIA_STATE.get("admin-password");
  if (credentials.currentPassword !== currentPassword) {
    return Response.json({ error: "La contraseña actual no es correcta" }, { status: 401 });
  }
  if (typeof credentials.newPassword !== "string" || credentials.newPassword.length < 6) {
    return Response.json({ error: "La nueva contraseña debe tener al menos 6 caracteres" }, { status: 400 });
  }
  await context.env.BARBERIA_STATE.put("admin-password", credentials.newPassword);
  return Response.json({ success: true });
}
