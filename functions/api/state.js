export async function onRequest(context) {
  if (context.request.method === "PUT") return putState(context);
  if (context.request.method !== "GET") return Response.json({ error: "Método no permitido" }, { status: 405 });

  const { env } = context;
  let state = await env.BARBERIA_STATE.get("shared-state", "json");

  if (!state) {
    const response = await context.env.ASSETS.fetch(new Request(new URL("/data.json", context.request.url)));
    state = response.ok ? await response.json() : { appointments: [], barbers: [], services: [], blockedSlots: [] };
  }
  if (!Array.isArray(state.services)) state.services = [];
  if (!Array.isArray(state.blockedSlots)) state.blockedSlots = [];
  if (!Array.isArray(state.schedule) || state.schedule.length !== 7) {
    state.schedule = [
      { day: 1, enabled: true, open: "08:00", close: "19:00" },
      { day: 2, enabled: true, open: "08:00", close: "19:00" },
      { day: 3, enabled: true, open: "08:00", close: "19:00" },
      { day: 4, enabled: true, open: "08:00", close: "19:00" },
      { day: 5, enabled: true, open: "08:00", close: "19:00" },
      { day: 6, enabled: true, open: "08:00", close: "19:00" },
      { day: 0, enabled: false, open: "08:00", close: "19:00" }
    ];
  }

  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}

async function putState(context) {
  const state = await context.request.json();
  if (!Array.isArray(state.appointments) || !Array.isArray(state.barbers)) {
    return Response.json({ error: "Datos incompletos" }, { status: 400 });
  }
  if (state.services !== undefined && !Array.isArray(state.services)) {
    return Response.json({ error: "Servicios incompletos" }, { status: 400 });
  }
  if (!Array.isArray(state.schedule) || state.schedule.length !== 7) {
    return Response.json({ error: "Horario incompleto" }, { status: 400 });
  }
  if (!Array.isArray(state.blockedSlots)) state.blockedSlots = [];
  for (const appointment of state.appointments) {
    const phone = String(appointment.phone || "").replace(/\D/g, "");
    if (!phone) return Response.json({ error: "El número de WhatsApp es obligatorio" }, { status: 400 });
    appointment.phone = phone.startsWith("57") ? phone : `57${phone}`;
  }
  await context.env.BARBERIA_STATE.put("shared-state", JSON.stringify(state));
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}
