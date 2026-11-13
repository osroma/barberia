import { getState, saveState } from "../_shared/data.ts";
import { corsHeaders, isAllowedClient, jsonResponse, methodNotAllowed } from "../_shared/http.ts";

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(request);
  if (request.method === "POST" && !isAllowedClient(request)) {
    return jsonResponse(request, { error: "Clave pública inválida" }, 401);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  if (!id || !token) return jsonResponse(request, { error: "Enlace de cancelación inválido" }, 400);

  const state = await getState();
  const appointments = Array.isArray(state.appointments) ? state.appointments : [];
  const appointment = appointments.find((item: Record<string, unknown>) => String(item.id) === id);
  if (!appointment || appointment.cancellationToken !== token) {
    return jsonResponse(request, { error: "Enlace de cancelación inválido" }, 404);
  }
  appointment.status = "cancelled";
  await saveState({ ...state, appointments });
  if (request.method === "GET") {
    return new Response(
      "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>Cita cancelada</title><body style=\"font-family:Arial;text-align:center;padding:20vh 20px\"><h1>Cita cancelada</h1><p>Tu cita fue cancelada correctamente.</p></body></html>",
      { headers: { ...corsHeaders(request), "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  return jsonResponse(request, { success: true });
});
