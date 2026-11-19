import { Store } from './store.js';
import { get, post } from '../shared/api.js';
import { BHW_STRINGS } from './strings.js';
import { icon } from './icons.js';
import { notify } from './toast.js';
import { showInlineAlert, clearInlineAlert } from './alerts.js';
import { stepperHtml, bindSteppers } from './stepper.js';
import { dateInputHtml, bindDateInputs, dmyToISO } from './dateinput.js';
import { esc, sumGroup, renderResultCard, renderContainersReview } from './review.js';

// Capitalizes the first letter of each word or hyphenated part (handles ñ, Ñ, accents, and initials)
function formatPersonName(raw) {
  if (!raw) return '';
  return raw.replace(/(^|[\s.-])([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF])/g, (match, sep, ch) => {
    return sep + ch.toLocaleUpperCase('es-PH');
  });
}

function attachNameAutoCap(inputEl, onUpdate) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const formatted = formatPersonName(inputEl.value);
    if (inputEl.value !== formatted) {
      inputEl.value = formatted;
      if (start !== null && end !== null) {
        inputEl.setSelectionRange(start, end);
      }
    }
    if (onUpdate) onUpdate(inputEl.value);
  });
}

function sanitizeNonNegativeInt(raw, allowEmpty = true) {
  if (raw === '' || raw === null || raw === undefined) return allowEmpty ? '' : 0;
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return allowEmpty ? '' : 0;
  return Math.max(0, parseInt(digits, 10));
}

function setFieldError(fieldEl, msg) {
  if (!fieldEl) return;
  fieldEl.classList.add('has-error');
  fieldEl.dataset.errorMessage = msg;
}

function clearFieldError(fieldEl) {
  fieldEl.classList.remove('has-error');
  delete fieldEl.dataset.errorMessage;
  const e = fieldEl.querySelector('.bhw-field-error');
  if (e) e.remove();
}

// The survey date starts empty and is typed as dd/mm/yyyy. Returns an error message, or '' when valid.
function checkSurveyDate(text, iso) {
  if (!text) return 'Enter the survey date as dd/mm/yyyy.';
  if (!iso) return 'Enter a valid date as dd/mm/yyyy.';
  const today = new Date().setHours(0, 0, 0, 0);
  const sel = new Date(`${iso}T00:00:00`).getTime();
  if (sel > today) return BHW_STRINGS.errors.dateFuture;
  if ((today - sel) > 14 * 86400000) return BHW_STRINGS.errors.dateTooOld;
  return '';
}

function createDefaultContainers() {
  return [
    { location: 'indoor', containerType: '', withCover: 0, withoutCover: 0, total: 0, positive: 0, larvaeCount: 0, pupaeCount: 0 },
    { location: 'outdoor', containerType: '', withCover: 0, withoutCover: 0, total: 0, positive: 0, larvaeCount: 0, pupaeCount: 0 },
    { location: 'natural', containerType: '', withCover: 0, withoutCover: 0, total: 0, positive: 0, larvaeCount: 0, pupaeCount: 0 }
  ];
}

function ensureOneRowPerLocation(containers) {
  const list = Array.isArray(containers) ? [...containers] : [];
  ['indoor', 'outdoor', 'natural'].forEach(loc => {
    if (!list.some(c => c.location === loc)) {
      list.push({ location: loc, containerType: '', withCover: 0, withoutCover: 0, total: 0, positive: 0, larvaeCount: 0, pupaeCount: 0 });
    }
  });
  return list;
}

// Who did the interview: chosen from the health workers registered for this barangay (the list comes from
// /api/bhw/me) and sent as interviewerId. The device can be used by anyone, so the name is never assumed.
function interviewers() {
  return Array.isArray(window.bhwContext?.bhws) ? window.bhwContext.bhws : [];
}

