const STORAGE_KEY = "barberiaAppointments";
const BARBERS_KEY = "barberiaBarbers";
const currency = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const today = new Date().toISOString().slice(0, 10);
const SERVICES = [
  { name: "Corte", price: 20000, minutes: 30 },
  { name: "Corte con Barba", price: 25000, minutes: 30 },
  { name: "Cerquicovi", price: 12000, minutes: 15 },
  { name: "Barba", price: 5000, minutes: 5 },
  { name: "Cejas", price: 5000, minutes: 5 },
  { name: "Figuras", price: 3000, minutes: 5 },
  { name: "Cerquillo", price: 5000, minutes: 5 }
];
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
  syncSharedState();
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

function loadAppointments() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleAppointments));
    return [...sampleAppointments];
  }
  return JSON.parse(saved);
}

function saveAppointments() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
  saveSharedState();
}

async function saveSharedState() {
  try {
    await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointments, barbers, blockedSlots })
    });
  } catch (error) {
    console.error("No se pudo sincronizar con el servidor", error);
  }
}

async function syncSharedState() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("Estado no disponible");
    const shared = await response.json();
    appointments = Array.isArray(shared.appointments) ? shared.appointments : appointments;
    barbers = Array.isArray(shared.barbers) && shared.barbers.length ? shared.barbers : barbers;
    blockedSlots = Array.isArray(shared.blockedSlots) ? shared.blockedSlots : blockedSlots;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
    localStorage.setItem(BARBERS_KEY, JSON.stringify(barbers));
    render();
    renderBarbers();
    updateBarberSelects();
    renderBlockedHours();
  } catch (error) {
    console.error("Usando datos locales", error);
  }
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function appointmentDateTime(appointment) {
  return new Date(`${appointment.date}T${appointment.time}:00`);
}

function formatLongDate(dateString) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
}

function statusLabel(status) {
  return { pending: "Pendiente", completed: "Completada", cancelled: "Cancelada" }[status];
}

