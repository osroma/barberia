const STORAGE_KEY = "barberiaAppointments";
const BARBERS_KEY = "barberiaBarbers";
const SERVICES_KEY = "barberiaServices";
const SCHEDULE_KEY = "barberiaSchedule";
const currency = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const today = new Date().toISOString().slice(0, 10);
const supabaseConfig = window.BARBERIA_CONFIG || {};
const requiresSupabase = location.protocol === "https:" && location.hostname !== "localhost";
let sessionToken = null;

function apiFetch(endpoint, options = {}) {
  if (supabaseConfig.enabled) {
    if (!supabaseConfig.supabaseUrl || !supabaseConfig.supabaseAnonKey) {
      return Promise.reject(new Error("Configura la URL y la clave pública de Supabase"));
    }
    const headers = new Headers(options.headers || {});
    headers.set("apikey", supabaseConfig.supabaseAnonKey);
    headers.set("Authorization", `Bearer ${sessionToken || supabaseConfig.supabaseAnonKey}`);
    return fetch(`${supabaseConfig.supabaseUrl}/functions/v1/${endpoint}`, { ...options, headers });
  }
  if (requiresSupabase) {
    return Promise.reject(new Error("Configura Supabase antes de publicar la aplicación"));
  }
  return fetch(`/api/${endpoint}`, options);
}

const defaultServices = [
  { name: "Corte", price: 20000, minutes: 30 },
  { name: "Corte con Barba", price: 25000, minutes: 30 },
  { name: "Cerquicovi", price: 12000, minutes: 15 },
  { name: "Barba", price: 5000, minutes: 5 },
  { name: "Cejas", price: 5000, minutes: 5 },
  { name: "Figuras", price: 3000, minutes: 5 },
  { name: "Cerquillo", price: 5000, minutes: 5 }
];
let SERVICES = loadServices();
let currentStaff = null;
let editingBarberId = null;
let calendarDate = new Date();
let selectedCalendarDate = today;

const defaultBarbers = [
  { id: 1, name: "Andrés", username: "andres", phone: "", active: true },
  { id: 2, name: "Diego", username: "diego", phone: "", active: true },
  { id: 3, name: "Mateo", username: "mateo", phone: "", active: true }
];
let barbers = loadBarbers();

const sampleAppointments = [
  { id: 1, client: "Juan Gómez", phone: "573001234567", service: "Corte", price: 20000, barber: "Andrés", date: today, time: "09:30", status: "pending", notes: "" },
  { id: 2, client: "Santiago Ruiz", phone: "573109876543", service: "Corte con Barba", price: 25000, barber: "Diego", date: today, time: "11:00", status: "pending", notes: "" },
  { id: 3, client: "Mateo Díaz", phone: "573201112233", service: "Barba", price: 5000, barber: "Mateo", date: today, time: "14:30", status: "completed", notes: "" }
];

let appointments = loadAppointments();
let blockedSlots = [];
const defaultSchedule = [
  { day: 1, enabled: true, open: "08:00", close: "19:00" },
  { day: 2, enabled: true, open: "08:00", close: "19:00" },
  { day: 3, enabled: true, open: "08:00", close: "19:00" },
  { day: 4, enabled: true, open: "08:00", close: "19:00" },
  { day: 5, enabled: true, open: "08:00", close: "19:00" },
  { day: 6, enabled: true, open: "08:00", close: "19:00" },
  { day: 0, enabled: false, open: "08:00", close: "19:00" }
];
let schedule = loadSchedule();
let sharedStateChannel = null;
let sharedStateFingerprint = "";
let sharedSyncInFlight = null;
let sharedStateAuthenticated = false;
let sharedSyncSucceeded = false;
let sharedSyncTimer = null;

function loadSchedule() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCHEDULE_KEY));
    if (Array.isArray(saved) && saved.length === 7 && saved.every((day, index) =>
      day.day === defaultSchedule[index].day &&
      typeof day.open === "string" &&
      typeof day.close === "string"
    )) {
      return saved.map(day => ({ ...day, enabled: day.enabled !== false }));
    }
  } catch (error) {
    console.error("No se pudo cargar el horario semanal", error);
  }
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(defaultSchedule));
  return defaultSchedule.map(day => ({ ...day }));
}

const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function renderSchedule() {
  const grid = document.getElementById("scheduleGrid");
  if (!grid) return;
  grid.innerHTML = schedule.map(day => `
    <article class="schedule-day ${day.enabled ? "" : "closed"}" data-schedule-day="${day.day}">
      <label><input type="checkbox" data-schedule-enabled ${day.enabled ? "checked" : ""}> <strong>${dayNames[day.day]}</strong></label>
      <div class="schedule-day-times">
        <label>Abre<input type="time" data-schedule-open value="${day.open}" ${day.enabled ? "" : "disabled"}></label>
        <label>Cierra<input type="time" data-schedule-close value="${day.close}" ${day.enabled ? "" : "disabled"}></label>
      </div>
    </article>`).join("");
}

function loadServices() {
  try {
    const saved = JSON.parse(localStorage.getItem(SERVICES_KEY));
    if (Array.isArray(saved) && saved.length) {
      return saved.map(service => normalizeService(service)).filter(Boolean);
    }
  } catch (error) {
    console.error("No se pudieron cargar los servicios guardados", error);
  }
  localStorage.setItem(SERVICES_KEY, JSON.stringify(defaultServices));
  return [...defaultServices];
}

function normalizeService(service) {
  const name = String(service?.name || "").trim();
  const price = Number(service?.price);
  const minutes = Number(service?.minutes);
  if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(minutes) || minutes <= 0) return null;
  return { name, price, minutes };
}

function loadBarbers() {
  const saved = localStorage.getItem(BARBERS_KEY);
  if (!saved) {
    localStorage.setItem(BARBERS_KEY, JSON.stringify(defaultBarbers));
    return [...defaultBarbers];
  }
  return JSON.parse(saved);
}

function saveBarbers() {
  localStorage.setItem(BARBERS_KEY, JSON.stringify(barbers));
  renderBarbers();
  updateBarberSelects();
  renderBlockedHours();
  saveSharedState();
}

