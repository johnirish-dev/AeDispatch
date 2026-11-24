// The resident page: intro, barangay choice, daily check-in, home, alerts, report, symptom check, learn.
// All texts come from the resident strings file (English and Filipino); all data calls go through the service file.

import { translate } from "./strings.js";
import { store, todayText } from "./store.js";
import { service, ServiceError } from "./service.js";

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  lang: store.get("lang", "en"),
  onboarded: store.get("onboarded", false),
  barangayId: store.get("barangay", null), // null: none chosen, or the barangay is not listed
  alertsOn: store.get("alertsOn", false),
  signedIn: store.get("signedIn", false),
  introIndex: 0,
  draftId: null, // the choice on the barangay screen, before Continue
  draftNotListed: false,
  fromHome: false, // the barangay screen was opened from Home, not from the intro
  phone: "",
  resendSeconds: 0,
  resendTimer: null,
  currentScreen: null,
  barangays: [], // [{ id, name, municipality }] from the server
  loadFailed: false, // the barangay list could not be loaded
};

const t = (key, vars) => translate(state.lang, key, vars);

// ---- screens -------------------------------------------------------------------------------

// nav: which bottom tab is lit (or null: no bottom bar); top: show the location bar.
const SCREENS = {
  "screen-splash": { nav: null, top: false },
  "screen-intro": { nav: null, top: false },
  "screen-barangay": { nav: null, top: false },
  "screen-alertsopt": { nav: null, top: false },
  "screen-checkin": { nav: null, top: false },
  "screen-signin": { nav: null, top: false },
  "screen-pin": { nav: null, top: false },
  "screen-home": { nav: "screen-home", top: true },
  "screen-warning": { nav: "screen-home", top: false },
  "screen-alerts": { nav: "screen-home", top: false },
  "screen-report": { nav: "screen-home", top: false },
  "screen-check": { nav: "screen-check", top: false },
  "screen-learn": { nav: "screen-learn", top: false },
};

