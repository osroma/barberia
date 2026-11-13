const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 8081);
const host = "0.0.0.0";
const dataFile = path.join(root, "data.json");
const adminPasswordFile = path.join(root, ".admin-password.json");

const defaultData = {
  appointments: [],
  blockedSlots: [],
  services: [],
  barbers: [],
  schedule: [
    { day: 1, enabled: true, open: "08:00", close: "19:00" },
    { day: 2, enabled: true, open: "08:00", close: "19:00" },
    { day: 3, enabled: true, open: "08:00", close: "19:00" },
    { day: 4, enabled: true, open: "08:00", close: "19:00" },
    { day: 5, enabled: true, open: "08:00", close: "19:00" },
    { day: 6, enabled: true, open: "08:00", close: "19:00" },
    { day: 0, enabled: false, open: "08:00", close: "19:00" }
  ]
};

function readData() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
    return structuredClone(defaultData);
  }
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  if (!Array.isArray(data.appointments)) data.appointments = [];
  if (!Array.isArray(data.barbers)) data.barbers = defaultData.barbers;
  if (!Array.isArray(data.blockedSlots)) data.blockedSlots = [];
  if (!Array.isArray(data.services)) data.services = [];
  if (!Array.isArray(data.schedule) || data.schedule.length !== 7) {
    data.schedule = structuredClone(defaultData.schedule);
  }
  return data;
}

function writeData(data) {
  fs.writeFileSync(`${dataFile}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${dataFile}.tmp`, dataFile);
}

function readAdminPassword() {
  if (fs.existsSync(adminPasswordFile)) {
    return JSON.parse(fs.readFileSync(adminPasswordFile, "utf8")).password || "";
  }
  return process.env.ADMIN_PASSWORD || "";
}

function writeAdminPassword(password) {
  fs.writeFileSync(`${adminPasswordFile}.tmp`, JSON.stringify({ password }));
  fs.renameSync(`${adminPasswordFile}.tmp`, adminPasswordFile);
}