function saveServices() {
  localStorage.setItem(SERVICES_KEY, JSON.stringify(SERVICES));
  renderServices();
  renderLandingServices();
  renderSchedule();
  refreshServicePickers();
  saveSharedState();
}

function activeBarbers() {
  return barbers.filter(barber => barber.active !== false);
}

function updateBarberSelects() {
  document.querySelectorAll('#publicBookingForm [name="barber"], #appointmentForm [name="barber"]').forEach(select => {
    select.innerHTML = activeBarbers().map(barber => `<option value="${escapeHtml(barber.name)}">${escapeHtml(barber.name)}</option>`).join("");
  });
}

function renderBarbers() {
  const grid = document.getElementById("barberGrid");
  grid.innerHTML = barbers.length ? barbers.map(barber => `
    <article class="barber-card">
      <div class="avatar">${escapeHtml(barber.name.charAt(0).toUpperCase())}</div>
      <strong>${escapeHtml(barber.name)}</strong>
      <span>Usuario: ${escapeHtml(barber.username)}</span><br>
      <span>${barber.active === false ? "Inactivo" : "Disponible"}</span>
      <div class="barber-card-actions">
        <button class="action-button" data-edit-barber="${barber.id}">Editar</button>
        <button class="action-button" data-toggle-barber="${barber.id}">${barber.active === false ? "Activar" : "Desactivar"}</button>
        <button class="danger-button" data-delete-barber="${barber.id}">Eliminar</button>
      </div>
    </article>`).join("") : '<div class="empty">No hay barberos registrados.</div>';
}

function renderServices() {
    const grid = document.getElementById("serviceGrid");
    if (!grid) return;
    grid.innerHTML = SERVICES.map((service, index) => `
      <article class="service-admin-card">
        <form class="form-grid" data-service-form="${index}">
          <label>Nombre del servicio
            <input name="serviceName" value="${escapeHtml(service.name)}" required maxlength="60">
          </label>
          <label>Costo (COP)
            <input name="servicePrice" type="number" min="0" step="100" value="${service.price}" required>
          </label>
          <button class="primary-button" type="submit">Guardar cambios</button>
        </form>
      </article>`).join("");
}

function loadAppointments() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleAppointments));
    return [...sampleAppointments];
  }
  return JSON.parse(saved).map(normalizeAppointmentTime);
}

function normalizeAppointmentTime(appointment) {
  if (!appointment) return appointment;
  return { ...appointment, time: minutesToTime(timeToMinutes(String(appointment.time))) };
}

function saveAppointments() {
  appointments = appointments.map(normalizeAppointmentTime);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
  saveSharedState();
}

async function saveSharedState() {
  try {
    const response = await apiFetch("state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointments, barbers, services: SERVICES, schedule, blockedSlots })
    });
    if (!response.ok) throw new Error("No se pudo guardar el estado compartido");
    await response.json();
    sharedStateChannel?.postMessage({ updatedAt: Date.now() });
    return true;
  } catch (error) {
    console.error("No se pudo sincronizar con el servidor", error);
    showToast("No se pudo sincronizar con la nube");
    return false;
  }
}

async function syncSharedState() {
  const requestIsStaff = Boolean(sessionToken);
  if (sharedSyncInFlight) {
    await sharedSyncInFlight;
    if (sharedSyncSucceeded && requestIsStaff !== sharedStateAuthenticated) return syncSharedState();
    return;
  }

  const syncRequest = (async () => {
    try {
      const response = await apiFetch("state", { cache: "no-store" });
      if (!response.ok) throw new Error("Estado no disponible");
      const shared = await response.json();
      const fingerprint = JSON.stringify(shared);
      sharedStateAuthenticated = requestIsStaff;
      sharedSyncSucceeded = true;
      if (fingerprint === sharedStateFingerprint) return;
      sharedStateFingerprint = fingerprint;
      const previousServices = JSON.stringify(SERVICES);
      appointments = Array.isArray(shared.appointments) ? shared.appointments.map(normalizeAppointmentTime) : appointments;
      barbers = Array.isArray(shared.barbers) ? shared.barbers : barbers;
      if (Array.isArray(shared.services)) {
        SERVICES = shared.services.map(service => normalizeService(service)).filter(Boolean);
        localStorage.setItem(SERVICES_KEY, JSON.stringify(SERVICES));
      }
      blockedSlots = Array.isArray(shared.blockedSlots)
        ? shared.blockedSlots.map(slot => ({ ...slot, time: minutesToTime(timeToMinutes(slot.time)) }))
        : blockedSlots;
      if (Array.isArray(shared.schedule) && shared.schedule.length === 7) {
        schedule = shared.schedule;
        localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
      localStorage.setItem(BARBERS_KEY, JSON.stringify(barbers));
      render();
      renderBarbers();
      renderServices();
      renderLandingServices();
      updateBarberSelects();
      if (JSON.stringify(SERVICES) !== previousServices) refreshServicePickers();
      renderBlockedHours();
      renderSchedule();
      refreshBookingAvailability();
    } catch (error) {
      sharedSyncSucceeded = false;
      console.error("Usando datos locales", error);
    }
  })();
  sharedSyncInFlight = syncRequest;
  try {
    await syncRequest;
  } finally {
    if (sharedSyncInFlight === syncRequest) sharedSyncInFlight = null;
  }
}

function initializeSharedSync() {
  if ("BroadcastChannel" in window) {
    sharedStateChannel = new BroadcastChannel("barberiaSharedState");
    sharedStateChannel.addEventListener("message", syncSharedState);
  }

  window.addEventListener("storage", event => {
    if ([STORAGE_KEY, BARBERS_KEY, SERVICES_KEY, SCHEDULE_KEY].includes(event.key)) syncSharedState();
  });

  if (!sharedSyncTimer) {
    sharedSyncTimer = setInterval(syncSharedState, 15000);
  }
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function appointmentDateTime(appointment) {
  const minutes = timeToMinutes(appointment.time);
  return new Date(`${appointment.date}T${minutesTo24Hours(minutes)}:00`);
}

function formatLongDate(dateString) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
}

function statusLabel(status) {
  return { pending: "Pendiente", completed: "Completada", cancelled: "Cancelada" }[status];
}

function render() {
  if (!currentStaff) return;
  const visibleAppointments = currentStaff?.role === "barber"
    ? appointments.filter(item => item.barber === currentStaff.barber)
    : appointments;
  const todayAppointments = visibleAppointments.filter(item => item.date === today && item.status !== "cancelled");
  document.getElementById("todayCount").textContent = todayAppointments.length;
  document.getElementById("pendingCount").textContent = visibleAppointments.filter(item => item.status === "pending").length;
  document.getElementById("completedCount").textContent = visibleAppointments.filter(item => item.status === "completed" && item.date === today).length;
  document.getElementById("todayRevenue").textContent = currency.format(visibleAppointments.filter(item => item.status === "completed" && item.date === today).reduce((sum, item) => sum + item.price, 0));

  renderUpcoming();
  renderReminders();
  renderTable();
  renderClients();
  renderDailyRevenue();
}

function renderDailyRevenue() {
  const dateInput = document.getElementById("dailyRevenueDate");
  if (!dateInput) return;
  if (!dateInput.value) dateInput.value = today;

  const completed = appointments.filter(item =>
    item.status === "completed" &&
    item.date === dateInput.value
  );
  const total = completed.reduce((sum, item) => sum + Number(item.price || 0), 0);
  document.getElementById("dailyRevenueTotal").textContent = currency.format(total);
  document.getElementById("dailyRevenueCount").textContent = completed.length;

  const list = document.getElementById("dailyRevenueList");
  list.innerHTML = completed.length ? completed
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .map(item => `
      <article class="daily-revenue-item">
        <div class="daily-revenue-client">
          <strong>${escapeHtml(item.client)}</strong>
          <span>${escapeHtml(item.service)} · ${escapeHtml(item.barber)}</span>
        </div>
        <span class="daily-revenue-time">${escapeHtml(formatTime12Hours(item.time))}</span>
        <strong class="daily-revenue-price">${currency.format(item.price)}</strong>
      </article>
    `).join("") : '<div class="empty">No hay servicios completados en esta fecha.</div>';
}

function renderUpcoming() {
  const list = document.getElementById("upcomingList");
  const baseAppointments = currentStaff?.role === "barber"
    ? appointments.filter(item => item.barber === currentStaff.barber)
    : appointments;
  const upcoming = baseAppointments
    .filter(item => item.status === "pending" && appointmentDateTime(item) >= new Date())
    .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b))
    .slice(0, 5);
  list.innerHTML = upcoming.length ? upcoming.map(item => `
    <div class="appointment-item">
      <div class="time-block"><strong>${escapeHtml(formatTime12Hours(item.time))}</strong><span>${formatLongDate(item.date)}</span></div>
      <div class="appointment-info"><strong>${escapeHtml(item.client)}</strong><span>${escapeHtml(item.service)} · ${escapeHtml(item.barber)}</span></div>
      <span class="status ${item.status}">${statusLabel(item.status)}</span>
    </div>`).join("") : '<div class="empty">No hay próximas citas pendientes.</div>';
}

