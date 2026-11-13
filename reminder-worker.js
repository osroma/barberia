export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processReminders(env));
  }
};

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("57") ? digits : `57${digits}`;
}

function colombiaDateTime(date, time) {
  return new Date(`${date}T${time12To24(time)}:00-05:00`);
}

function time12To24(time) {
  const value = String(time).trim().match(/^(\d{1,2}):(\d{2})(?:\s*(a\.?\s*m\.?|p\.?\s*m\.?))?$/i);
  if (!value) return String(time);
  let hours = Number(value[1]);
  const period = value[3]?.replace(/\s/g, "").replace(/\./g, "");
  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${value[2]}`;
}

function metaMessage(env, appointment, cancelUrl) {
  const template = env.WHATSAPP_TEMPLATE_NAME;
  if (template) {
    return {
      messaging_product: "whatsapp",
      to: normalizePhone(appointment.phone),
      type: "template",
      template: {
        name: template,
        language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE || "es_CO" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: appointment.client },
            { type: "text", text: appointment.date },
            { type: "text", text: appointment.time }
          ]
        }]
      }
    };
  }

  return {
    messaging_product: "whatsapp",
    to: normalizePhone(appointment.phone),
    type: "text",
    text: {
      preview_url: true,
      body: `Hola ${appointment.client}, te recordamos que tienes una cita en Adrian Barber el ${appointment.date} a las ${appointment.time}. Si deseas cancelar, responde CANCELAR o ingresa aquí: ${cancelUrl}`
    }
  };
}

async function processReminders(env) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  const headers = {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };
  const stateResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/barberia_state?key=eq.shared-state&select=state`,
    { headers }
  );
  if (!stateResponse.ok) throw new Error(`No se pudo leer Supabase: ${await stateResponse.text()}`);
  const rows = await stateResponse.json();
  const state = rows[0]?.state;
  if (!state || !Array.isArray(state.appointments)) throw new Error("No existe el estado inicial de la barbería");

  let changed = false;
  for (const appointment of state.appointments) {
    if (appointment.status !== "pending" || !appointment.phone || appointment.reminder30Sent) continue;
    const minutesUntil = (colombiaDateTime(appointment.date, appointment.time) - new Date()) / 60000;
    if (minutesUntil < 29 || minutesUntil > 31) continue;

    appointment.cancellationToken ||= crypto.randomUUID();
    changed = true;
    const cancelUrl = `${env.SUPABASE_URL}/functions/v1/cancel?id=${encodeURIComponent(appointment.id)}&token=${encodeURIComponent(appointment.cancellationToken)}`;
    const response = await fetch(
      `https://graph.facebook.com/${env.WHATSAPP_API_VERSION || "v22.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(metaMessage(env, appointment, cancelUrl))
      }
    );

    if (response.ok) {
      appointment.reminder30Sent = true;
      changed = true;
    } else {
      console.error(await response.text());
    }
  }
  if (changed) {
    const saveResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/barberia_state?on_conflict=key`,
      {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: "shared-state", state })
      }
    );
    if (!saveResponse.ok) throw new Error(`No se pudo guardar en Supabase: ${await saveResponse.text()}`);
  }
}