function time12To24(time) {
  const value = String(time).trim().match(/^(\d{1,2}):(\d{2})(?:\s*(a\.?\s*m\.?|p\.?\s*m\.?))?$/i);
  if (!value) return String(time);
  let hours = Number(value[1]);
  const period = value[3]?.replace(/\s/g, "").replace(/\./g, "").toLowerCase();
  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  if (!period) return `${String(hours).padStart(2, "0")}:${value[2]}`;
  return `${String(hours).padStart(2, "0")}:${value[2]}`;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function whatsappRecipient(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("57") ? digits : `57${digits}`;
}

async function sendWhatsAppReminder(appointment, baseUrl) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { skipped: true, reason: "WhatsApp Business API no configurada" };

  const cancelUrl = `${baseUrl}/cancelar-cita/${encodeURIComponent(appointment.id)}?token=${encodeURIComponent(appointment.cancellationToken || "")}`;
  const message = [
    `Hola ${appointment.client}, te recordamos que tu cita en Adrian Barber es hoy a las ${appointment.time}.`,
    `Recuerda llegar 15 minutos antes.`,
    `Si ya no puedes asistir, cancela aquí: ${cancelUrl}`
  ].join("\n");
  const response = await fetch(
    `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v22.0"}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: whatsappRecipient(appointment.phone),
        type: "text",
        text: { preview_url: true, body: message }
      })
    }
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `WhatsApp respondió ${response.status}`);
  return result;
}

function processReminders() {
  const data = readData();
  let changed = false;
  const now = new Date();
  for (const appointment of data.appointments || []) {
    if (appointment.status !== "pending" || appointment.reminder30Sent) continue;
    const appointmentTime = new Date(`${appointment.date}T${time12To24(appointment.time)}:00`);
    const minutesUntil = (appointmentTime - now) / 60000;
    if (minutesUntil > 30 || minutesUntil < 29) continue;
    appointment.cancellationToken ||= `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const baseUrl = process.env.PUBLIC_BASE_URL || `http://${process.env.HOST_IP || "localhost"}:${port}`;
    sendWhatsAppReminder(appointment, baseUrl)
      .then(result => {
        if (result.skipped) return;
        const latest = readData();
        const saved = latest.appointments.find(item => item.id === appointment.id);
        if (saved) {
          saved.reminder30Sent = true;
          saved.cancellationToken = appointment.cancellationToken;
          writeData(latest);
        }

      })
      .catch(error => console.error(`Recordatorio no enviado para ${appointment.id}:`, error.message));
    changed = true;
  }
  if (changed) writeData(data);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) request.destroy();
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("JSON inválido")); }
    });
  });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  const cancellationMatch = url.pathname.match(/^\/cancelar-cita\/([^/]+)$/);
  if (cancellationMatch && request.method === "GET") {
    const data = readData();
    const appointment = data.appointments.find(item => String(item.id) === cancellationMatch[1]);
    const token = url.searchParams.get("token");
    if (!appointment || !appointment.cancellationToken || appointment.cancellationToken !== token) {
      return sendJson(response, 404, { error: "Enlace de cancelación inválido" });
    }
    appointment.status = "cancelled";
    writeData(data);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cita cancelada</title><body style="font-family:Arial;background:#171914;color:white;display:grid;place-items:center;min-height:90vh;text-align:center"><main><h1>Cita cancelada</h1><p>Tu cita fue cancelada correctamente.</p></main></body></html>`);
    return;
  }

  if (url.pathname === "/api/state") {
    if (request.method === "GET") return sendJson(response, 200, readData());
    if (request.method === "PUT") {
      try {
        const data = await readJson(request);
        if (!Array.isArray(data.appointments) || !Array.isArray(data.barbers)) {
          return sendJson(response, 400, { error: "Datos incompletos" });
        }
        if (!Array.isArray(data.blockedSlots)) data.blockedSlots = [];
        if (!Array.isArray(data.services)) data.services = [];
        if (!Array.isArray(data.schedule) || data.schedule.length !== 7) {
          data.schedule = structuredClone(defaultData.schedule);
        }
        const existingBarbers = readData().barbers;
        data.barbers = data.barbers.map(barber => {
          const existing = existingBarbers.find(item => String(item.id) === String(barber.id));
          return {
            ...barber,
            password: barber.password || existing?.password || ""
          };
        });
        if (data.barbers.some(barber => !barber.password)) {
          return sendJson(response, 400, { error: "Cada barbero necesita una contraseña" });
        }
        writeData(data);
        return sendJson(response, 200, readData());
      } catch (error) {
        return sendJson(response, 400, { error: error.message });
      }
    }
  }

  if (url.pathname === "/api/login" && request.method === "PUT") {
    try {
      const credentials = await readJson(request);
      if (credentials.currentPassword !== readAdminPassword()) {
        return sendJson(response, 401, { error: "La contraseña actual no es correcta" });
      }
      if (typeof credentials.newPassword !== "string" || credentials.newPassword.length < 6) {
        return sendJson(response, 400, { error: "La nueva contraseña debe tener al menos 6 caracteres" });
      }
      writeAdminPassword(credentials.newPassword);
      return sendJson(response, 200, { success: true });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    try {
      const credentials = await readJson(request);
      const data = readData();
      const adminPassword = readAdminPassword();
      if (adminPassword && credentials.role === "admin" && credentials.username === "admin" && credentials.password === adminPassword) {
        return sendJson(response, 200, { role: "admin", username: "admin", barber: null });
      }
      const barber = data.barbers.find(item =>
        item.active !== false &&
        item.username === credentials.username &&
        item.password === credentials.password
      );
      if (credentials.role === "barber" && barber) return sendJson(response, 200, { ...barber, role: "barber" });
      return sendJson(response, 401, { error: "Usuario o contraseña incorrectos" });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (!["GET", "HEAD"].includes(request.method)) return sendJson(response, 405, { error: "Método no permitido" });
  let filePath = path.join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!filePath.startsWith(root)) return sendJson(response, 403, { error: "Acceso denegado" });
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendJson(response, 404, { error: "Archivo no encontrado" });
    const isStaticAsset = /\.(css|js|jpg|jpeg|png)$/i.test(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": isStaticAsset ? "public, max-age=3600" : "no-cache"
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, host, () => {
  console.log(`Adrian Barber disponible en http://localhost:${port}`);
  console.log("Dispositivos de la misma red: http://<IP-DE-ESTE-PC>:%s", port);
});

processReminders();
setInterval(processReminders, 30 * 1000);
