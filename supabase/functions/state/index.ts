import { staffFromRequest } from "../_shared/auth.ts";
import { getState, saveState } from "../_shared/data.ts";
import { corsHeaders, isAllowedClient, jsonResponse, methodNotAllowed } from "../_shared/http.ts";
import { hashPassword } from "../_shared/password.ts";

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function publicState(state: Record<string, any>, isStaff: boolean) {
  const result = structuredClone(state);
  result.barbers = (result.barbers || []).map((barber: Record<string, unknown>) => {
    const { password: _password, passwordHash: _passwordHash, ...safeBarber } = barber;
    if (isStaff) return safeBarber;
    const { username: _username, phone: _phone, ...publicBarber } = safeBarber;
    return publicBarber;
  });
  if (!isStaff) {
    result.appointments = (result.appointments || []).map(({ id, barber, date, time, status }: Record<string, unknown>) => ({
      id, barber, date, time, status
    }));
  }
  return result;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (!isAllowedClient(request)) return jsonResponse(request, { error: "Clave pública inválida" }, 401);

  if (request.method === "GET") {
    const identity = await staffFromRequest(request);
    const state = await getState();
    return jsonResponse(request, publicState(state, Boolean(identity)));
  }
  if (request.method !== "PUT") return methodNotAllowed(request);

  const identity = await staffFromRequest(request);
  if (!identity) return jsonResponse(request, { error: "Inicia sesión para modificar los datos" }, 401);

  let incoming: Record<string, any>;
  try {
    incoming = await request.json();
  } catch {
    return jsonResponse(request, { error: "JSON inválido" }, 400);
  }
  if (
    !Array.isArray(incoming.appointments) ||
    !Array.isArray(incoming.barbers) ||
    !Array.isArray(incoming.services) ||
    !Array.isArray(incoming.schedule) ||
    incoming.schedule.length !== 7
  ) return jsonResponse(request, { error: "Datos incompletos" }, 400);
  if (!Array.isArray(incoming.blockedSlots)) incoming.blockedSlots = [];

  const current = await getState();
  const currentBarbers = Array.isArray(current.barbers) ? current.barbers : [];
  const barbers = await Promise.all(incoming.barbers.map(async (barber: Record<string, any>) => {
    const existing = currentBarbers.find((item: Record<string, any>) => String(item.id) === String(barber.id));
    if (typeof barber.password === "string" && barber.password && barber.password.length < 6) {
      return { ...barber, passwordHash: "" };
    }
    const passwordHash = typeof barber.password === "string" && barber.password
      ? await hashPassword(barber.password)
      : existing?.passwordHash || (existing?.password ? await hashPassword(existing.password) : undefined);
    const { password: _password, ...safeBarber } = barber;
    return { ...safeBarber, passwordHash };
  }));
  if (barbers.some((barber: Record<string, unknown>) => typeof barber.passwordHash !== "string" || !barber.passwordHash)) {
    return jsonResponse(request, { error: "Cada barbero necesita una contraseña" }, 400);
  }

  if (identity.role === "barber") {
    const currentAppointments = Array.isArray(current.appointments) ? current.appointments : [];
    if (
      !sameValue(barbers, currentBarbers) ||
      !sameValue(incoming.services, current.services) ||
      !sameValue(incoming.schedule, current.schedule) ||
      !sameValue(incoming.blockedSlots, current.blockedSlots) ||
      incoming.appointments.length !== currentAppointments.length
    ) return jsonResponse(request, { error: "Un barbero solo puede actualizar el estado de sus citas" }, 403);

    for (const appointment of incoming.appointments) {
      const previous = currentAppointments.find((item: Record<string, unknown>) => String(item.id) === String(appointment.id));
      if (!previous || previous.barber !== identity.barber) {
        const unchanged = previous && sameValue(appointment, previous);
        if (!unchanged) return jsonResponse(request, { error: "No puedes modificar citas de otro barbero" }, 403);
      } else {
        const previousDetails = { ...previous, status: undefined };
        const updatedDetails = { ...appointment, status: undefined };
        if (
          !sameValue(previousDetails, updatedDetails) ||
          !["pending", "completed", "cancelled"].includes(appointment.status)
        ) return jsonResponse(request, { error: "Un barbero solo puede actualizar el estado de sus citas" }, 403);
      }
    }
  }

  for (const appointment of incoming.appointments) {
    const phone = String(appointment.phone || "").replace(/\D/g, "");
    if (!phone) return jsonResponse(request, { error: "El número de WhatsApp es obligatorio" }, 400);
    appointment.phone = phone.startsWith("57") ? phone : `57${phone}`;
  }

  const nextState = { ...incoming, barbers };
  await saveState(nextState);
  return jsonResponse(request, publicState(nextState, true));
});