function reminderText(item) {
  const date = formatLongDate(item.date);
  return `Hola ${item.client}, te recordamos tu cita en Adrian Barber: ${item.service}, el ${date} a las ${item.time}. La cita inicia en aproximadamente 30 minutos. Por favor llega 15 minutos antes de la hora reservada. Si ya no puedes asistir, responde CANCELAR. ¡Te esperamos!`;
}

function normalizedWhatsAppPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("57") ? digits : `57${digits}`;
}

function renderReminders() {
  const list = document.getElementById("reminderList");
  const baseAppointments = currentStaff?.role === "barber"
    ? appointments.filter(item => item.barber === currentStaff.barber)
    : appointments;
  const reminders = baseAppointments
    .filter(item => item.status === "pending" && appointmentDateTime(item) >= new Date())
    .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b))
    .slice(0, 5);
  list.innerHTML = reminders.length ? reminders.map(item => {
    return `<div class="reminder">
      <div><strong>${escapeHtml(item.client)}</strong><span>${formatLongDate(item.date)} · ${escapeHtml(formatTime12Hours(item.time))}</span></div>
      <span class="whatsapp-button">${item.reminder30Sent ? "Recordatorio enviado" : "Envío automático en 30 min"}</span>
    </div>`;
  }).join("") : '<div class="empty">No hay recordatorios pendientes.</div>';
}