function interviewerSelectHtml(id, selectedId) {
  const list = interviewers();
  if (list.length === 0) {
    return `<select id="${id}" class="bhw-control" disabled><option>No health workers are registered for this barangay</option></select>`;
  }
  const options = list.map(b => `<option value="${b.id}" ${String(b.id) === String(selectedId) ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  return `<select id="${id}" class="bhw-control"><option value="">Select who did the interview</option>${options}</select>`;
}

function pickInterviewer(state, value) {
  const worker = interviewers().find(b => String(b.id) === String(value));
  state.interviewerId = worker ? worker.id : '';
  state.surveyedBy = worker ? worker.name : '';
}

export async function renderSurvey(root, draftId) {
  const me = window.bhwContext;
  let openTaskId = null;

  try {
    const tasks = window.bhwTasks || await get('/api/bhw/tasks');
    const activeTask = tasks.find(t => t.status === 'new' || t.status === 'in_progress');
    if (activeTask) openTaskId = activeTask.id;
  } catch (e) {
    openTaskId = null;
  }

  let state = {
    step: 1,
    taskId: openTaskId,
    houseNo: '',
    municipality: 'Daraga',
    purokId: '',
    purokName: '',
    barangay: me.barangay.name,
    headOfFamily: '',
    age: '',
    sex: '',
    civilStatus: '',
    occupation: '',
    personsSlept: '',
    schoolName: '',
    buildingStructure: '',
    storeys: '',
    screening: '',
    rooms: '',
    surveyedBy: '',
    interviewerId: '',
    surveyDate: '',
    noContainersFound: false,
    completeTask: false,
    certified: false,
    containers: createDefaultContainers()
  };

  const foundDraft = draftId ? Store.getDrafts().find(d => d.id === draftId) : null;
  const foundQueueItem = draftId ? Store.getQueue().find(q => q.id === draftId && q.needsReview) : null;
  const savedSource = foundDraft?.form || foundQueueItem?.payload;
  if (savedSource) {
    state = {
      ...state,
      ...savedSource,
      step: foundQueueItem ? 3 : (savedSource.step || state.step),
      purokName: foundQueueItem?.purokName || savedSource.purokName || '',
      storeys: savedSource.storeys === 1 ? 'Single storey' : savedSource.storeys === 2 ? '2 or more storeys' : (savedSource.storeys || ''),
      screening: savedSource.screened === true ? 'Screened' : savedSource.screened === false ? 'Unscreened' : (savedSource.screening || ''),
      certified: false,
      containers: ensureOneRowPerLocation(savedSource.containers)
    };
    // A draft or queued form made when the name was typed has no interviewer from the list: choose again.
    if (!interviewers().some(b => String(b.id) === String(state.interviewerId))) {
      state.interviewerId = '';
      state.surveyedBy = '';
    }
  }

  const saveCurrentDraft = (progress) => {
    const id = draftId || `draft-${Date.now()}`;
    if (foundQueueItem) Store.dequeue(foundQueueItem.id);
    return Store.saveDraft({ id, taskId: state.taskId, savedAt: Date.now(), progress, form: state });
  };

  let pendingFocus = null;

  const render = () => {
    const selectedPurok = me.puroks.find(p => String(p.id) === String(state.purokId));
    const purokLabel = selectedPurok ? selectedPurok.name : (state.purokName || 'Purok not yet selected');

    root.innerHTML = `
      <div style="margin-bottom: 14px;">
        <div class="bhw-eyebrow">DENGUE FORM 5 · NATIONAL DENGUE PREVENTION AND CONTROL PROGRAM</div>
        <h1 class="bhw-page-title">Dengue Entomological Survey</h1>
        <p class="bhw-page-subtitle">House ${state.houseNo || '—'} · ${purokLabel}</p>
      </div>

      <div class="bhw-stepper-card">
        <div class="bhw-step-item ${state.step === 1 ? 'active' : state.step > 1 ? 'done' : ''}">
          <div class="bhw-step-circle">${state.step > 1 ? icon('check', 14) : '1'}</div>
          <span class="bhw-step-label">Household</span>
        </div>
        <div class="bhw-step-line ${state.step > 1 ? 'done' : ''}"></div>
        <div class="bhw-step-item ${state.step === 2 ? 'active' : state.step > 2 ? 'done' : ''}">
          <div class="bhw-step-circle">${state.step > 2 ? icon('check', 14) : '2'}</div>
          <span class="bhw-step-label">Water containers</span>
        </div>
        <div class="bhw-step-line ${state.step > 2 ? 'done' : ''}"></div>
        <div class="bhw-step-item ${state.step === 3 ? 'active' : ''}">
          <div class="bhw-step-circle">3</div>
          <span class="bhw-step-label">Review and submit</span>
        </div>
      </div>

      <div id="step-container"></div>
    `;

    const container = root.querySelector('#step-container');

    // One edit listener at a time on the shared container: editing a field clears its error and the alert above it
    const onEditClear = (extra) => {
      if (container._editHandler) {
        ['input', 'change'].forEach(ev => container.removeEventListener(ev, container._editHandler));
      }
      container._editHandler = (e) => {
        const f = e.target.closest && e.target.closest('.bhw-field.has-error');
        if (f) clearFieldError(f);
        if (extra) extra();
      };
      ['input', 'change'].forEach(ev => container.addEventListener(ev, container._editHandler));
    };

    if (state.step === 1) {
      const req = '<span class="req">*</span>';
      const selectOpts = (list, current) => list.map(s => `<option value="${s}" ${current === s ? 'selected' : ''}>${s}</option>`).join('');

      container.innerHTML = `
        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Household information</h2>
              <p class="bhw-panel-sub">Fields marked <span style="color:#C81E1E">*</span> are required. Only the name of school is optional.</p>
            </div>
            <span class="bhw-collapse-icon">${icon('chevronUp', 14)}</span>
          </div>

          <div id="step-alert" class="bhw-alert-slot"></div>

          <div class="bhw-form-grid-4">
            <div class="bhw-field" data-field="houseNo">
              <label for="f-houseNo">House no. ${req}</label>
              <input id="f-houseNo" class="bhw-control" type="text" maxlength="40" autocomplete="off" value="${esc(state.houseNo)}">
            </div>
            <div class="bhw-field">
              <label>Municipality/City</label>
              <input class="bhw-control" type="text" value="Daraga" readonly>
            </div>
            <div class="bhw-field" data-field="purokId">
              <label for="f-purokId">Purok/Sitio ${req}</label>
              <select id="f-purokId" class="bhw-control">
                <option value="">Select purok</option>
                ${me.puroks.map(p => `<option value="${p.id}" ${String(state.purokId) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="bhw-field">
              <label>Barangay</label>
              <input class="bhw-control" type="text" value="${esc(me.barangay.name)}" readonly>
            </div>
          </div>

          <div class="bhw-form-grid-2-1-1">
            <div class="bhw-field" data-field="headOfFamily">
              <label for="f-head">Head of the family ${req}</label>
              <input id="f-head" class="bhw-control" type="text" placeholder="e.g. John Irish Milallos" autocomplete="off" value="${esc(state.headOfFamily)}">
            </div>
            <div class="bhw-field" data-field="age">
              <label for="f-age">Age ${req}</label>
              ${stepperHtml({ id: 'f-age', value: state.age, min: 1, max: 120, label: 'age' })}
            </div>
            <div class="bhw-field" data-field="sex">
              <label for="f-sex">Sex ${req}</label>
              <select id="f-sex" class="bhw-control">
                <option value="">Select sex</option>
                ${selectOpts(['Male', 'Female'], state.sex)}
              </select>
            </div>
          </div>

          <div class="bhw-form-grid-1-2-1">
            <div class="bhw-field" data-field="civilStatus">
              <label for="f-civil">Civil status ${req}</label>
              <select id="f-civil" class="bhw-control">
                <option value="">Select civil status</option>
                ${selectOpts(['Single', 'Married', 'Widowed', 'Separated'], state.civilStatus)}
              </select>
            </div>
            <div class="bhw-field" data-field="occupation">
              <label for="f-occ">Occupation ${req}</label>
              <input id="f-occ" class="bhw-control" type="text" autocomplete="off" placeholder="e.g. Farmer" value="${esc(state.occupation)}">
              <span class="bhw-hint">Write Unemployed if none.</span>
            </div>
            <div class="bhw-field" data-field="personsSlept">
              <label for="f-slept">Persons who slept here the night before ${req}</label>
              ${stepperHtml({ id: 'f-slept', value: state.personsSlept, min: 0, max: 99, label: 'persons who slept here' })}
            </div>
          </div>

          <div class="bhw-field">
            <label for="f-school">Name of school, if applicable</label>
            <input id="f-school" class="bhw-control" type="text" autocomplete="off" value="${esc(state.schoolName)}">
          </div>
        </section>

        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Building structure</h2>
              <p class="bhw-panel-sub">Describe the house. All fields are required.</p>
            </div>
            <span class="bhw-collapse-icon">${icon('chevronUp', 14)}</span>
          </div>

          <div class="bhw-form-grid-4">
            <div class="bhw-field" data-field="buildingStructure">
              <label for="f-struct">Structure ${req}</label>
              <select id="f-struct" class="bhw-control">
                <option value="">Select structure</option>
                ${selectOpts(['Concrete', 'Semi-concrete', 'Light/wooden', 'Shanty'], state.buildingStructure)}
              </select>
            </div>
            <div class="bhw-field" data-field="storeys">
              <label for="f-storeys">Storeys ${req}</label>
              <select id="f-storeys" class="bhw-control">
                <option value="">Select storeys</option>
                ${selectOpts(['Single storey', '2 or more storeys'], state.storeys)}
              </select>
            </div>
            <div class="bhw-field" data-field="screening">
              <label for="f-screen">Screening ${req}</label>
              <select id="f-screen" class="bhw-control">
                <option value="">Select screening</option>
                ${selectOpts(['Screened', 'Unscreened'], state.screening)}
              </select>
            </div>
            <div class="bhw-field" data-field="rooms">
              <label for="f-rooms">No. of rooms ${req}</label>
              ${stepperHtml({ id: 'f-rooms', value: state.rooms, min: 0, max: 99, label: 'number of rooms' })}
            </div>
          </div>
        </section>

        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Surveyor details</h2>
              <p class="bhw-panel-sub">Specify the Barangay Health Worker conducting this inspection and the survey date.</p>
            </div>
          </div>
          <div class="bhw-form-grid-2">
            <div class="bhw-field" data-field="surveyedBy">
              <label for="f-surveyedBy-s1">Interviewed by ${req}</label>
              ${interviewerSelectHtml('f-surveyedBy-s1', state.interviewerId)}
            </div>
            <div class="bhw-field" data-field="surveyDate">
              <label for="f-surveyDate-s1">Date of survey ${req}</label>
              ${dateInputHtml({ id: 'f-surveyDate-s1', iso: state.surveyDate })}
            </div>
          </div>
        </section>

        <div class="bhw-panel bhw-form-actions" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px;">
          <button id="btn-cancel" class="bhw-pill-btn outline" type="button">Cancel</button>
          <div class="bhw-form-action-group" style="display:flex; gap:10px;">
            <button id="btn-draft" class="bhw-pill-btn outline" type="button">${icon('save', 14)} Save draft</button>
            <button id="btn-next" class="bhw-pill-btn primary" type="button">Next</button>
          </div>
        </div>
      `;

      // Auto-capitalize names (handles hyphens, ñ, Ñ, accents)
      attachNameAutoCap(container.querySelector('#f-head'), val => { state.headOfFamily = val; });
      container.querySelector('#f-surveyedBy-s1').addEventListener('change', e => pickInterviewer(state, e.target.value));
      attachNameAutoCap(container.querySelector('#f-occ'), val => { state.occupation = val; });
      attachNameAutoCap(container.querySelector('#f-school'), val => { state.schoolName = val; });

      bindSteppers(container);
      bindDateInputs(container);

      onEditClear(() => clearInlineAlert(container.querySelector('#step-alert')));

      const bindStep1 = () => {
        state.houseNo = container.querySelector('#f-houseNo').value.trim();
        state.purokId = container.querySelector('#f-purokId').value;
        const pObj = me.puroks.find(p => String(p.id) === String(state.purokId));
        state.purokName = pObj ? pObj.name : '';
        state.headOfFamily = formatPersonName(container.querySelector('#f-head').value.trim());
        state.age = sanitizeNonNegativeInt(container.querySelector('#f-age').value, true);
        state.sex = container.querySelector('#f-sex').value;
        state.civilStatus = container.querySelector('#f-civil').value;
        state.occupation = formatPersonName(container.querySelector('#f-occ').value.trim());
        state.personsSlept = sanitizeNonNegativeInt(container.querySelector('#f-slept').value, true);
        state.schoolName = formatPersonName(container.querySelector('#f-school').value.trim());
        state.buildingStructure = container.querySelector('#f-struct').value;
        state.storeys = container.querySelector('#f-storeys').value;
        state.screening = container.querySelector('#f-screen').value;
        state.rooms = sanitizeNonNegativeInt(container.querySelector('#f-rooms').value, true);
        pickInterviewer(state, container.querySelector('#f-surveyedBy-s1').value);
        const dateText = container.querySelector('#f-surveyDate-s1').value.trim();
        state.surveyDate = dmyToISO(dateText);
        return dateText;
      };

      const checkStep1 = (dateText) => {
        const errs = [];
        const need = (key, missing, msg) => { if (missing) errs.push([key, msg]); };
        need('houseNo', !state.houseNo, BHW_STRINGS.errors.houseNoEmpty);
        need('purokId', !state.purokId, BHW_STRINGS.errors.purokEmpty);
        need('headOfFamily', !state.headOfFamily, 'Enter the head of the family.');
        if (state.age === '') errs.push(['age', 'Enter the age.']);
        else if (state.age < 1) errs.push(['age', 'Age must be at least 1.']);
        need('sex', !state.sex, 'Select sex.');
        need('civilStatus', !state.civilStatus, 'Select civil status.');
        need('occupation', !state.occupation, 'Enter the occupation. Write Unemployed if none.');
        need('personsSlept', state.personsSlept === '', 'Enter how many persons slept here.');
        need('buildingStructure', !state.buildingStructure, 'Select the building structure.');
        need('storeys', !state.storeys, 'Select the number of storeys.');
        need('screening', !state.screening, 'Select screening.');
        need('rooms', state.rooms === '', 'Enter the number of rooms.');
        need('surveyedBy', !state.interviewerId, BHW_STRINGS.errors.surveyedByEmpty);
        const dateErr = checkSurveyDate(dateText, state.surveyDate);
        if (dateErr) errs.push(['surveyDate', dateErr]);
        return errs;
      };

      container.querySelector('#btn-cancel').addEventListener('click', () => { window.location.hash = '#/'; });
      container.querySelector('#btn-draft').addEventListener('click', () => {
        bindStep1();
        if (saveCurrentDraft(33)) window.location.hash = '#/forms';
      });
      container.querySelector('#btn-next').addEventListener('click', () => {
        const dateText = bindStep1();
        container.querySelectorAll('.bhw-field.has-error').forEach(clearFieldError);
        const errs = checkStep1(dateText);
        if (errs.length > 0) {
          errs.forEach(([key, msg]) => setFieldError(container.querySelector(`[data-field="${key}"]`), msg));
          showInlineAlert(container.querySelector('#step-alert'), {
            type: 'warning',
            title: 'Some required fields are missing',
            message: `${errs.length} ${errs.length === 1 ? 'field needs' : 'fields need'} your attention. They are marked below.`
          });
          const first = container.querySelector(`[data-field="${errs[0][0]}"]`);
          first.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const ctl = first.querySelector('input:not([type="date"]), select');
          if (ctl) ctl.focus({ preventScroll: true });
          return;
        }
        state.step = 2;
        render();
      });

    } else if (state.step === 2) {
      state.containers = ensureOneRowPerLocation(state.containers);

      const categories = [
        { key: 'indoor', title: 'A. Indoor containers', sub: 'Jars, pitchers, drums, ant traps, dish drains inside the house', addLabel: 'Add indoor container' },
        { key: 'outdoor', title: 'B. Outdoor containers', sub: 'Drums, cans, tires, bottles, and basins around the premises', addLabel: 'Add outdoor container' },
        { key: 'natural', title: 'C. Natural containers', sub: 'Plant axils, tree holes, coco shells, bamboo stumps (no cover columns)', addLabel: 'Add natural container' }
      ];

      container.innerHTML = `
        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">II. Types of water containers present</h2>
              <p class="bhw-panel-sub">Fill in only the containers found at this household across Indoor, Outdoor, and Natural sections, or leave unselected if none.</p>
            </div>
          </div>

          <div id="step-alert" class="bhw-alert-slot"></div>

          <div id="all-containers-wrap" class="bhw-all-containers-wrap ${state.noContainersFound ? 'is-disabled' : ''}"></div>

          <div class="bhw-switch-row">
            <button id="sw-nocont" type="button" class="bhw-switch ${state.noContainersFound ? 'on' : ''}" aria-pressed="${state.noContainersFound}">
              <div class="bhw-switch-knob"></div>
            </button>
            <div>
              <strong style="font-size:13px; display:block;">No containers found at this household</strong>
              <span style="font-size:11px; color:#6B7280;">Toggling this resets any selected containers above to empty and disables container inputs.</span>
            </div>
          </div>
        </section>

        <div class="bhw-panel bhw-form-actions" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px;">
          <button id="btn-prev" class="bhw-pill-btn outline" type="button">Previous</button>
          <div class="bhw-form-action-group" style="display:flex; gap:10px;">
            <button id="btn-draft" class="bhw-pill-btn outline" type="button">${icon('save', 14)} Save draft</button>
            <button id="btn-next" class="bhw-pill-btn primary" type="button">Next</button>
          </div>
        </div>
      `;

      const wrapEl = container.querySelector('#all-containers-wrap');
      const isDisabled = Boolean(state.noContainersFound);

      categories.forEach(cat => {
        const loc = cat.key;
        const locItems = state.containers.filter(c => c.location === loc);

        const sec = document.createElement('div');
        sec.className = 'bhw-cat-section';
        sec.innerHTML = `
          <div class="bhw-cat-header">
            <div>
              <div class="bhw-cat-title">${cat.title}</div>
              <div class="bhw-cat-sub">${cat.sub}</div>
            </div>
          </div>
          <div class="bhw-cat-rows"></div>
          <div class="bhw-cat-footer">
            <button type="button" class="bhw-add-small-btn" ${isDisabled ? 'disabled' : ''}>${icon('plus', 12)} ${cat.addLabel}</button>
          </div>
        `;

        const rowsContainer = sec.querySelector('.bhw-cat-rows');
        const types = BHW_STRINGS.containers[loc] || [];

        locItems.forEach((item) => {
          const box = document.createElement('div');
          box.className = 'bhw-container-box';
          box.__item = item;
          // "Others" is a choice in the list. The name typed for it belongs to this row only.
          if (item.isOther === undefined) {
            item.isOther = Boolean(item.containerType) && !types.includes(item.containerType);
          }
          const selectedValue = item.isOther ? 'Others' : item.containerType;
          const num = (cls, value, label) => stepperHtml({ cls, value, min: 0, max: 999, label, placeholder: '0', disabled: isDisabled, size: 'sm' });

          box.innerHTML = `
            <div class="bhw-container-row-top">
              <div class="bhw-field">
                <label>Type of container</label>
                <select class="bhw-control c-type" ${isDisabled ? 'disabled' : ''}>
                  <option value="">Select type of container (optional)</option>
                  ${types.map(t => `<option value="${t}" ${selectedValue === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
              </div>
              ${item.isOther ? `
                <div class="bhw-field c-other-field">
                  <label>Container name <span class="req">*</span></label>
                  <input type="text" class="bhw-control c-other" maxlength="40" autocomplete="off" placeholder="e.g. Pale, Basin" value="${esc(item.containerType)}" ${isDisabled ? 'disabled' : ''}>
                </div>
              ` : ''}
              ${locItems.length > 1 ? `
                <button type="button" class="bhw-icon-btn rm-btn" aria-label="Remove container" title="Remove container" ${isDisabled ? 'disabled' : ''}>
                  ${icon('trash', 15)}
                </button>
              ` : ''}
            </div>

            <div class="bhw-container-nums ${loc === 'natural' ? 'natural-grid' : ''}">
              ${loc !== 'natural' ? `
                <div class="bhw-field">
                  <label>With cover</label>
                  ${num('c-with', item.withCover, 'with cover')}
                </div>
                <div class="bhw-field">
                  <label>Without cover</label>
                  ${num('c-without', item.withoutCover, 'without cover')}
                </div>
                <div class="bhw-field">
                  <label>Total</label>
                  <div class="bhw-total-readout c-total">${item.total}</div>
                </div>
              ` : `
                <div class="bhw-field">
                  <label>Total found</label>
                  ${num('c-nat-total', item.total, 'total found')}
                </div>
              `}
              <div class="bhw-field">
                <label>Positive (+)</label>
                ${num('c-pos', item.positive, 'positive containers')}
              </div>
              <div class="bhw-field">
                <label>No. of larvae</label>
                ${num('c-larvae', item.larvaeCount, 'larvae')}
              </div>
              <div class="bhw-field">
                <label>No. of pupae</label>
                ${num('c-pupae', item.pupaeCount, 'pupae')}
              </div>
            </div>
          `;

          box.querySelector('.c-type').addEventListener('change', e => {
            const val = e.target.value;
            if (val === 'Others') {
              item.isOther = true;
              item.containerType = '';
              pendingFocus = item;
            } else {
              item.isOther = false;
              item.containerType = val;
            }
            render();
          });

          const otherInput = box.querySelector('.c-other');
          if (otherInput) {
            attachNameAutoCap(otherInput, val => { item.containerType = val.trim(); });
            otherInput.addEventListener('input', () => {
              const f = otherInput.closest('.bhw-field');
              if (f) clearFieldError(f);
            });
            if (pendingFocus === item) {
              pendingFocus = null;
              setTimeout(() => otherInput.focus(), 0);
            }
          }

          const recalc = () => {
            if (loc === 'natural') {
              const natTotal = sanitizeNonNegativeInt(box.querySelector('.c-nat-total').value, false);
              item.withCover = 0;
              item.withoutCover = natTotal;
              item.total = natTotal;
            } else {
              item.withCover = sanitizeNonNegativeInt(box.querySelector('.c-with').value, false);
              item.withoutCover = sanitizeNonNegativeInt(box.querySelector('.c-without').value, false);
              item.total = item.withCover + item.withoutCover;
              const totEl = box.querySelector('.c-total');
              if (totEl) totEl.textContent = String(item.total);
            }
            item.positive = sanitizeNonNegativeInt(box.querySelector('.c-pos').value, false);
            item.larvaeCount = sanitizeNonNegativeInt(box.querySelector('.c-larvae').value, false);
            item.pupaeCount = sanitizeNonNegativeInt(box.querySelector('.c-pupae').value, false);
          };

          bindSteppers(box);
          box.querySelector('.bhw-container-nums').addEventListener('input', recalc);

          box.querySelector('.rm-btn')?.addEventListener('click', () => {
            state.containers = state.containers.filter(c => c !== item);
            render();
          });

          rowsContainer.appendChild(box);
        });

        sec.querySelector('.bhw-add-small-btn').addEventListener('click', () => {
          if (state.noContainersFound) return;
          state.containers.push({ location: loc, containerType: '', isOther: false, withCover: 0, withoutCover: 0, total: 0, positive: 0, larvaeCount: 0, pupaeCount: 0 });
          render();
        });

        wrapEl.appendChild(sec);
      });

      // Toggle "No containers found": keep sections visible, reset values to empty, and disable inputs
      container.querySelector('#sw-nocont').addEventListener('click', () => {
        state.noContainersFound = !state.noContainersFound;
        if (state.noContainersFound) {
          state.containers = createDefaultContainers();
        }
        render();
      });

      container.querySelector('#btn-prev').addEventListener('click', () => { state.step = 1; render(); });
      container.querySelector('#btn-draft').addEventListener('click', () => {
        if (saveCurrentDraft(66)) window.location.hash = '#/forms';
      });
      onEditClear(() => clearInlineAlert(container.querySelector('#step-alert')));

      container.querySelector('#btn-next').addEventListener('click', () => {
        const slot = container.querySelector('#step-alert');
        const boxes = [...container.querySelectorAll('.bhw-container-box')];
        const boxOf = (item) => boxes.find(b => b.__item === item);
        const focusFirst = (field) => {
          if (!field) return;
          field.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const ctl = field.querySelector('input, select');
          if (ctl) ctl.focus({ preventScroll: true });
        };

        const unnamed = state.containers.filter(c => c.isOther && !c.containerType);
        if (unnamed.length > 0 && !state.noContainersFound) {
          const fields = unnamed.map(c => boxOf(c)?.querySelector('.c-other-field')).filter(Boolean);
          fields.forEach(f => setFieldError(f, 'Enter the container name for Others.'));
          showInlineAlert(slot, { type: 'warning', title: 'Container name missing', message: 'Type the name of the container you chose as Others.' });
          focusFirst(fields[0]);
          return;
        }

        const rowsWithCountsButNoType = state.containers.filter(c => !c.containerType && (c.total > 0 || c.positive > 0 || c.larvaeCount > 0 || c.pupaeCount > 0));
        if (rowsWithCountsButNoType.length > 0) {
          const fields = rowsWithCountsButNoType.map(c => boxOf(c)?.querySelector('.c-type')?.closest('.bhw-field')).filter(Boolean);
          fields.forEach(f => setFieldError(f, 'Select a container type.'));
          showInlineAlert(slot, { type: 'warning', title: 'Container type missing', message: 'Select a container type for every row where you entered counts.' });
          focusFirst(fields[0]);
          return;
        }

        const filledContainers = state.containers.filter(c => c.containerType && c.total > 0);
        if (!state.noContainersFound && filledContainers.length === 0) {
          showInlineAlert(slot, { type: 'warning', title: 'No containers added', message: BHW_STRINGS.errors.noRowsOrChecked });
          return;
        }
        for (const c of filledContainers) {
          if (c.positive > c.total) {
            const field = boxOf(c)?.querySelector('.c-pos')?.closest('.bhw-field');
            if (field) setFieldError(field, `Cannot be more than the total (${c.total}).`);
            showInlineAlert(slot, { type: 'warning', title: 'Check the positive count', message: BHW_STRINGS.errors.positiveExceeds(c.containerType, c.location) });
            focusFirst(field);
            return;
          }
        }
        state.step = 3;
        render();
      });

    } else if (state.step === 3) {
      const validConts = state.noContainersFound
        ? []
        : state.containers.filter(c => c.containerType && c.total > 0);

      const totals = sumGroup(validConts);
      const completionPct = state.certified ? 100 : 67;

      container.innerHTML = `
        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Review and submit</h2>
              <p class="bhw-panel-sub">Verify all household, container, and BHW surveyor entries before final submission.</p>
            </div>
          </div>

          ${renderResultCard({ totals, meta: `House ${state.houseNo} · ${state.headOfFamily} · ${purokLabel}, Barangay ${me.barangay.name}` })}

          <div class="bhw-review-grid-2col">
            <div class="bhw-review-box no-mb">
              <div class="bhw-review-hdr">
                <span>Household information</span>
                <button type="button" class="edit-s1" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:700;color:#134E3A;display:inline-flex;align-items:center;gap:5px;">${icon('edit', 13)} Edit</button>
              </div>
              <div class="bhw-kv-grid">
                <div class="bhw-kv-item"><span>House no.</span><strong>${state.houseNo || '—'}</strong></div>
                <div class="bhw-kv-item"><span>Purok / Sitio</span><strong>${purokLabel}</strong></div>
                <div class="bhw-kv-item"><span>Barangay</span><strong>${me.barangay.name}</strong></div>
                <div class="bhw-kv-item"><span>Municipality</span><strong>Daraga</strong></div>
                <div class="bhw-kv-item"><span>Head of family</span><strong>${state.headOfFamily || '—'}</strong></div>
                <div class="bhw-kv-item"><span>Age & Sex</span><strong>${state.age || '—'} · ${state.sex || '—'}</strong></div>
                <div class="bhw-kv-item"><span>Civil status</span><strong>${state.civilStatus || '—'}</strong></div>
                <div class="bhw-kv-item"><span>Occupation</span><strong>${state.occupation || '—'}</strong></div>
                <div class="bhw-kv-item"><span>Slept here last night</span><strong>${state.personsSlept ?? '—'}</strong></div>
                <div class="bhw-kv-item"><span>School (if applicable)</span><strong>${state.schoolName || '—'}</strong></div>
              </div>
            </div>

            <div class="bhw-review-box no-mb">
              <div class="bhw-review-hdr">
                <span>Building structure</span>
                <button type="button" class="edit-s1" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:700;color:#134E3A;display:inline-flex;align-items:center;gap:5px;">${icon('edit', 13)} Edit</button>
              </div>
              <div class="bhw-kv-grid" style="grid-template-columns: 1fr 1fr;">
                <div class="bhw-kv-item"><span>Building structure</span><strong>${state.buildingStructure || 'Not specified'}</strong></div>
                <div class="bhw-kv-item"><span>No. of storeys</span><strong>${state.storeys || 'Not specified'}</strong></div>
                <div class="bhw-kv-item"><span>No. of rooms</span><strong>${state.rooms !== '' ? state.rooms : 'Not specified'}</strong></div>
                <div class="bhw-kv-item"><span>Window/door screening</span><strong>${state.screening || 'Not specified'}</strong></div>
              </div>
            </div>
          </div>

          ${renderContainersReview({ conts: validConts, totals, editHtml: `<button type="button" id="edit-s2" class="bhw-pill-btn outline sm">${icon('edit', 12)} Edit containers</button>` })}

          <div class="bhw-review-box no-mb">
            <div class="bhw-review-hdr">
              <span>Survey details</span>
            </div>
            <div style="padding: 16px 18px;">
              <div class="bhw-form-grid-2">
                <div class="bhw-field">
                  <label for="f-surveyedBy">Interviewed by <span class="req">*</span></label>
                  ${interviewerSelectHtml('f-surveyedBy', state.interviewerId)}
                  <span style="font-size:11px; color:#6B7280; display:block; margin-top:4px;">Choose who did this interview. This barangay shares one console link, so the name is picked each time.</span>
                </div>
                <div class="bhw-field">
                  <label>Date of survey <span class="req">*</span></label>
                  ${dateInputHtml({ id: 'f-surveyDate', iso: state.surveyDate })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="bhw-panel bhw-certification-panel">
          <div class="bhw-cert-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
              <h2 class="bhw-panel-title">Certification & submission</h2>
              <p class="bhw-panel-sub">Confirm that the entomological findings above match the household inspection.</p>
            </div>
            <strong style="font-size:15px; color:#134E3A;">${completionPct}% complete</strong>
          </div>

          <div class="bhw-progress-track bhw-cert-progress" style="margin-bottom:14px;">
            <div class="bhw-progress-fill" style="width:${completionPct}%;"></div>
          </div>

          <div class="bhw-switch-row bhw-cert-switch" style="border-top:none; padding-top:4px;">
            <button id="sw-cert" type="button" class="bhw-switch ${state.certified ? 'on' : ''}">
              <div class="bhw-switch-knob"></div>
            </button>
            <strong style="font-size:13px;">I certify that the information provided in this Dengue Form 5 survey is true and correct.</strong>
          </div>

          ${state.taskId ? `
          <div class="bhw-switch-row bhw-cert-switch">
            <button id="sw-complete" type="button" class="bhw-switch ${state.completeTask ? 'on' : ''}">
              <div class="bhw-switch-knob"></div>
            </button>
            <strong style="font-size:13px;">Mark the officer's task as finished when I submit. Leave this off if you will add more households.</strong>
          </div>` : ''}
        </section>

        <div id="submit-alert" class="bhw-alert-slot"></div>

        <div class="bhw-panel bhw-form-actions" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px;">
          <button id="btn-prev" class="bhw-pill-btn outline" type="button">Previous</button>
          <div class="bhw-form-action-group" style="display:flex; gap:10px;">
            <button id="btn-draft" class="bhw-pill-btn outline" type="button">${icon('save', 14)} Save draft</button>
            <button id="btn-submit" class="bhw-pill-btn primary" type="button" ${!state.certified ? 'disabled' : ''}>${icon('send', 14)} Submit form</button>
          </div>
        </div>
      `;

      container.querySelector('#f-surveyedBy').addEventListener('change', e => pickInterviewer(state, e.target.value));
      onEditClear(() => clearInlineAlert(container.querySelector('#submit-alert')));
      bindDateInputs(container);
      container.querySelector('#f-surveyDate').addEventListener('input', e => { state.surveyDate = dmyToISO(e.target.value); });

      container.querySelectorAll('.edit-s1').forEach(b => b.addEventListener('click', () => { state.step = 1; render(); }));
      container.querySelector('#edit-s2').addEventListener('click', () => { state.step = 2; render(); });

      container.querySelector('#sw-cert').addEventListener('click', () => {
        pickInterviewer(state, container.querySelector('#f-surveyedBy').value);
        state.surveyDate = dmyToISO(container.querySelector('#f-surveyDate').value.trim());
        state.certified = !state.certified;
        render();
      });

      // Only when this form belongs to a task the officer assigned.
      container.querySelector('#sw-complete')?.addEventListener('click', () => {
        pickInterviewer(state, container.querySelector('#f-surveyedBy').value);
        state.surveyDate = dmyToISO(container.querySelector('#f-surveyDate').value.trim());
        state.completeTask = !state.completeTask;
        render();
      });

      container.querySelector('#btn-prev').addEventListener('click', () => { state.step = 2; render(); });
      container.querySelector('#btn-draft').addEventListener('click', () => {
        if (saveCurrentDraft(90)) window.location.hash = '#/forms';
      });

      container.querySelector('#btn-submit').addEventListener('click', async () => {
        pickInterviewer(state, container.querySelector('#f-surveyedBy').value);
        state.surveyDate = dmyToISO(container.querySelector('#f-surveyDate').value.trim());

        const nameField = container.querySelector('#f-surveyedBy').closest('.bhw-field');
        const dateField = container.querySelector('#f-surveyDate').closest('.bhw-field');
        [nameField, dateField].forEach(clearFieldError);
        const dateErr = checkSurveyDate(container.querySelector('#f-surveyDate').value.trim(), state.surveyDate);
        if (!state.interviewerId || dateErr) {
          if (!state.interviewerId) setFieldError(nameField, BHW_STRINGS.errors.surveyedByEmpty);
          showInlineAlert(container.querySelector('#submit-alert'), { type: 'error', title: 'Check these details', message: !state.interviewerId ? BHW_STRINGS.errors.surveyedByEmpty : dateErr });
          if (dateErr) setFieldError(dateField, dateErr);
          const bad = !state.interviewerId ? nameField : dateField;
          bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
          bad.querySelector('select, input:not([type="date"])').focus({ preventScroll: true });
          return;
        }

        const clientSubmissionId = globalThis.crypto?.randomUUID
          ? globalThis.crypto.randomUUID()
          : `bhw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const payload = {
          clientSubmissionId,
          ...(state.taskId ? { taskId: Number(state.taskId) } : {}),
          purokId: Number(state.purokId),
          houseNo: state.houseNo,
          headOfFamily: state.headOfFamily || undefined,
          age: state.age !== '' ? Number(state.age) : undefined,
          sex: state.sex || undefined,
          civilStatus: state.civilStatus || undefined,
          occupation: state.occupation || undefined,
          personsSlept: state.personsSlept !== '' ? Number(state.personsSlept) : undefined,
          buildingStructure: state.buildingStructure || undefined,
          storeys: state.storeys === 'Single storey' ? 1 : state.storeys ? 2 : undefined,
          rooms: state.rooms !== '' ? Number(state.rooms) : undefined,
          screened: state.screening ? state.screening === 'Screened' : undefined,
          interviewerId: Number(state.interviewerId),
          surveyedBy: state.surveyedBy, // for the paper view on this phone; the server uses interviewerId
          surveyDate: state.surveyDate,
          noContainersFound: Boolean(state.noContainersFound),
          containers: state.noContainersFound ? [] : validConts.map(c => ({
            location: c.location,
            containerType: c.containerType,
            total: Number(c.total),
            withCover: c.location === 'natural' ? 0 : Number(c.withCover),
            withoutCover: c.location === 'natural' ? Number(c.total) : Number(c.withoutCover),
            positive: Number(c.positive),
            larvaeCount: Number(c.larvaeCount),
            pupaeCount: Number(c.pupaeCount)
          })),
          completeTask: Boolean(state.taskId) && Boolean(state.completeTask)
        };

        try {
          const submitBtn = container.querySelector('#btn-submit');
          submitBtn.disabled = true;
          const res = await post('/api/bhw/surveys', payload);
          if (draftId) Store.deleteDraft(draftId);
          if (foundQueueItem) Store.dequeue(foundQueueItem.id);
          window.bhwTasks = null; // the next form asks the server again (a finished task must not be picked)
          Store.saveSyncedForm({
            id: `sync-${res?.surveyId || Date.now()}`,
            surveyId: res?.surveyId,
            surveyedAt: Date.now(),
            houseNo: state.houseNo,
            purokId: state.purokId,
            purokName: purokLabel,
            headOfFamily: state.headOfFamily,
            containers: payload.containers,
            form: { ...state }
          });
          notify.success('Findings submitted', 'The barangay was re-scored.');
          window.location.hash = '#/forms';
        } catch (err) {
          if (err.status === 400 && err.body?.error) {
            showInlineAlert(container.querySelector('#submit-alert'), { type: 'error', title: 'Could not submit', message: err.body.error });
            container.querySelector('#btn-submit').disabled = false;
            return;
          }
          if (err.status === 401) {
            // A link that is no longer valid is not a lost connection: do not queue the form as if it were.
            showInlineAlert(container.querySelector('#submit-alert'), { type: 'error', title: 'Link not valid', message: BHW_STRINGS.status.invalidLink });
            container.querySelector('#btn-submit').disabled = false;
            return;
          }
          Store.enqueue({
            id: `queue-${Date.now()}`,
            queuedAt: Date.now(),
            clientSubmissionId,
            taskId: state.taskId,
            purokName: purokLabel,
            payload
          });
          if (draftId) Store.deleteDraft(draftId);
          notify.info('Saved on this phone', 'No connection. Your findings will be sent automatically when the connection returns.');
          window.location.hash = '#/forms';
        }
      });
    }
  };

  render();
}