function render() {
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
      <div class="time-block"><strong>${escapeHtml(item.time)}</strong><span>${formatLongDate(item.date)}</span></div>
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
    const phone = normalizedWhatsAppPhone(item.phone);
    return `<div class="reminder">
      <div><strong>${escapeHtml(item.client)}</strong><span>${formatLongDate(item.date)} · ${escapeHtml(item.time)}</span></div>
      <a class="whatsapp-button" target="_blank" rel="noopener" href="https://wa.me/${phone}?text=${encodeURIComponent(reminderText(item))}">Enviar recordatorio</a>
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
      <td>${formatLongDate(item.date)}</td><td>${escapeHtml(item.time)}</td>
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
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
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

  for (let time = 8 * 60; time + duration <= 19 * 60; time += 15) {
    const end = time + duration;
    const blockedConflict = blocked.some(blockedTime => blockedTime >= time && blockedTime < end);
    const conflict = blockedConflict || occupied.some(item => time < item.end && end > item.start);
    const option = document.createElement("option");
    option.value = minutesToTime(time);
    option.textContent = `${minutesToTime(time)}${blockedConflict ? " - Bloqueada" : occupied.some(item => time < item.end && end > item.start) ? " - Reservada" : ""}`;
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

function hasAppointmentConflict(form) {
  const selectedServices = getSelectedServices(form);
  if (!form.elements.time.value) return false;
  const start = timeToMinutes(form.elements.time.value);
  const end = start + selectedServices.reduce((sum, item) => sum + item.minutes, 0);
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
      ${dayAppointments.slice(0, 2).map(item => `<span class="day-reservation">${item.time} · ${escapeHtml(item.client)}</span>`).join("")}
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
      <strong>${escapeHtml(item.time)}</strong>
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
  document.getElementById("pageTitle").textContent = { dashboard: "Panel principal", appointments: "Citas", calendar: "Calendario", clients: "Clientes", barbers: "Barberos" }[viewName];
  if (viewName === "calendar") renderCalendar();
  document.getElementById("sidebar").classList.remove("open");
}

document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll("[data-view-link]").forEach(button => button.addEventListener("click", () => setView(button.dataset.viewLink)));
document.getElementById("menuButton").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("calendarGrid").addEventListener("click", event => {
  const day = event.target.closest("[data-calendar-date]");
  if (!day) return;
  selectedCalendarDate = day.dataset.calendarDate;
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
  const slots = blockedSlots
    .filter(item => item.date === selectedCalendarDate)
    .sort((a, b) => a.barber.localeCompare(b.barber) || a.time.localeCompare(b.time));
  document.getElementById("blockedHoursList").innerHTML = slots.length ? slots.map(slot => `
    <div class="blocked-hour">
      <span><strong>${escapeHtml(slot.time)}</strong> · ${escapeHtml(slot.barber)}</span>
      <button type="button" class="action-button" data-unblock-slot="${slot.id}">Desbloquear</button>
    </div>`).join("") : '<p class="blocked-hours-empty">No hay horas bloqueadas este día.</p>';
}

document.getElementById("blockHourButton").addEventListener("click", () => {
  if (currentStaff?.role !== "admin") return;
  const barber = document.getElementById("blockedBarber").value;
  const time = document.getElementById("blockedTime").value;
  if (!barber || !time) {
    showToast("Selecciona barbero y hora");
    return;
  }
  if (blockedSlots.some(item => item.barber === barber && item.date === selectedCalendarDate && item.time === time)) {
    showToast("Ese horario ya está bloqueado");
    return;
  }
  blockedSlots.push({ id: Date.now(), barber, date: selectedCalendarDate, time });
  saveSharedState();
  renderBlockedHours();
  renderCalendar();
  showToast("Horario bloqueado");
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
        <img src="img/${file}" alt="Trabajo realizado en Adrian Barber" loading="${index === 0 ? "eager" : "lazy"}">
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
  const shareData = { title: "ADRIAN BARBER", text: message, url: window.location.href };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(`${message}\n${window.location.href}`)}`, "_blank", "noopener,noreferrer");
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

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: selectedStaffRole, username, password })
    });
    if (!response.ok) throw new Error("Usuario o contraseña incorrectos");
    account = await response.json();
  } catch (error) {
    document.getElementById("loginHint").textContent = error.message;
    return;
  }

  if (!account) {
    document.getElementById("loginHint").textContent = "Usuario o contraseña incorrectos.";
    return;
  }

  currentStaff = account;
  document.getElementById("authScreen").hidden = true;
  document.getElementById("appShell").hidden = false;
  document.body.classList.add("admin-mode");
  document.querySelectorAll(".admin-only").forEach(element => element.hidden = account.role !== "admin");
  document.getElementById("newAppointment").hidden = account.role !== "admin";
  document.getElementById("pageTitle").textContent = account.role === "admin" ? "Panel principal" : `Agenda de ${account.barber}`;
  render();
});

document.getElementById("clientBack").addEventListener("click", () => {
  document.getElementById("publicBooking").hidden = true;
  document.getElementById("landingPage").hidden = false;
});

document.getElementById("publicBookingForm").addEventListener("submit", event => {
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
  appointments.push({
    id: Date.now(), client: data.get("client").trim(), phone: data.get("phone").replace(/\D/g, ""),
    service: selectedServices.map(item => item.name).join(" + "), price: selectedServices.reduce((sum, item) => sum + item.price, 0), barber: data.get("barber"), date: data.get("date"),
    time: data.get("time"), notes: "Reserva creada por el cliente", status: "pending"
  });
  saveAppointments();
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
  document.getElementById("appShell").hidden = true;
  document.body.classList.remove("admin-mode");
  showLanding();
  document.getElementById("staffLoginForm").reset();
  document.getElementById("backRoles").click();
});

document.getElementById("addBarberButton").addEventListener("click", () => openBarberDialog());
document.querySelectorAll("[data-close-barber]").forEach(button => button.addEventListener("click", () => document.getElementById("barberDialog").close()));

function openBarberDialog(barber = null) {
  editingBarberId = barber?.id || null;
  const form = document.getElementById("barberForm");
  form.reset();
  document.getElementById("barberDialogTitle").textContent = barber ? "Editar barbero" : "Agregar barbero";
  if (barber) {
    form.elements.name.value = barber.name;
    form.elements.username.value = barber.username;
    form.elements.password.value = barber.password;
    form.elements.phone.value = barber.phone || "";
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
    Object.assign(existing, barberData);
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
  if (deleteId && confirm("¿Eliminar este barbero? Las citas existentes se conservarán.")) {
    barbers = barbers.filter(barber => barber.id !== Number(deleteId));
    saveBarbers();
    showToast("Barbero eliminado");
  }
});

updateBarberSelects();
renderBarbers();
setupServicePickers();
renderCalendar();
render();