function renderTable() {
  const query = document.getElementById("appointmentSearch").value.toLowerCase();
  const baseAppointments = currentStaff?.role === "barber"
    ? appointments.filter(item => item.barber === currentStaff.barber)
    : appointments;
  const rows = baseAppointments
    .filter(item => item.client.toLowerCase().includes(query))
    .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));
  document.getElementById("appointmentsTable").innerHTML = rows.length ? rows.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.client)}</strong></td><td>${escapeHtml(item.service)}</td><td>${escapeHtml(item.barber)}</td>
      <td>${formatLongDate(item.date)}</td><td>${escapeHtml(formatTime12Hours(item.time))}</td>
      <td><span class="status ${item.status}">${statusLabel(item.status)}</span></td>
      <td>
        ${item.status !== "completed" ? `<button class="action-button" data-complete="${item.id}" title="Completar">✓</button>` : ""}
        ${item.status !== "cancelled" ? `<button class="action-button" data-cancel="${item.id}" title="Cancelar">×</button>` : ""}
      </td>
    </tr>`).join("") : '<tr><td colspan="7" class="empty">No se encontraron citas.</td></tr>';
}

function renderClients() {
  const clients = [...new Map(appointments.map(item => [item.phone, item])).values()];
  document.getElementById("clientGrid").innerHTML = clients.map(item => {
    const visits = appointments.filter(a => a.phone === item.phone && a.status === "completed").length;
    return `<article class="client-card"><div class="avatar">${escapeHtml(item.client.charAt(0).toUpperCase())}</div>
      <strong>${escapeHtml(item.client)}</strong><span>${escapeHtml(item.phone)}</span><br><span>${visits} visita${visits === 1 ? "" : "s"} completada${visits === 1 ? "" : "s"}</span></article>`;
  }).join("");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function setupServicePickers() {
  document.querySelectorAll("[data-service-picker]").forEach(picker => {
    picker.insertAdjacentHTML("beforeend", `<div class="service-options">${SERVICES.map(service => `
      <label class="service-option">
        <input type="checkbox" name="service" value="${service.name}|${service.price}|${service.minutes}">
        <span><strong>${service.name}</strong><small>${currency.format(service.price)} · ${service.minutes} min</small></span>
      </label>`).join("")}</div>`);
  });

  document.querySelectorAll("[data-service-picker]").forEach(picker => {
    picker.addEventListener("change", () => updateServiceTotal(picker.closest("form")));
  });
  document.querySelectorAll("#publicBookingForm, #appointmentForm").forEach(form => {
    ["barber", "date"].forEach(name => {
      form.elements[name].addEventListener("change", () => updateAvailability(form));
    });
  });
}

function refreshServicePickers() {
  document.querySelectorAll("[data-service-picker]").forEach(picker => {
    picker.querySelector(".service-options")?.remove();
    picker.insertAdjacentHTML("beforeend", `<div class="service-options">${SERVICES.map(service => `
      <label class="service-option">
        <input type="checkbox" name="service" value="${escapeHtml(service.name)}|${service.price}|${service.minutes}">
        <span><strong>${escapeHtml(service.name)}</strong><small>${currency.format(service.price)} · ${service.minutes} min</small></span>
      </label>`).join("")}</div>`);
  });
}

function renderLandingServices() {
  const grid = document.querySelector(".landing-service-grid");
  if (!grid) return;
  grid.innerHTML = SERVICES.slice(0, 4).map((service, index) => `
    <article>
      <span>${String(index + 1).padStart(2, "0")}</span>
      <h3>${escapeHtml(service.name)}</h3>
      <p>${service.minutes} minutos</p>
      <strong>${currency.format(service.price)}</strong>
    </article>`).join("");
}

function getSelectedServices(form) {
  const selected = [...form.querySelectorAll('[name="service"]:checked')];
  return selected.map(input => {
    const [name, price, minutes] = input.value.split("|");
    return { name, price: Number(price), minutes: Number(minutes) };
  });
}

function updateServiceTotal(form) {
  const selected = getSelectedServices(form);
  const total = selected.reduce((sum, service) => sum + service.price, 0);
  form.querySelector("[data-service-total]").textContent = currency.format(total);
  updateAvailability(form);
}

function minutesToTime(minutes) {
  const hours24 = Math.floor(minutes / 60);
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes % 60).padStart(2, "0")} ${period}`;
}

function formatTime12Hours(time) {
  return minutesToTime(timeToMinutes(time));
}