function showScreen(id) {
  const meta = SCREENS[id];
  state.currentScreen = id;
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  $("main-topbar").hidden = !meta.top;
  $("bottom-nav").hidden = meta.nav === null;
  document.body.classList.toggle("no-nav", meta.nav === null);
  $$(".nav-tab").forEach((tab) => {
    const on = tab.dataset.nav === meta.nav;
    tab.classList.toggle("active", on);
    if (on) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  if (id !== "screen-pin") stopResendTimer();
  window.scrollTo(0, 0);
  // Move the keyboard and screen-reader position to the new screen's title.
  const heading = $(id).querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

let toastTimer = null;
function showToast(message) {
  const toast = $("app-toast");
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 2800);
}

// ---- language ------------------------------------------------------------------------------

function applyLanguage() {
  document.documentElement.lang = state.lang === "fil" ? "fil" : "en";
  document.title = t("page.title");
  $$("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $$("[data-i18n-placeholder]").forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder)));
  $$("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  $$("[data-lang]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.lang === state.lang)));

  renderIntro();
  renderBarangayList();
  renderBarangaySelect();
  renderAlertsOption();
  renderPinTexts();
  renderHome();
  renderWarning(state.weather ?? null, state.level ?? null);
  renderAlerts();
  renderSymptomResult();
  renderReportWait();
}

function setLanguage(lang) {
  state.lang = lang;
  store.set("lang", lang);
  applyLanguage();
}

// ---- barangays -----------------------------------------------------------------------------

const findBarangay = (id) => state.barangays.find((b) => b.id === id);
const barangayName = (id) => findBarangay(id)?.name ?? "";
const barangayLine = (id) => {
  const b = findBarangay(id);
  return b ? `${b.name}, ${b.municipality}` : "";
};

async function loadBarangays() {
  try {
    state.barangays = await service.listBarangays();
    state.loadFailed = false;
  } catch {
    state.barangays = [];
    state.loadFailed = true;
  }
}

async function retryLoad() {
  await loadBarangays();
  renderBarangaySelect();
  renderBarangayList();
  renderAlertsOption();
  renderHome();
}

function setBarangay(id) {
  state.barangayId = id;
  store.set("barangay", id);
}

function applyBarangayChange(next) {
  setBarangay(next);
  renderHome();
  renderAlerts();
}

// "Change your barangay?" Your daily check-in and symptom check count for the barangay you choose, so the change
// is confirmed first. Keeping the current one is the safe choice: it has the focus, Escape and the backdrop mean "keep".
function askToChangeBarangay(oldId, nextId) {
  const select = $("barangay-select");
  const overlay = $("bgy-confirm");
  const oldName = state.barangays.find((b) => b.id === oldId)?.name ?? "";
  const newName = state.barangays.find((b) => b.id === nextId)?.name ?? select.options[select.selectedIndex]?.textContent ?? "";
  $("bgy-confirm-title").textContent = t("bgy.confirmTitle");
  $("bgy-confirm-body").textContent = t("bgy.confirmBody", { old: oldName, new: newName });
  $("bgy-confirm-yes").textContent = t("bgy.confirmYes");
  $("bgy-confirm-no").textContent = t("bgy.confirmNo", { old: oldName });
  overlay.hidden = false;
  $("bgy-confirm-no").focus();

  const close = (change) => {
    overlay.hidden = true;
    document.removeEventListener("keydown", onKey);
    if (change) applyBarangayChange(nextId);
    else select.value = String(oldId);
    select.focus();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close(false);
  };
  document.addEventListener("keydown", onKey);
  $("bgy-confirm-yes").onclick = () => close(true);
  $("bgy-confirm-no").onclick = () => close(false);
  overlay.onclick = (event) => {
    if (event.target === overlay) close(false);
  };
}

function renderBarangaySelect() {
  const select = $("barangay-select");
  select.replaceChildren();
  for (const b of state.barangays) {
    const option = document.createElement("option");
    option.value = String(b.id);
    option.textContent = barangayLine(b.id);
    select.append(option);
  }
  const none = document.createElement("option");
  none.value = "__none";
  none.textContent = t("bgy.noneShort");
  select.append(none);
  select.value = state.barangayId === null ? "__none" : String(state.barangayId);
}

// ---- intro slides --------------------------------------------------------------------------

const SLIDE_ORBS = ["orb-amber", "orb-teal", "orb-navy"];
const SLIDE_ICONS = ["intro-icon-bell", "intro-icon-check", "intro-icon-shield"];

function renderIntro() {
  const n = state.introIndex + 1;
  $("intro-title").textContent = t(`intro.${n}.title`);
  $("intro-body").textContent = t(`intro.${n}.body`);
  $("intro-next").textContent = `${t(state.introIndex < 2 ? "intro.next" : "intro.start")} ›`;
  $("intro-orb").className = `orb ${SLIDE_ORBS[state.introIndex]}`;
  SLIDE_ICONS.forEach((id, i) => {
    $(id).hidden = i !== state.introIndex;
  });
  $$("#intro-dots span").forEach((dot, i) => dot.classList.toggle("active", i === state.introIndex));
  if ($("intro-back")) $("intro-back").hidden = state.introIndex === 0;
  if ($("intro-skip")) $("intro-skip").classList.toggle("is-hidden", state.introIndex === 2);
}

function prevIntro() {
  if (state.introIndex > 0) {
    state.introIndex -= 1;
    renderIntro();
  }
}

function nextIntro() {
  if (state.introIndex < 2) {
    state.introIndex += 1;
    renderIntro();
  } else {
    openBarangayScreen(false);
  }
}

// ---- choosing a barangay -------------------------------------------------------------------

const plain = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function renderBarangayList() {
  const list = $("bgy-list");
  const query = plain($("bgy-search").value.trim());
  list.replaceChildren();

  const matches = state.barangays.filter((b) => plain(b.name).includes(query));
  for (const b of matches) list.append(barangayRow(b.id, barangayLine(b.id)));
  list.append(barangayRow("__none", t("bgy.none")));

  const noMatch = $("bgy-nomatch");
  noMatch.hidden = !(query !== "" && matches.length === 0);
  noMatch.textContent = noMatch.hidden ? "" : t("bgy.noMatch", { q: $("bgy-search").value.trim() });
  // The list could not be loaded: say so, and let the person try again.
  list.hidden = state.loadFailed;
  $("bgy-retry").hidden = !state.loadFailed;
  if (state.loadFailed) {
    noMatch.hidden = false;
    noMatch.textContent = `${t("error.title")}. ${t("error.body")}`;
  }

  $("bgy-notlisted").hidden = !state.draftNotListed;
  const button = $("bgy-continue");
  button.disabled = state.draftId === null && !state.draftNotListed;
  button.textContent = t(state.draftNotListed ? "bgy.continueWithout" : "bgy.continue");
}

function barangayRow(id, label) {
  const selected = id === "__none" ? state.draftNotListed : state.draftId === id;
  const row = document.createElement("button");
  row.type = "button";
  row.className = "bgy-row" + (selected ? " selected" : "");
  row.setAttribute("role", "radio");
  row.setAttribute("aria-checked", String(selected));
  const text = document.createElement("span");
  text.textContent = label;
  const mark = document.createElement("span");
  mark.className = "radio-mark";
  mark.setAttribute("aria-hidden", "true");
  row.append(text, mark);
  row.addEventListener("click", () => {
    state.draftNotListed = id === "__none";
    state.draftId = id === "__none" ? null : id;
    renderBarangayList();
  });
  return row;
}

function openBarangayScreen(fromHome) {
  state.fromHome = fromHome;
  state.draftId = state.barangayId;
  state.draftNotListed = false;
  $("bgy-search").value = "";
  renderBarangayList();
  showScreen("screen-barangay");
}

function confirmBarangay() {
  if (state.draftNotListed) {
    setBarangay(null);
    if (state.fromHome) goHome({ checkin: false });
    else finishOnboarding();
    return;
  }
  setBarangay(state.draftId);
  if (state.fromHome) {
    renderBarangaySelect();
    goHome({ checkin: true });
  } else {
    renderAlertsOption();
    showScreen("screen-alertsopt");
  }
}

function renderAlertsOption() {
  const name = state.barangayId ? barangayName(state.barangayId) : "";
  $("alertsopt-body").textContent = t("alertsopt.body", { barangay: name });
  $("alertsopt-sample").textContent = t("alertsopt.sample", { barangay: name });
}

function finishOnboarding() {
  state.onboarded = true;
  store.set("onboarded", true);
  renderBarangaySelect();
  goHome({ checkin: true });
}

// ---- home ----------------------------------------------------------------------------------

const METER_CLASS = { low: "active-low", moderate: "active-mod", elevated: "active-elev", high: "active-high" };
const PILL_CLASS = { low: "pill-low", moderate: "pill-moderate", elevated: "pill-elevated", high: "pill-high" };
const HERO_CLASS = { low: "risk-state-low", moderate: "risk-state-low", elevated: "", high: "risk-state-high" };
const LEVELS = ["low", "moderate", "elevated", "high"];

let renderToken = 0; // a later render replaces an earlier one that is still waiting for the data

async function renderHome() {
  const listed = typeof state.barangayId === "number";
  $("home-listed").hidden = !listed;
  $("home-error").hidden = true;
  $("home-nolisting").hidden = listed;
  $("alert-dot").hidden = true;
  renderDailyCard();
  if (!listed) return;

  const token = ++renderToken;
  let risk = null;
  try {
    risk = await service.getRisk(state.barangayId);
  } catch {
    risk = null;
  }
  if (token !== renderToken) return;
  const failed = risk === null || risk.level === null;
  state.weather = failed ? null : risk.weather;
  state.level = failed ? null : risk.level;
  renderWarning(state.weather, state.level);
  $("home-listed").hidden = failed;
  $("home-error").hidden = !failed;
  if (failed) return;

  $("home-hero-card").className = `card hero-card ${HERO_CLASS[risk.level]}`.trim();
  const pill = $("home-risk-pill");
  pill.textContent = t(`level.${risk.level}.risk`);
  pill.className = `status-pill ${PILL_CLASS[risk.level]}`;
  $("home-headline").textContent = t(`headline.${risk.level}`);

  const step = LEVELS.indexOf(risk.level);
  $$("#meter-track .meter-seg").forEach((seg, i) => {
    seg.className = i === step ? `meter-seg ${METER_CLASS[risk.level]}` : "meter-seg";
  });
  $$("#meter-labels span").forEach((label, i) => label.classList.toggle("active", i === step));

  renderRainChart(risk.weather);
  const updated = $("home-updated");
  updated.textContent = risk.weather
    ? t("home.updated", { date: new Intl.DateTimeFormat(t("locale"), { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${risk.weather.asOf}T12:00:00`)) })
    : "";

  $("alert-dot").hidden = !(state.alertsOn && (risk.level === "elevated" || risk.level === "high"));
}

function answeredToday() {
  return store.get("answered") === todayText();
}

function renderDailyCard() {
  const done = answeredToday();
  $("daily-ask").hidden = done;
  $("daily-thanks").hidden = !done;
}

function goHome({ checkin }) {
  renderHome();
  if (checkin && state.barangayId !== null && store.get("checkinSeen") !== todayText()) {
    openCheckin();
  } else {
    showScreen("screen-home");
  }
}

// ---- daily check-in (no sign-in) -----------------------------------------------------------

function openCheckin() {
  $("checkin-ask").hidden = false;
  $("checkin-ask-actions").hidden = false;
  $("checkin-thanks").hidden = true;
  $("checkin-thanks-actions").hidden = true;
  $("checkin-skip").hidden = false;
  showScreen("screen-checkin");
}

async function answerDaily(answer, { full }) {
  try {
    await service.submitDailyAnswer(state.barangayId, answer);
  } catch {
    showToast(t("toast.notSent"));
    return;
  }
  store.set("answered", todayText());
  store.set("checkinSeen", todayText());
  renderDailyCard();
  if (full) {
    $("checkin-ask").hidden = true;
    $("checkin-ask-actions").hidden = true;
    $("checkin-skip").hidden = true;
    $("checkin-thanks").hidden = false;
    $("checkin-thanks-actions").hidden = false;
    showScreen("screen-checkin");
  }
}

function skipDaily() {
  store.set("checkinSeen", todayText());
  showToast(t("toast.skipped"));
}

// The bars are the real rain of the last 7 days (mm), from the same weather record the risk level used.
// The rainiest day is highlighted; a day with no record is a thin grey stub.
const RAIN_BAR_MAX_PX = 56;
const RAIN_SCALE_MIN_MM = 20; // so a drizzle does not fill the chart

function renderRainChart(weather) {
  const bars = $("outlook-bars");
  const badge = $("rain-total-badge");
  bars.replaceChildren();
  if (!weather || !Array.isArray(weather.days)) {
    badge.textContent = "";
    bars.setAttribute("aria-label", t("warn.noData"));
    return;
  }
  const values = weather.days.map((d) => d.rainMm);
  const known = values.filter((v) => v !== null);
  const top = Math.max(RAIN_SCALE_MIN_MM, ...known);
  const rainiest = known.length > 0 && Math.max(...known) > 0 ? values.indexOf(Math.max(...known)) : -1;
  const label = [];
  weather.days.forEach((d, i) => {
    const mm = d.rainMm;
    const weekday = new Date(`${d.date}T12:00:00`).getDay();
    const column = document.createElement("div");
    column.className = "bar-col";
    const fill = document.createElement("div");
    fill.className = "bar-fill" + (i === rainiest ? " peak" : "") + (mm === null ? " missing" : "");
    fill.style.height = `${mm === null ? 3 : Math.max(3, Math.round((mm / top) * RAIN_BAR_MAX_PX))}px`;
    const day = document.createElement("span");
    day.className = "bar-day";
    day.textContent = t(`dayShort.${weekday}`);
    column.append(fill, day);
    bars.append(column);
    label.push(`${t(`dayAbbr.${weekday}`)} ${mm === null ? "–" : `${mm} mm`}`);
  });
  const total = Math.round(known.reduce((a, b) => a + b, 0));
  badge.textContent = t("home.rainTotal", { mm: total });
  bars.setAttribute("aria-label", `${t("home.outlook")}. ${label.join(", ")}`);
}

// ---- warning, alerts -----------------------------------------------------------------------

// The numbers on this screen are the weather the risk level was calculated from (sent by the server),
// not fixed text. Without them (not scored yet) the screen says so instead of showing example values.
function renderWarning(weather, level) {
  // The title follows the level, so a calm barangay is never told that conditions favor mosquitoes.
  $("warn-title").textContent = t(level ? `warn.title.${level}` : "warn.title.none");
  const dates = $("warn-dates");
  const tempValue = $("warn-temp-value");
  const tempNote = $("warn-temp-note");
  const rainValue = $("warn-rain-value");
  const rainNote = $("warn-rain-note");
  if (!weather) {
    dates.textContent = "";
    tempValue.textContent = rainValue.textContent = "–";
    tempNote.textContent = rainNote.textContent = t("warn.noData");
    return;
  }
  const format = new Intl.DateTimeFormat(t("locale"), { weekday: "short", month: "short", day: "numeric" });
  dates.textContent = t("warn.basedOn", { date: format.format(new Date(`${weather.asOf}T12:00:00`)) });
  if (weather.meanTempC === null) {
    tempValue.textContent = "–";
    tempNote.textContent = t("warn.noData");
  } else {
    tempValue.textContent = t("warn.tempValue", { temp: weather.meanTempC.toFixed(1) });
    tempNote.textContent = `${t("warn.tempAvg")} ${t(weather.tempFavorable ? "warn.tempNote.yes" : "warn.tempNote.no")}`;
  }
  rainValue.textContent = t("warn.rainValue", { days: weather.rainDays, window: weather.rainDaysWindow });
  rainNote.textContent = t(weather.rainFavorable ? "warn.rainNote.yes" : "warn.rainNote.no");
}

const ALERT_ACCENT = { low: "alert-card-low", moderate: "alert-card-moderate", elevated: "alert-card-elevated", high: "alert-card-high" };

async function renderAlerts() {
  $("alerts-barangay-label").textContent = state.barangayId ? `Brgy. ${barangayLine(state.barangayId)}` : "";
  $("alerts-state").textContent = t(state.alertsOn ? "alerts.stateOn" : "alerts.stateOff");
  $("alerts-toggle").textContent = t(state.alertsOn ? "alerts.turnOff" : "alerts.turnOn");

  const list = $("alerts-list");
  list.replaceChildren();
  let risk = null;
  if (typeof state.barangayId === "number") {
    try {
      risk = await service.getRisk(state.barangayId);
    } catch {
      risk = null;
    }
  }
  if (risk === null || risk.level === null) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.textContent = state.barangayId === null ? t("alerts.noBarangay") : t("error.body");
    list.append(empty);
  } else {
    list.append(alertCard(risk.level, t("alerts.today"), t(`headline.${risk.level}`), true));
    // Earlier alerts from the server (the one issued today at this level is the card above).
    for (const a of risk.alerts) {
      const when = new Date(a.issuedAt);
      if (todayText(when) === todayText() && a.level === risk.level) continue;
      const date = when.toLocaleDateString(t("locale"), { month: "short", day: "numeric" });
      list.append(alertCard(a.level, date, t(`headline.${a.level}`), false));
    }
  }

  const messages = $("messages-list");
  messages.replaceChildren();
  const saved = store.get("messages", []);
  if (saved.length === 0) {
    const none = document.createElement("p");
    none.className = "muted-text";
    none.textContent = t("alerts.messagesEmpty");
    messages.append(none);
  }
  for (const m of saved) {
    const card = document.createElement("div");
    card.className = "card message-card";
    const head = document.createElement("div");
    head.className = "card-header-row";
    const label = document.createElement("span");
    label.className = "demo-pill";
    label.textContent = t("alerts.demoLabel");
    const time = document.createElement("span");
    time.className = "muted-text";
    time.textContent = new Date(m.at).toLocaleTimeString(t("locale"), { hour: "numeric", minute: "2-digit" });
    head.append(label, time);
    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = t("alerts.demoSms", { pin: m.pin });
    card.append(head, text);
    messages.append(card);
  }
}

function alertCard(level, when, body, withTag) {
  const card = document.createElement("div");
  card.className = `card ${ALERT_ACCENT[level]}`;
  const head = document.createElement("div");
  head.className = "card-header-row";
  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = t(`level.${level}.risk`);
  const time = document.createElement("span");
  time.className = "muted-text";
  time.textContent = when;
  head.append(title, time);
  const text = document.createElement("p");
  text.className = "alert-text";
  text.textContent = body;
  card.append(head, text);
  if (withTag) {
    const tag = document.createElement("span");
    tag.className = `status-pill ${PILL_CLASS[level]}`;
    tag.textContent = t("alerts.tag");
    card.append(tag);
  }
  return card;
}

function setAlerts(on) {
  state.alertsOn = on;
  store.set("alertsOn", on);
  renderAlerts();
  renderHome();
}

// ---- sign-in (only to send a report) -------------------------------------------------------

function openReport() {
  if (state.signedIn) {
    showScreen("screen-report");
    refreshReportStatus();
  } else {
    $("phone-error").hidden = true;
    showScreen("screen-signin");
  }
}

// A resident can send one household report in any 7 days (the server decides). The screen says so before the
// resident fills anything in, and shows the date of the next one; the form is switched off until then.
async function refreshReportStatus() {
  try {
    const status = await service.reportStatus();
    setReportNext(status.nextReportDate);
  } catch (failure) {
    if (failure instanceof ServiceError && failure.status === 401) reportSignInEnded();
    else setReportNext(null); // unknown (no connection): show the form, the server still enforces the limit
  }
}

function setReportNext(date) {
  state.reportNext = typeof date === "string" ? date : null;
  renderReportWait();
}

function renderReportWait() {
  const waiting = typeof state.reportNext === "string";
  $("report-wait").hidden = !waiting;
  if (waiting) {
    const day = new Intl.DateTimeFormat(t("locale"), { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${state.reportNext}T12:00:00`));
    $("report-wait-body").textContent = t("report.waitBody", { date: day });
  }
  $$("#household-report-form input, #household-report-form button[type=submit]").forEach((el) => {
    el.disabled = waiting;
  });
}

function reportSignInEnded() {
  // The sign-in ended (a session lasts 8 hours and is lost when the server restarts).
  state.signedIn = false;
  store.set("signedIn", false);
  showToast(t("report.signInAgain"));
  $("phone-error").hidden = true;
  showScreen("screen-signin");
}

const formatPhone = (digits) => `+63 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;

async function sendPin() {
  const digits = $("phone-input").value.replace(/\D/g, "");
  const error = $("phone-error");
  if (!/^9\d{9}$/.test(digits)) {
    error.textContent = t("signin.error");
    error.hidden = false;
    $("phone-input").setAttribute("aria-invalid", "true");
    return;
  }
  error.hidden = true;
  $("phone-input").removeAttribute("aria-invalid");
  state.phone = digits;
  try {
    await issuePin();
  } catch (failure) {
    error.textContent = pinErrorText(failure);
    error.hidden = false;
    return;
  }
  renderPinTexts();
  showScreen("screen-pin");
  $$("#pin-boxes input")[0].focus();
}

function pinErrorText(failure) {
  if (failure instanceof ServiceError && failure.status === 429) return t("pin.waitMore");
  if (failure instanceof ServiceError && failure.status === 400) return t("signin.error");
  return t("toast.notSent");
}

// Asks for a PIN and files the demo SMS in the Alerts messages.
async function issuePin() {
  const { pin } = await service.sendPin(state.phone);
  const messages = store.get("messages", []);
  messages.unshift({ pin, at: new Date().toISOString() });
  store.set("messages", messages.slice(0, 5));
  $("pin-demo").textContent = t("pin.demo", { pin });
  $("pin-demo").dataset.pin = pin;
  clearPinBoxes();
  $("pin-error").hidden = true;
  startResendTimer();
  renderAlerts();
}

function renderPinTexts() {
  $("pin-sub").textContent = state.phone ? t("pin.sub", { phone: formatPhone(state.phone) }) : "";
  const pin = $("pin-demo").dataset.pin;
  $("pin-demo").textContent = pin ? t("pin.demo", { pin }) : "";
  $$("#pin-boxes input").forEach((box, i) => box.setAttribute("aria-label", t("pin.box", { n: i + 1 })));
  renderResend();
}

function buildPinBoxes() {
  const holder = $("pin-boxes");
  for (let i = 0; i < 6; i++) {
    const box = document.createElement("input");
    box.type = "text";
    box.inputMode = "numeric";
    box.maxLength = 1;
    box.autocomplete = i === 0 ? "one-time-code" : "off";
    box.addEventListener("input", () => {
      box.value = box.value.replace(/\D/g, "");
      if (box.value !== "" && i < 5) holder.children[i + 1].focus();
    });
    box.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && box.value === "" && i > 0) holder.children[i - 1].focus();
      if (event.key === "Enter") verifyPin();
    });
    box.addEventListener("paste", (event) => {
      const digits = (event.clipboardData?.getData("text") ?? "").replace(/\D/g, "").slice(0, 6);
      if (digits === "") return;
      event.preventDefault();
      [...digits].forEach((d, k) => {
        holder.children[k].value = d;
      });
      holder.children[Math.min(digits.length, 5)].focus();
    });
    holder.append(box);
  }
}

function clearPinBoxes() {
  $$("#pin-boxes input").forEach((box) => {
    box.value = "";
  });
}

function startResendTimer() {
  stopResendTimer();
  state.resendSeconds = 45;
  renderResend();
  state.resendTimer = setInterval(() => {
    state.resendSeconds -= 1;
    renderResend();
    if (state.resendSeconds <= 0) stopResendTimer();
  }, 1000);
}

function stopResendTimer() {
  clearInterval(state.resendTimer);
  state.resendTimer = null;
}

function renderResend() {
  const waiting = state.resendSeconds > 0;
  const mm = Math.floor(state.resendSeconds / 60);
  const ss = String(state.resendSeconds % 60).padStart(2, "0");
  $("pin-resend-text").textContent = waiting ? t("pin.resendIn", { time: `${mm}:${ss}` }) : "";
  $("pin-resend").hidden = waiting;
}

async function verifyPin() {
  const error = $("pin-error");
  const pin = $$("#pin-boxes input").map((box) => box.value).join("");
  if (pin.length < 6) {
    error.textContent = t("pin.incomplete");
    error.hidden = false;
    return;
  }
  let result;
  try {
    result = await service.verifyPin(state.phone, pin, state.barangayId);
  } catch {
    showToast(t("toast.notSent"));
    return;
  }
  if (result.ok) {
    state.signedIn = true;
    store.set("signedIn", true);
    showToast(t("pin.signedIn"));
    showScreen("screen-report");
    return;
  }
  if (result.reason === "wrong") error.textContent = result.triesLeft === 1 ? t("pin.wrongOne") : t("pin.wrong", { n: result.triesLeft });
  else error.textContent = t(result.reason === "tooMany" ? "pin.tooMany" : "pin.expired");
  error.hidden = false;
  clearPinBoxes();
  $$("#pin-boxes input")[0].focus();
}

// ---- report, symptom check, learn ----------------------------------------------------------

let lastSymptomResult = null; // "none", "sym", "warn" or null

function renderSymptomResult() {
  const card = $("symptom-result-card");
  if (lastSymptomResult === null) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  card.className = "result-card" + (lastSymptomResult === "warn" ? " result-red" : lastSymptomResult === "sym" ? " result-amber" : "");
  $("result-heading").textContent = t(`check.${lastSymptomResult}.h`);
  $("result-body").textContent = t(`check.${lastSymptomResult}.b`);
}

async function evaluateSymptoms() {
  const warns = $$(".warn-check:checked").length;
  const syms = $$(".sym-check:checked").length;
  lastSymptomResult = warns > 0 ? "warn" : syms > 0 ? "sym" : "none";
  renderSymptomResult();
  await countSymptomCheck(warns > 0);
}

// The check itself is unlimited: the person always gets their result. Only the COUNT that goes to the system is
// limited, to once a day on this phone for a check with warning signs and once a day for a check without (the server
// has its own daily limit per barangay as well). The mark is per phone, not per barangay, so changing barangay does not
// give an extra count. A count that could not be sent (no connection, or the server's limit) does not use up the day.
async function countSymptomCheck(warning) {
  if (state.barangayId === null) return;
  const key = warning ? "symptomWarnCounted" : "symptomPlainCounted";
  if (store.get(key) === todayText()) return;
  const result = await service.recordSymptomCheck(state.barangayId, warning);
  if (result.saved) store.set(key, todayText());
}

async function submitReport(event) {
  event.preventDefault();
  const flags = {};
  $$("#household-report-form input[type=checkbox]").forEach((box) => {
    flags[box.name] = box.checked;
  });
  try {
    await service.submitReport(flags);
  } catch (failure) {
    if (failure instanceof ServiceError && failure.status === 401) {
      reportSignInEnded();
    } else if (failure instanceof ServiceError && failure.status === 429 && failure.body?.nextReportDate) {
      setReportNext(failure.body.nextReportDate); // already sent this week: show when the next one is possible
      showToast(t("report.waitTitle"));
    } else {
      showToast(t("toast.notSent"));
    }
    return;
  }
  event.target.reset();
  showToast(t("report.done"));
  showScreen("screen-home");
}

async function copyTips() {
  try {
    await navigator.clipboard.writeText(t("warn.tips"));
    showToast(t("warn.copied"));
  } catch {
    showToast(t("warn.copyFail"));
  }
}

// ---- wiring --------------------------------------------------------------------------------

function wire() {
  $$("[data-lang]").forEach((b) => b.addEventListener("click", () => setLanguage(b.dataset.lang)));
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => showScreen(b.dataset.go)));
  $$(".nav-tab").forEach((tab) => tab.addEventListener("click", () => showScreen(tab.dataset.nav)));

  $("intro-next").addEventListener("click", nextIntro);
  $("intro-back")?.addEventListener("click", prevIntro);
  $("intro-skip").addEventListener("click", () => openBarangayScreen(false));
  $("bgy-back").addEventListener("click", () => {
    if (state.fromHome) showScreen("screen-home");
    else showScreen("screen-intro");
  });
  $("bgy-search").addEventListener("input", renderBarangayList);
  $("bgy-continue").addEventListener("click", confirmBarangay);
  $("alertsopt-back").addEventListener("click", () => showScreen("screen-barangay"));
  $("alertsopt-on").addEventListener("click", () => {
    state.alertsOn = true;
    store.set("alertsOn", true);
    finishOnboarding();
  });
  $("alertsopt-off").addEventListener("click", () => {
    state.alertsOn = false;
    store.set("alertsOn", false);
    finishOnboarding();
  });

  $$("[data-checkin]").forEach((b) => b.addEventListener("click", () => answerDaily(b.dataset.checkin, { full: true })));
  $("checkin-skip").addEventListener("click", () => {
    skipDaily();
    showScreen("screen-home");
  });
  $("checkin-done").addEventListener("click", () => showScreen("screen-home"));
  $("checkin-report").addEventListener("click", openReport);

  $("barangay-select").addEventListener("change", (event) => {
    const value = event.target.value;
    const next = value === "__none" ? null : Number(value);
    // Changing an existing barangay asks first, so it is never done by accident.
    if (typeof state.barangayId === "number" && next !== state.barangayId) {
      askToChangeBarangay(state.barangayId, next);
      return;
    }
    applyBarangayChange(next);
  });
  $("open-alerts-btn").addEventListener("click", () => {
    renderAlerts();
    showScreen("screen-alerts");
  });
  $("open-warning-btn").addEventListener("click", () => showScreen("screen-warning"));
  $("choose-barangay-btn").addEventListener("click", () => openBarangayScreen(true));
  $$("[data-pulse]").forEach((b) => b.addEventListener("click", () => answerDaily(b.dataset.pulse, { full: false })));
  $("skip-pulse-btn").addEventListener("click", skipDaily);
  $("open-report-btn").addEventListener("click", openReport);
  $("copy-tips-btn").addEventListener("click", copyTips);
  $("alerts-toggle").addEventListener("click", () => {
    setAlerts(!state.alertsOn);
    showToast(t(state.alertsOn ? "toast.alertsOn" : "toast.alertsOff"));
  });

  $("signin-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendPin();
  });
  $("pin-back").addEventListener("click", () => showScreen("screen-signin"));
  $("pin-change").addEventListener("click", () => showScreen("screen-signin"));
  $("pin-resend").addEventListener("click", async () => {
    try {
      await issuePin();
      showToast(t("pin.sent"));
    } catch (failure) {
      showToast(pinErrorText(failure));
    }
  });
  $("bgy-retry").addEventListener("click", retryLoad);
  $("home-retry").addEventListener("click", retryLoad);
  $("pin-verify").addEventListener("click", verifyPin);
  $("household-report-form").addEventListener("submit", submitReport);

  $("clear-symptoms-btn").addEventListener("click", () => {
    $$(".sym-check, .warn-check").forEach((box) => {
      box.checked = false;
    });
    lastSymptomResult = null;
    renderSymptomResult();
  });
  $("evaluate-symptoms-btn").addEventListener("click", evaluateSymptoms);

  $$(".sub-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      $$(".sub-tab").forEach((x) => x.classList.toggle("active", x === tab));
      $$(".learn-panel").forEach((p) => p.classList.toggle("active", p.id === tab.dataset.learn));
    }),
  );
  $("learn-to-check-btn").addEventListener("click", () => showScreen("screen-check"));
}

// A barangay saved by an older version of this page (or one the server no longer has) is dropped.
function storedBarangayIsValid() {
  return state.barangayId === null || state.loadFailed || findBarangay(state.barangayId) !== undefined;
}

async function start() {
  buildPinBoxes();
  wire();
  applyLanguage();
  if (state.onboarded) {
    await loadBarangays();
    renderBarangaySelect();
    if (storedBarangayIsValid()) {
      goHome({ checkin: true });
    } else {
      setBarangay(null);
      renderBarangaySelect();
      openBarangayScreen(true);
    }
  } else {
    showScreen("screen-splash");
    loadBarangays().then(() => {
      renderBarangaySelect();
      renderBarangayList();
    });
    setTimeout(() => {
      if (state.currentScreen === "screen-splash") showScreen("screen-intro");
    }, 1500);
  }
  // Is the saved sign-in still valid on the server?
  if (state.signedIn && !(await service.isSignedIn())) {
    state.signedIn = false;
    store.set("signedIn", false);
  }
}

start();