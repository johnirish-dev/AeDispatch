// The resident page: intro, barangay choice, daily check-in, home, alerts, report, symptom check, learn.
// All texts come from the resident strings file (English and Filipino); all data calls go through the service file.

import { translate } from "./strings.js";
import { store, todayText } from "./store.js";
import { service, BARANGAYS, MUNICIPALITY } from "./service.js";

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
  renderWarningDates();
  renderAlerts();
  renderSymptomResult();
}

function setLanguage(lang) {
  state.lang = lang;
  store.set("lang", lang);
  applyLanguage();
}

// ---- barangays -----------------------------------------------------------------------------

const barangayName = (id) => BARANGAYS.find((b) => b.id === id)?.name ?? "";
const barangayLine = (id) => `${barangayName(id)}, ${MUNICIPALITY}`;

function setBarangay(id) {
  state.barangayId = id;
  store.set("barangay", id);
}

function renderBarangaySelect() {
  const select = $("barangay-select");
  select.replaceChildren();
  for (const b of BARANGAYS) {
    const option = document.createElement("option");
    option.value = b.id;
    option.textContent = barangayLine(b.id);
    select.append(option);
  }
  const none = document.createElement("option");
  none.value = "__none";
  none.textContent = t("bgy.noneShort");
  select.append(none);
  select.value = state.barangayId ?? "__none";
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

const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function renderBarangayList() {
  const list = $("bgy-list");
  const query = plain($("bgy-search").value.trim());
  list.replaceChildren();

  const matches = BARANGAYS.filter((b) => plain(b.name).includes(query));
  for (const b of matches) list.append(barangayRow(b.id, barangayLine(b.id)));
  list.append(barangayRow("__none", t("bgy.none")));

  const noMatch = $("bgy-nomatch");
  noMatch.hidden = !(query !== "" && matches.length === 0);
  noMatch.textContent = noMatch.hidden ? "" : t("bgy.noMatch", { q: $("bgy-search").value.trim() });

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
  const listed = state.barangayId !== null;
  $("home-listed").hidden = !listed;
  $("home-nolisting").hidden = listed;
  $("alert-dot").hidden = true;
  renderDailyCard();
  if (!listed) return;

  const token = ++renderToken;
  const risk = await service.getRisk(state.barangayId);
  if (token !== renderToken || risk === null) return;

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

  const today = new Date();
  const bars = $("outlook-bars");
  bars.replaceChildren();
  risk.bars.forEach((height, i) => {
    const column = document.createElement("div");
    column.className = "bar-col";
    const fill = document.createElement("div");
    fill.className = "bar-fill" + (i === risk.peakDay ? " peak" : "");
    fill.style.height = `${height}px`;
    const day = document.createElement("span");
    day.className = "bar-day";
    day.textContent = t(`dayShort.${(today.getDay() + i) % 7}`);
    column.append(fill, day);
    bars.append(column);
  });
  bars.setAttribute("aria-label", `${t("home.outlook")}. ${t("home.outlookNote")}`);
  $("peak-badge").textContent = t("home.peak", { day: t(`dayAbbr.${(today.getDay() + risk.peakDay) % 7}`) });

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
    showToast(t("toast.skipped"));
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

// ---- warning, alerts -----------------------------------------------------------------------

function renderWarningDates() {
  const format = new Intl.DateTimeFormat(t("locale"), { weekday: "short", month: "short", day: "numeric" });
  const start = new Date();
  const end = new Date(start.getTime() + 4 * 24 * 60 * 60 * 1000);
  $("warn-dates").textContent = `${format.format(start)} – ${format.format(end)}`;
}

const ALERT_ACCENT = { low: "alert-card-low", moderate: "alert-card-moderate", elevated: "alert-card-elevated", high: "alert-card-high" };

async function renderAlerts() {
  $("alerts-barangay-label").textContent = state.barangayId ? `Brgy. ${barangayLine(state.barangayId)}` : "";
  $("alerts-state").textContent = t(state.alertsOn ? "alerts.stateOn" : "alerts.stateOff");
  $("alerts-toggle").textContent = t(state.alertsOn ? "alerts.turnOff" : "alerts.turnOn");

  const list = $("alerts-list");
  list.replaceChildren();
  const risk = state.barangayId ? await service.getRisk(state.barangayId) : null;
  if (risk === null) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.textContent = t("alerts.noBarangay");
    list.append(empty);
  } else {
    list.append(alertCard(risk.level, t("alerts.today"), t(`headline.${risk.level}`), true));
    list.append(alertCard("moderate", t("alerts.earlier"), t("alerts.earlierBody"), false));
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
  if (state.signedIn) showScreen("screen-report");
  else {
    $("phone-error").hidden = true;
    showScreen("screen-signin");
  }
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
  await issuePin();
  renderPinTexts();
  showScreen("screen-pin");
  $$("#pin-boxes input")[0].focus();
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
  const result = await service.verifyPin(state.phone, pin);
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
  if (state.barangayId !== null) await service.recordSymptomCheck(state.barangayId, warns > 0);
}

async function submitReport(event) {
  event.preventDefault();
  const flags = {};
  $$("#household-report-form input[type=checkbox]").forEach((box) => {
    flags[box.name] = box.checked;
  });
  await service.submitReport(state.barangayId, flags);
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
    setBarangay(value === "__none" ? null : value);
    renderHome();
    renderAlerts();
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
    await issuePin();
    showToast(t("pin.sent"));
  });
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

function start() {
  buildPinBoxes();
  wire();
  applyLanguage();
  if (state.onboarded) {
    goHome({ checkin: true });
  } else {
    showScreen("screen-splash");
    setTimeout(() => {
      if (state.currentScreen === "screen-splash") showScreen("screen-intro");
    }, 1500);
  }
}

start();