function timeToMinutes(time) {
  const value = String(time || "").trim().toLowerCase();
  const match = value.match(/^(\d{1,2}):(\d{2})(?:\s*(a\.?\s*m\.?|p\.?\s*m\.?))?$/i);
  if (!match) return 0;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3]?.replace(/\s/g, "").replace(/\./g, "");
  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function minutesTo24Hours(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function getServiceDuration(serviceNames) {
  return serviceNames.reduce((total, name) => {
    const service = SERVICES.find(item => item.name === name);
    return total + (service?.minutes || 30);
  }, 0);
}

function appointmentDuration(appointment) {
  if (appointment.duration) return appointment.duration;
  return getServiceDuration(appointment.service.split(" + "));
}

function updateAvailability(form) {
  const barber = form.elements.barber?.value;
  const date = form.elements.date?.value;
  const timeSelect = form.elements.time;
  const selectedServices = getSelectedServices(form);
  const note = form.querySelector("[data-availability-note]");
  if (!barber || !date || !selectedServices.length || !timeSelect) {
    if (note) note.textContent = "Selecciona barbero, fecha y servicios para ver disponibilidad.";
    return;
  }

  const duration = selectedServices.reduce((sum, item) => sum + item.minutes, 0);
  const occupied = appointments
    .filter(item => item.date === date && item.barber === barber && item.status !== "cancelled")
    .map(item => ({ start: timeToMinutes(item.time), end: timeToMinutes(item.time) + appointmentDuration(item) }));
  const blocked = blockedSlots
    .filter(item => item.date === date && item.barber === barber)
    .map(item => timeToMinutes(item.time));
  const previousValue = timeSelect.value;
  timeSelect.innerHTML = '<option value="">Selecciona una hora</option>';
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const daySchedule = schedule.find(day => day.day === weekday);
  if (!daySchedule?.enabled) {
    note.className = "availability-note busy";
    note.textContent = "La barbería permanece cerrada este día.";
    return;
  }
  const openingTime = timeToMinutes(daySchedule.open);
  const closingTime = timeToMinutes(daySchedule.close);

  for (let time = openingTime; time + duration <= closingTime; time += 15) {
    const end = time + duration;
    const blockedConflict = blocked.some(blockedTime => blockedTime >= time && blockedTime < end);
    const conflict = blockedConflict || occupied.some(item => time < item.end && end > item.start);
    const option = document.createElement("option");
    option.value = minutesToTime(time);
    option.textContent = `${formatTime12Hours(minutesToTime(time))}${blockedConflict ? " - Bloqueada" : occupied.some(item => time < item.end && end > item.start) ? " - Reservada" : ""}`;
    option.disabled = conflict;
    timeSelect.appendChild(option);
  }

  if ([...timeSelect.options].some(option => option.value === previousValue && !option.disabled)) {
    timeSelect.value = previousValue;
  }
  const availableCount = [...timeSelect.options].filter(option => option.value && !option.disabled).length;
  note.className = `availability-note ${availableCount ? "free" : "busy"}`;
  note.textContent = availableCount
    ? `${availableCount} horarios disponibles · Duración estimada: ${duration} min`
    : "No hay horarios disponibles para esta duración. Elige otra fecha, barbero o servicios.";
}

function refreshBookingAvailability() {
  document.querySelectorAll("#publicBookingForm, #appointmentForm").forEach(form => {
    updateAvailability(form);
  });
}

function hasAppointmentConflict(form) {
  const selectedServices = getSelectedServices(form);
  if (!form.elements.time.value) return false;
  const start = timeToMinutes(form.elements.time.value);
  const end = start + selectedServices.reduce((sum, item) => sum + item.minutes, 0);
  const weekday = new Date(`${form.elements.date.value}T12:00:00`).getDay();
  const daySchedule = schedule.find(day => day.day === weekday);
  if (!daySchedule?.enabled ||
    start < timeToMinutes(daySchedule.open) ||
    end > timeToMinutes(daySchedule.close)) {
    return true;
  }
  const isBlocked = blockedSlots.some(item =>
    item.date === form.elements.date.value &&
    item.barber === form.elements.barber.value &&
    timeToMinutes(item.time) >= start &&
    timeToMinutes(item.time) < end
  );
  if (isBlocked) return true;
  return appointments.some(item => {
    if (item.date !== form.elements.date.value || item.barber !== form.elements.barber.value || item.status === "cancelled") return false;
    const itemStart = timeToMinutes(item.time);
    const itemEnd = itemStart + appointmentDuration(item);
    return start < itemEnd && end > itemStart;
  });
}

function staffAppointments() {
  return currentStaff?.role === "barber"
    ? appointments.filter(item => item.barber === currentStaff.barber)
    : appointments;
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  document.getElementById("calendarMonth").textContent = calendarDate.toLocaleDateString("es-CO", { month: "long", year: "numeric" });
  const monthSelect = document.getElementById("calendarMonthSelect");
  const yearSelect = document.getElementById("calendarYearSelect");
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  if (!monthSelect.options.length) {
    monthSelect.innerHTML = monthNames.map((name, index) => `<option value="${index}">${name}</option>`).join("");
  }
  if (!yearSelect.options.length) {
    const years = [];
    for (let optionYear = year - 3; optionYear <= year + 6; optionYear++) years.push(optionYear);
    yearSelect.innerHTML = years.map(optionYear => `<option value="${optionYear}">${optionYear}</option>`).join("");
  }
  monthSelect.value = String(month);
  yearSelect.value = String(year);
  const firstDay = new Date(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);
  const cells = [];
  for (let index = 0; index < 42; index++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const dayAppointments = staffAppointments().filter(item => item.date === dateKey && item.status !== "cancelled").sort((a, b) => a.time.localeCompare(b.time));
    const classes = ["calendar-day"];
    if (day.getMonth() !== month) classes.push("outside");
    if (dateKey === today) classes.push("today");
    if (dateKey === selectedCalendarDate) classes.push("selected");
    if (dayAppointments.length) classes.push("has-appointments");
    cells.push(`<button class="${classes.join(" ")}" style="grid-column:${index % 7 + 1};grid-row:${Math.floor(index / 7) + 1}" data-calendar-date="${dateKey}">
      <span class="day-number">${day.getDate()}</span>
      <span class="day-appointments">${dayAppointments.length ? `${dayAppointments.length} reservada${dayAppointments.length === 1 ? "" : "s"}` : ""}</span>
      ${dayAppointments.slice(0, 2).map(item => `<span class="day-reservation">${formatTime12Hours(item.time)} · ${escapeHtml(item.client)}</span>`).join("")}
    </button>`);
  }
  document.getElementById("calendarGrid").innerHTML = cells.join("");
  renderCalendarDay();
}

function renderCalendarDay() {
  const selected = new Date(`${selectedCalendarDate}T12:00:00`);
  document.getElementById("selectedDayTitle").textContent = selected.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const dayAppointments = staffAppointments().filter(item => item.date === selectedCalendarDate && item.status !== "cancelled").sort((a, b) => a.time.localeCompare(b.time));
  document.getElementById("calendarDayAppointments").innerHTML = dayAppointments.length ? dayAppointments.map(item => `
    <div class="calendar-time-item">
      <strong>${escapeHtml(formatTime12Hours(item.time))}</strong>
      <div><strong>${escapeHtml(item.client)}</strong><br><span>${escapeHtml(item.service)} · ${escapeHtml(item.barber)}</span></div>
    </div>`).join("") : '<div class="empty">No hay citas reservadas para este día.</div>';
  renderBlockedHours();
}

document.getElementById("newAppointment").addEventListener("click", openAppointmentDialog);
document.getElementById("newAppointmentSide").addEventListener("click", openAppointmentDialog);
document.getElementById("appointmentSearch").addEventListener("input", renderTable);

function openAppointmentDialog() {
  const form = document.getElementById("appointmentForm");
  form.elements.date.value = today;
  form.elements.date.min = today;
  document.getElementById("appointmentDialog").showModal();
  document.getElementById("sidebar").classList.remove("open");
}

document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => {
  document.getElementById("appointmentDialog").close();
}));

document.getElementById("appointmentForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const selectedServices = getSelectedServices(form);
  if (!selectedServices.length) {
    showToast("Selecciona al menos un servicio");
    return;
  }
  if (!form.elements.time.value || hasAppointmentConflict(form)) {
    showToast("Selecciona una hora disponible");
    updateAvailability(form);
    return;
  }
  appointments.push({
    id: Date.now(), client: data.get("client").trim(), phone: data.get("phone").replace(/\D/g, ""),
    service: selectedServices.map(item => item.name).join(" + "), price: selectedServices.reduce((sum, item) => sum + item.price, 0), barber: data.get("barber"), date: data.get("date"),
    time: data.get("time"), notes: data.get("notes").trim(), status: "pending"
  });
  saveAppointments();
  form.reset();
  document.getElementById("appointmentDialog").close();
  render();
  showToast("Cita confirmada. Recuerda llegar 15 minutos antes");
});

document.getElementById("appointmentsTable").addEventListener("click", event => {
  const completeId = event.target.dataset.complete;
  const cancelId = event.target.dataset.cancel;
  if (completeId || cancelId) {
    const appointment = appointments.find(item => item.id === Number(completeId || cancelId));
    appointment.status = completeId ? "completed" : "cancelled";
    saveAppointments();
    render();
    showToast(completeId ? "Cita completada" : "Cita cancelada");
  }
});

function setView(viewName) {
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === viewName));
  document.getElementById(`${viewName}View`).classList.add("active");
  document.getElementById("pageTitle").textContent = { dashboard: "Panel principal", appointments: "Citas", calendar: "Calendario", clients: "Clientes", barbers: "Barberos", services: "Servicios", schedule: "Horarios de atención" }[viewName];
  if (viewName === "calendar") renderCalendar();
  document.getElementById("sidebar").classList.remove("open");
}

