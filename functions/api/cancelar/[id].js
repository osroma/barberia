export async function onRequest(context) {
  if (!["GET", "POST"].includes(context.request.method)) return Response.json({ error: "Método no permitido" }, { status: 405 });
  const state = await context.env.BARBERIA_STATE.get("shared-state", "json");
  if (!state) return Response.json({ error: "Cita no encontrada" }, { status: 404 });

  const appointment = state.appointments.find(item => String(item.id) === context.params.id);
  if (!appointment) return Response.json({ error: "Cita no encontrada" }, { status: 404 });

  appointment.status = "cancelled";
  await context.env.BARBERIA_STATE.put("shared-state", JSON.stringify(state));
  if (context.request.method === "GET") {
    return new Response("<!doctype html><title>Cita cancelada</title><main style=\"font-family:sans-serif;text-align:center;padding:20vh 20px\"><h1>Cita cancelada</h1><p>Tu cita fue cancelada correctamente.</p></main>", {
      headers: { "Content-Type": "text/html; charset=UTF-8" }
    });
  }
  return Response.json({ success: true });
}
