import { getState, saveState } from "../_shared/data.ts";
import { corsHeaders, isAllowedClient, jsonResponse, methodNotAllowed } from "../_shared/http.ts";

function normalizeWhatsAppPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("57") ? digits : `57${digits}`;
}

async function sendBookingConfirmation(appointment: Record<string, any>): Promise<void> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId || !appointment.phone) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const cancelUrl = supabaseUrl
    ? `${supabaseUrl}/functions/v1/cancel?id=${encodeURIComponent(String(appointment.id))}&token=${encodeURIComponent(String(appointment.cancellationToken || ""))}`
    : undefined;

  const message = [
    `Hola ${appointment.client}, tu cita en Adrian Barber quedó agendada.`,
    `Fecha: ${appointment.date}`,
    `Hora: ${appointment.time}`,
    `Servicio: ${appointment.service}`,
    `Barbero: ${appointment.barber}`,
    cancelUrl ? `Cancelar o modificar: ${cancelUrl}` : "Gracias por elegir Adrian Barber."
  ].join("\n");

  const response = await fetch(
    `https://graph.facebook.com/${Deno.env.get("WHATSAPP_API_VERSION") || "v22.0"}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizeWhatsAppPhone(appointment.phone),
        type: "text",
        text: { preview_url: true, body: message }
      })
    }
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || `WhatsApp respondió ${response.status}`);
  }
}

function timeToMinutes(value: unknown): number | null {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3]?.toLowerCase();
  if (minutes > 59 || hours > (period ? 12 : 23) || hours < (period ? 1 : 0)) return null;
  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function durationFor(appointment: Record<string, any>, services: Record<string, any>[]): number {
  if (Number.isFinite(appointment.duration)) return appointment.duration;
  return String(appointment.service || "").split(" + ").reduce((total, name) => {
    const service = services.find(item => item.name === name);
    return total + (Number(service?.minutes) || 30);
  }, 0);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (!isAllowedClient(request)) return jsonResponse(request, { error: "Clave pública inválida" }, 401);
  if (request.method !== "POST") return methodNotAllowed(request);

  let appointment: Record<string, any>;
  try {
    appointment = await request.json();
  } catch {
    return jsonResponse(request, { error: "JSON inválido" }, 400);
  }
  const phone = String(appointment.phone || "").replace(/\D/g, "");
  const start = timeToMinutes(appointment.time);
  if (
    typeof appointment.client !== "string" || !appointment.client.trim() ||
    !phone ||
    typeof appointment.barber !== "string" ||
    typeof appointment.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) ||
    start === null
  ) return jsonResponse(request, { error: "Completa los datos de la reserva" }, 400);

  const state = await getState();
  const appointments = Array.isArray(state.appointments) ? state.appointments : [];
  const services = Array.isArray(state.services) ? state.services : [];
  const selectedServices = String(appointment.service || "").split(" + ");
  const matchingServices = selectedServices.map(name => services.find((item: Record<string, any>) => item.name === name));
  if (!matchingServices.length || matchingServices.some(service => !service)) {
    return jsonResponse(request, { error: "Selecciona servicios válidos" }, 400);
  }
  const barber = (Array.isArray(state.barbers) ? state.barbers : []).find((item: Record<string, any>) =>
    item.name === appointment.barber && item.active !== false
  );
  if (!barber) return jsonResponse(request, { error: "Selecciona un barbero disponible" }, 400);

  const duration = matchingServices.reduce((total, service) => total + (Number(service.minutes) || 30), 0);
  const price = matchingServices.reduce((total, service) => total + (Number(service.price) || 0), 0);
  const weekday = new Date(`${appointment.date}T12:00:00`).getDay();
  const daySchedule = (Array.isArray(state.schedule) ? state.schedule : []).find((day: Record<string, any>) => day.day === weekday);
  const openingTime = timeToMinutes(daySchedule?.open);
  const closingTime = timeToMinutes(daySchedule?.close);
  if (
    !daySchedule?.enabled ||
    openingTime === null ||
    closingTime === null ||
    start < openingTime ||
    start + duration > closingTime
  ) return jsonResponse(request, { error: "La barbería está cerrada o fuera del horario de atención" }, 409);

  const blocked = (Array.isArray(state.blockedSlots) ? state.blockedSlots : []).some((slot: Record<string, any>) => {
    const blockedTime = timeToMinutes(slot.time);
    return slot.date === appointment.date && slot.barber === appointment.barber &&
      blockedTime !== null && blockedTime >= start && blockedTime < start + duration;
  });
  const conflict = appointments.some((item: Record<string, any>) => {
    if (item.date !== appointment.date || item.barber !== appointment.barber || item.status === "cancelled") return false;
    const itemStart = timeToMinutes(item.time);
    return itemStart !== null && start < itemStart + durationFor(item, services) && start + duration > itemStart;
  });
  if (blocked || conflict) return jsonResponse(request, { error: "Ese horario ya no está disponible" }, 409);

  appointment.phone = phone.startsWith("57") ? phone : `57${phone}`;
  appointment.id = Date.now();
  appointment.status = "pending";
  appointment.price = price;
  appointment.duration = duration;
  appointment.reminder30Sent = false;
  appointment.cancellationToken = crypto.randomUUID();
  appointments.push(appointment);
  await saveState({ ...state, appointments });

  try {
    await sendBookingConfirmation(appointment);
  } catch (error) {
    console.error("No se pudo enviar la confirmación por WhatsApp:", error instanceof Error ? error.message : error);
  }

  return jsonResponse(request, { success: true, id: appointment.id }, 201);
});