document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll("[data-view-link]").forEach(button => button.addEventListener("click", () => setView(button.dataset.viewLink)));
document.getElementById("menuButton").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("dailyRevenueDate").addEventListener("change", renderDailyRevenue);
document.getElementById("calendarGrid").addEventListener("click", event => {
  const day = event.target.closest("[data-calendar-date]");
  if (!day) return;
  selectedCalendarDate = day.dataset.calendarDate;
  const blockedDate = document.getElementById("blockedDate");
  if (blockedDate) blockedDate.value = selectedCalendarDate;
  renderCalendar();
});
document.getElementById("previousMonth").addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
  renderCalendar();
});
document.getElementById("calendarMonthSelect").addEventListener("change", event => {
  calendarDate = new Date(calendarDate.getFullYear(), Number(event.target.value), 1);
  renderCalendar();
});
document.getElementById("calendarYearSelect").addEventListener("change", event => {
  calendarDate = new Date(Number(event.target.value), calendarDate.getMonth(), 1);
  renderCalendar();
});
function renderBlockedHours() {
  const barberSelect = document.getElementById("blockedBarber");
  const previousBarber = barberSelect.value;
  barberSelect.innerHTML = activeBarbers().map(barber =>
    `<option value="${escapeHtml(barber.name)}">${escapeHtml(barber.name)}</option>`
  ).join("");
  if ([...barberSelect.options].some(option => option.value === previousBarber)) barberSelect.value = previousBarber;
  const dateInput = document.getElementById("blockedDate");
  dateInput.min = today;
  if (!dateInput.value) dateInput.value = selectedCalendarDate;
  const date = dateInput.value || selectedCalendarDate;
  renderBlockedTimeOptions(date);
  const slots = blockedSlots
    .filter(item => item.date === date)
    .sort((a, b) => a.barber.localeCompare(b.barber) || a.time.localeCompare(b.time));
  document.getElementById("blockedHoursList").innerHTML = slots.length ? slots.map(slot => `
    <div class="blocked-hour">
      <span><strong>${escapeHtml(formatTime12Hours(slot.time))}</strong> · ${escapeHtml(slot.barber)}</span>
      <button type="button" class="action-button" data-unblock-slot="${slot.id}">Desbloquear</button>
    </div>`).join("") : '<p class="blocked-hours-empty">No hay horas bloqueadas este día.</p>';
}

function renderBlockedTimeOptions(date) {
  const timeSelect = document.getElementById("blockedTime");
  const previousValue = timeSelect.value;
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const daySchedule = schedule.find(day => day.day === weekday);
  timeSelect.innerHTML = '<option value="">Selecciona hora</option>';
  if (!daySchedule?.enabled) return;

  for (let time = timeToMinutes(daySchedule.open); time <= timeToMinutes(daySchedule.close); time += 15) {
    const value = minutesToTime(time);
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatTime12Hours(value);
    timeSelect.appendChild(option);
  }
  if ([...timeSelect.options].some(option => option.value === previousValue)) timeSelect.value = previousValue;
}

document.getElementById("blockHourButton").addEventListener("click", () => {
  if (currentStaff?.role !== "admin") return;
  const barber = document.getElementById("blockedBarber").value;
  const date = document.getElementById("blockedDate").value;
  const time = document.getElementById("blockedTime").value;
  if (!barber || !date || !time) {
    showToast("Selecciona barbero, fecha y hora");
    return;
  }
  if (blockedSlots.some(item => item.barber === barber && item.date === date && item.time === time)) {
    showToast("Ese horario ya está bloqueado");
    return;
  }
  blockedSlots.push({ id: Date.now(), barber, date, time });
  saveSharedState();
  renderBlockedHours();
  renderCalendar();
  showToast("Horario bloqueado");
});

document.getElementById("blockedDate").addEventListener("change", () => {
  renderBlockedTimeOptions(document.getElementById("blockedDate").value);
  renderBlockedHours();
});

document.getElementById("blockedHoursList").addEventListener("click", event => {
  const slotId = Number(event.target.dataset.unblockSlot);
  if (!slotId) return;
  blockedSlots = blockedSlots.filter(item => item.id !== slotId);
  saveSharedState();
  renderBlockedHours();
  renderCalendar();
  showToast("Horario desbloqueado");
});

let selectedStaffRole = null;

const LANDING_IMAGES = [
  "adrian-1.jpeg",
  "adrian-2.jpeg",
  "adrian-3.jpeg",
  "adrian-4.jpeg",
  "adrian-5.jpeg",
  "adrian-6.jpeg",
  "adrian-7.jpeg"
];

class LandingSlider {
  constructor(container) {
    this.container = container;
    this.index = 0;
    this.timer = null;
    this.build();
    this.bind();
    this.play();
  }

  build() {
    this.container.innerHTML = LANDING_IMAGES.map((file, index) => `
      <figure class="slide${index === 0 ? " active" : ""}" aria-hidden="${index === 0 ? "false" : "true"}">
        ${index === 0
          ? `<img src="img/${file}" alt="Trabajo realizado en Adrian Barber" decoding="async" fetchpriority="high">`
          : `<img data-src="img/${file}" alt="" decoding="async" loading="lazy">`}
      </figure>`).join("") + `<div class="slider-dots">${LANDING_IMAGES.map((_, index) =>
      `<button class="slider-dot${index === 0 ? " active" : ""}" type="button" aria-label="Ver imagen ${index + 1}" data-slide="${index}"></button>`).join("")}</div>`;
    this.slides = [...this.container.querySelectorAll(".slide")];
    this.dots = [...this.container.querySelectorAll(".slider-dot")];
  }

  bind() {
    this.dots.forEach(dot => dot.addEventListener("click", () => this.goTo(Number(dot.dataset.slide))));
  }

  goTo(index) {
    this.slides[this.index].classList.remove("active");
    this.slides[this.index].setAttribute("aria-hidden", "true");
    this.dots[this.index].classList.remove("active");
    this.index = (index + this.slides.length) % this.slides.length;
    const nextImage = this.slides[this.index].querySelector("img[data-src]");
    if (nextImage) {
      nextImage.src = nextImage.dataset.src;
      nextImage.removeAttribute("data-src");
    }
    this.slides[this.index].classList.add("active");
    this.slides[this.index].setAttribute("aria-hidden", "false");
    this.dots[this.index].classList.add("active");
  }

