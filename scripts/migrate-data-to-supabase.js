const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.BARBERIA_ADMIN_PASSWORD;
const dataPath = path.join(__dirname, "..", "data.json");

if (!supabaseUrl || !serviceRoleKey || !adminPassword) {
  throw new Error("Configura SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y BARBERIA_ADMIN_PASSWORD");
}
if (adminPassword.length < 10) {
  throw new Error("BARBERIA_ADMIN_PASSWORD debe tener al menos 10 caracteres");
}
if (!fs.existsSync(dataPath)) {
  throw new Error("No se encontró data.json para migrar");
}

const state = JSON.parse(fs.readFileSync(dataPath, "utf8"));
if (!Array.isArray(state.appointments) || !Array.isArray(state.barbers)) {
  throw new Error("data.json no contiene citas y barberos válidos");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 210_000, 32, "sha256");
  return `$pbkdf2-sha256$210000$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function upsert(table, query, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    method: "POST",
    headers: {
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`No se pudo migrar ${table}: Supabase respondió ${response.status}`);
  }
}

async function main() {
  state.barbers = state.barbers.map(barber => {
    const { password, passwordHash, ...safeBarber } = barber;
    const storedHash = passwordHash || (typeof password === "string" && password ? hashPassword(password) : "");
    return { ...safeBarber, passwordHash: storedHash };
  });
  if (state.barbers.some(barber => !barber.passwordHash)) {
    throw new Error("Cada barbero necesita una contraseña antes de migrar");
  }
  await upsert("barberia_state", "on_conflict=key", { key: "shared-state", state });
  await upsert("barberia_settings", "on_conflict=key", {
    key: "admin-password",
    value: hashPassword(adminPassword)
  });
  console.log(`Migración completada: ${state.appointments.length} citas y ${state.barbers.length} barberos.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