  play() {
    if (this.timer) return;
    this.timer = setInterval(() => this.goTo(this.index + 1), 2800);
  }

  pause() {
    return;
  }
}

const heroSlider = document.getElementById("heroSlider");
if (heroSlider) new LandingSlider(heroSlider);

function showLanding() {
  document.getElementById("landingPage").hidden = false;
  document.getElementById("authScreen").hidden = true;
  document.getElementById("publicBooking").hidden = true;
}

document.getElementById("landingBookButton").addEventListener("click", () => {
  document.getElementById("landingPage").hidden = true;
  document.getElementById("publicBooking").hidden = false;
  const dateInput = document.querySelector("#publicBookingForm [name=date]");
  dateInput.min = today;
  dateInput.value = today;
});

document.getElementById("showStaffLogin").addEventListener("click", () => {
  document.getElementById("landingPage").hidden = true;
  document.getElementById("authScreen").hidden = false;
});

document.getElementById("shareBookingLink").addEventListener("click", async () => {
  const message = "Bienvenido a 🔥ADRIAN BARBER💈, es un gusto atenderte. ¡A través del siguiente link puedes agendar tu cita!";
  const bookingUrl = window.location.href;
  const shareData = { title: "ADRIAN BARBER", text: `${message}\n${bookingUrl}` };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(`${message}\n${bookingUrl}`)}`, "_blank", "noopener,noreferrer");
});

document.getElementById("staffHomeButton").addEventListener("click", showLanding);

document.querySelectorAll(".role-card").forEach(button => {
  button.addEventListener("click", () => {
    if (button.dataset.role === "client") {
      document.getElementById("authScreen").hidden = true;
      document.getElementById("publicBooking").hidden = false;
      const dateInput = document.querySelector("#publicBookingForm [name=date]");
      dateInput.min = today;
      dateInput.value = today;
      return;
    }

    selectedStaffRole = button.dataset.role;
    document.querySelector(".role-selector").hidden = true;
    document.querySelector(".auth-card > .eyebrow").hidden = true;
    document.querySelector(".auth-card > h1").textContent = selectedStaffRole === "admin" ? "Acceso administrador" : "Acceso barbero";
    document.getElementById("staffLoginForm").hidden = false;
    document.getElementById("loginHint").textContent = "";
  });
});

document.getElementById("backRoles").addEventListener("click", () => {
  document.querySelector(".role-selector").hidden = false;
  document.querySelector(".auth-card > .eyebrow").hidden = false;
  document.querySelector(".auth-card > h1").textContent = "¿Cómo quieres ingresar?";
  document.getElementById("staffLoginForm").hidden = true;
});

document.getElementById("staffLoginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const username = data.get("username").trim();
  const password = data.get("password");
  let account = null;
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Ingresando...";
  document.getElementById("loginHint").textContent = "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await apiFetch("login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: selectedStaffRole, username, password }),
      signal: controller.signal
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Usuario o contraseña incorrectos");
    account = result;
  } catch (error) {
    document.getElementById("loginHint").textContent =
      error.name === "AbortError"
        ? "El servidor tardó demasiado. Verifica la conexión e inténtalo de nuevo."
        : error.message;
    return;
  } finally {
    clearTimeout(timeoutId);
    submitButton.disabled = false;
    submitButton.textContent = "Ingresar";
  }

  if (!account) {
    document.getElementById("loginHint").textContent = "Usuario o contraseña incorrectos.";
    return;
  }

  currentStaff = account;
  sessionToken = account.token || null;
  sharedStateFingerprint = "";
  await syncSharedState();
  if (account.token && (!sharedSyncSucceeded || !sharedStateAuthenticated)) {
    currentStaff = null;
    sessionToken = null;
    document.getElementById("loginHint").textContent = "No se pudo cargar de forma segura la información del equipo.";
    return;
  }
  document.getElementById("authScreen").hidden = true;
  document.getElementById("appShell").hidden = false;
  document.body.classList.add("admin-mode");
  document.querySelectorAll(".admin-only").forEach(element => element.hidden = account.role !== "admin");
  document.getElementById("newAppointment").hidden = account.role !== "admin";
  document.getElementById("pageTitle").textContent = account.role === "admin" ? "Panel principal" : `Agenda de ${account.barber}`;
  render();
});

document.getElementById("adminPasswordForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const newPassword = String(data.get("newPassword"));
  if (newPassword !== String(data.get("confirmPassword"))) {
    showToast("Las contraseñas nuevas no coinciden");
    return;
  }
  try {
    const response = await apiFetch("login", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: String(data.get("currentPassword")),
        newPassword
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo cambiar la contraseña");
    event.currentTarget.reset();
    showToast("Contraseña del administrador actualizada");
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById("clientBack").addEventListener("click", () => {
  document.getElementById("publicBooking").hidden = true;
  document.getElementById("landingPage").hidden = false;
});

document.getElementById("publicBookingForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const selectedServices = getSelectedServices(event.currentTarget);
  if (!selectedServices.length) {
    showToast("Selecciona al menos un servicio");
    return;
  }
  if (!event.currentTarget.elements.time.value || hasAppointmentConflict(event.currentTarget)) {
    showToast("Selecciona una hora disponible");
    updateAvailability(event.currentTarget);
    return;
  }
  const appointment = {
    id: Date.now(), client: data.get("client").trim(), phone: data.get("phone").replace(/\D/g, ""),
    service: selectedServices.map(item => item.name).join(" + "), price: selectedServices.reduce((sum, item) => sum + item.price, 0), barber: data.get("barber"), date: data.get("date"),
    time: data.get("time"), notes: "Reserva creada por el cliente", status: "pending", reminder30Sent: false
  };
  if (supabaseConfig.enabled || requiresSupabase) {
    try {
      const response = await apiFetch("booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appointment)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar la reserva");
      sharedStateFingerprint = "";
      await syncSharedState();
    } catch (error) {
      showToast(error.message);
      return;
    }
  } else {
    appointments.push(appointment);
    saveAppointments();
  }
  event.currentTarget.hidden = true;
  document.getElementById("bookingSuccess").hidden = false;
  showToast("Reserva confirmada. Llegar 15 minutos antes");
});

document.getElementById("newPublicBooking").addEventListener("click", () => {
  document.getElementById("publicBookingForm").reset();
  document.querySelector("#publicBookingForm [name=date]").value = today;
  document.getElementById("publicBookingForm").hidden = false;
  document.getElementById("bookingSuccess").hidden = true;
});

document.getElementById("logoutButton").addEventListener("click", () => {
  currentStaff = null;
  sessionToken = null;
  sharedStateFingerprint = "";
  appointments = [];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
  syncSharedState();
  document.getElementById("appShell").hidden = true;
  document.body.classList.remove("admin-mode");
  showLanding();
  document.getElementById("staffLoginForm").reset();
  document.getElementById("backRoles").click();
});

document.getElementById("addBarberButton").addEventListener("click", () => openBarberDialog());
document.getElementById("scheduleGrid").addEventListener("change", event => {
  const card = event.target.closest("[data-schedule-day]");
  if (!card) return;
  const day = schedule.find(item => item.day === Number(card.dataset.scheduleDay));
  if (event.target.matches("[data-schedule-enabled]")) {
    day.enabled = event.target.checked;
    card.classList.toggle("closed", !day.enabled);
    card.querySelectorAll("[data-schedule-open], [data-schedule-close]").forEach(input => {
      input.disabled = !day.enabled;
    });
  }
});

document.getElementById("saveScheduleButton").addEventListener("click", () => {
  let valid = true;
  document.querySelectorAll("[data-schedule-day]").forEach(card => {
    const day = schedule.find(item => item.day === Number(card.dataset.scheduleDay));
    day.open = card.querySelector("[data-schedule-open]").value;
    day.close = card.querySelector("[data-schedule-close]").value;
    if (day.open >= day.close) {
      showToast(`Revisa el horario de ${dayNames[day.day]}`);
      valid = false;
    }
  });
  if (!valid) return;
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
  saveSharedState();
  refreshBookingAvailability();
  showToast("Horarios de atención guardados");
});
document.querySelectorAll("[data-close-barber]").forEach(button => button.addEventListener("click", () => document.getElementById("barberDialog").close()));

function openBarberDialog(barber = null) {
  editingBarberId = barber?.id || null;
  const form = document.getElementById("barberForm");
  form.reset();
  document.getElementById("barberDialogTitle").textContent = barber ? "Editar barbero" : "Agregar barbero";
  if (barber) {
    form.elements.name.value = barber.name;
    form.elements.username.value = barber.username;
    form.elements.password.required = false;
    form.elements.password.placeholder = "Deja en blanco para conservar";
    form.elements.phone.value = barber.phone || "";
  } else {
    form.elements.password.required = true;
    form.elements.password.placeholder = "";
  }
  document.getElementById("barberDialog").showModal();
}

document.getElementById("barberForm").addEventListener("submit", event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const username = data.get("username").trim();
  if (barbers.some(barber => barber.username.toLowerCase() === username.toLowerCase() && barber.id !== editingBarberId)) {
    showToast("Ese usuario ya está registrado");
    return;
  }
  const barberData = {
    name: data.get("name").trim(), username, password: data.get("password"),
    phone: data.get("phone").trim(), active: true
  };
  if (editingBarberId) {
    const existing = barbers.find(barber => barber.id === editingBarberId);
    const oldName = existing.name;
    Object.assign(existing, barberData);
    if (oldName !== existing.name) {
      blockedSlots.forEach(slot => {
        if (slot.barber === oldName) slot.barber = existing.name;
      });
    }
  } else {
    barbers.push({ id: Date.now(), ...barberData });
  }
  saveBarbers();
  document.getElementById("barberDialog").close();
  showToast(editingBarberId ? "Barbero actualizado" : "Barbero agregado");
  editingBarberId = null;
});

document.getElementById("barberGrid").addEventListener("click", event => {
  const editId = event.target.dataset.editBarber;
  const toggleId = event.target.dataset.toggleBarber;
  const deleteId = event.target.dataset.deleteBarber;
  if (editId) openBarberDialog(barbers.find(barber => barber.id === Number(editId)));
  if (toggleId) {
    const barber = barbers.find(item => item.id === Number(toggleId));
    barber.active = barber.active === false;
    saveBarbers();
    showToast(`Barbero ${barber.active ? "activado" : "desactivado"}`);
  }
  if (deleteId && confirm("¿Eliminar este barbero? Se eliminarán también sus citas y horarios bloqueados.")) {
    const deletedBarber = barbers.find(barber => barber.id === Number(deleteId));
    if (deletedBarber) {
      blockedSlots = blockedSlots.filter(slot => slot.barber !== deletedBarber.name);
      appointments = appointments.filter(appointment => appointment.barber !== deletedBarber.name);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
    }
    barbers = barbers.filter(barber => barber.id !== Number(deleteId));
    saveBarbers();
    render();
    showToast("Barbero eliminado");
  }
});

document.getElementById("serviceGrid").addEventListener("submit", event => {
  const form = event.target.closest("[data-service-form]");
  if (!form) return;
  event.preventDefault();
  const index = Number(form.dataset.serviceForm);
  const data = new FormData(form);
  const name = String(data.get("serviceName")).trim();
  const price = Number(data.get("servicePrice"));
  const normalized = normalizeService({ ...SERVICES[index], name, price });
  if (!normalized) {
    showToast("Completa el nombre y un costo válido");
    return;
  }
  if (SERVICES.some((service, serviceIndex) => serviceIndex !== index && service.name.toLowerCase() === name.toLowerCase())) {
    showToast("Ya existe un servicio con ese nombre");
    return;
  }
  const oldName = SERVICES[index].name;
  if (oldName !== normalized.name) {
    appointments.forEach(appointment => {
      appointment.service = String(appointment.service || "")
        .split(" + ")
        .map(serviceName => serviceName === oldName ? normalized.name : serviceName)
        .join(" + ");
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
  }
  SERVICES[index] = normalized;
  saveServices();
  saveAppointments();
  showToast("Servicio actualizado");
});

updateBarberSelects();
renderBarbers();
renderServices();
renderLandingServices();
setupServicePickers();
renderCalendar();
render();
initializeSharedSync();
syncSharedState();
