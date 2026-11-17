import { Store } from './store.js';
import { get, post } from '../shared/api.js';
import { updateSyncBadge } from './dashboard.js';
import { BHW_STRINGS } from './strings.js';
import { icon } from './icons.js';

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

function attachNonNegativeGuard(inputEl, allowEmpty, onUpdate) {
  if (!inputEl) return;
  inputEl.addEventListener('keydown', (e) => {
    if (['-', '+', 'e', 'E', '.'].includes(e.key)) {
      e.preventDefault();
    }
  });
  inputEl.addEventListener('input', () => {
    const cleaned = sanitizeNonNegativeInt(inputEl.value, allowEmpty);
    inputEl.value = cleaned === '' ? '' : String(cleaned);
    if (onUpdate) onUpdate(cleaned);
  });
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
    surveyDate: new Date().toISOString().split('T')[0],
    noContainersFound: false,
    certified: false,
    containers: createDefaultContainers()
  };

  if (draftId) {
    const found = Store.getDrafts().find(d => d.id === draftId);
    if (found) {
      state = {
        ...state,
        ...found.form,
        containers: ensureOneRowPerLocation(found.form.containers)
      };
    }
  }

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

    if (state.step === 1) {
      container.innerHTML = `
        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Household information</h2>
              <p class="bhw-panel-sub">Fields marked <span style="color:#C81E1E">*</span> are required.</p>
            </div>
            <span class="bhw-collapse-icon">${icon('chevronUp', 14)}</span>
          </div>

          <div class="bhw-form-grid-4">
            <div class="bhw-field">
              <label>House no. <span class="req">*</span></label>
              <input id="f-houseNo" class="bhw-control" type="text" maxlength="40" autocomplete="off" value="${state.houseNo}">
            </div>
            <div class="bhw-field">
              <label>Municipality/City</label>
              <input class="bhw-control" type="text" value="Daraga" readonly>
            </div>
            <div class="bhw-field">
              <label>Purok/Sitio <span class="req">*</span></label>
              <select id="f-purokId" class="bhw-control">
                <option value="">Select purok</option>
                ${me.puroks.map(p => `<option value="${p.id}" ${String(state.purokId) === String(p.id) ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </div>
            <div class="bhw-field">
              <label>Barangay</label>
              <input class="bhw-control" type="text" value="${me.barangay.name}" readonly>
            </div>
          </div>

          <div class="bhw-form-grid-2-1-1">
            <div class="bhw-field">
              <label>Head of the family <span class="req">*</span></label>
              <input id="f-head" class="bhw-control" type="text" placeholder="e.g. John Irish Milallos" autocomplete="off" value="${state.headOfFamily}">
            </div>
            <div class="bhw-field">
              <label>Age <span class="req">*</span></label>
              <input id="f-age" class="bhw-control" type="number" min="0" max="130" inputmode="numeric" placeholder="0" value="${state.age}">
            </div>
            <div class="bhw-field">
              <label>Sex <span class="req">*</span></label>
              <select id="f-sex" class="bhw-control">
                <option value="">Select sex</option>
                <option value="Male" ${state.sex === 'Male' ? 'selected' : ''}>Male</option>
                <option value="Female" ${state.sex === 'Female' ? 'selected' : ''}>Female</option>
              </select>
            </div>
          </div>

          <div class="bhw-form-grid-1-2-1">
            <div class="bhw-field">
              <label>Civil status</label>
              <select id="f-civil" class="bhw-control">
                <option value="">Select civil status</option>
                ${['Single', 'Married', 'Widowed', 'Separated'].map(s => `<option value="${s}" ${state.civilStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="bhw-field">
              <label>Occupation</label>
              <input id="f-occ" class="bhw-control" type="text" autocomplete="off" value="${state.occupation}">
            </div>
            <div class="bhw-field">
              <label>Persons who slept here the night before <span class="req">*</span></label>
              <input id="f-slept" class="bhw-control" type="number" min="0" inputmode="numeric" placeholder="0" value="${state.personsSlept}">
            </div>
          </div>

          <div class="bhw-field">
            <label>Name of school, if applicable</label>
            <input id="f-school" class="bhw-control" type="text" autocomplete="off" value="${state.schoolName}">
          </div>
        </section>

        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Building structure</h2>
              <p class="bhw-panel-sub">Describe the house. Leave a field unselected if not yet known.</p>
            </div>
            <span class="bhw-collapse-icon">${icon('chevronUp', 14)}</span>
          </div>

          <div class="bhw-form-grid-4">
            <div class="bhw-field">
              <label>Structure</label>
              <select id="f-struct" class="bhw-control">
                <option value="">Select structure</option>
                ${['Concrete', 'Semi-concrete', 'Light/wooden', 'Shanty'].map(s => `<option value="${s}" ${state.buildingStructure === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="bhw-field">
              <label>Storeys</label>
              <select id="f-storeys" class="bhw-control">
                <option value="">Select storeys</option>
                ${['Single storey', '2 or more storeys'].map(s => `<option value="${s}" ${state.storeys === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="bhw-field">
              <label>Screening</label>
              <select id="f-screen" class="bhw-control">
                <option value="">Select screening</option>
                ${['Screened', 'Unscreened'].map(s => `<option value="${s}" ${state.screening === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="bhw-field">
              <label>No. of rooms</label>
              <input id="f-rooms" class="bhw-control" type="number" min="0" inputmode="numeric" placeholder="0" value="${state.rooms}">
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
            <div class="bhw-field">
              <label>Surveyed by (BHW Name) <span class="req">*</span></label>
              <input id="f-surveyedBy-s1" class="bhw-control" type="text" maxlength="100" autocomplete="off" placeholder="e.g. Maria L. Reyes" value="${state.surveyedBy}">
            </div>
            <div class="bhw-field">
              <label>Date of survey <span class="req">*</span></label>
              <input id="f-surveyDate-s1" class="bhw-control" type="date" value="${state.surveyDate}">
            </div>
          </div>
        </section>

        <div class="bhw-panel" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px;">
          <button id="btn-cancel" class="bhw-pill-btn outline" type="button">Cancel</button>
          <div style="display:flex; gap:10px;">
            <button id="btn-draft" class="bhw-pill-btn outline" type="button">${icon('save', 14)} Save draft</button>
            <button id="btn-next" class="bhw-pill-btn primary" type="button">Next</button>
          </div>
        </div>
      `;

      // Auto-capitalize names (handles hyphens, ñ, Ñ, accents)
      attachNameAutoCap(container.querySelector('#f-head'), val => { state.headOfFamily = val; });
      attachNameAutoCap(container.querySelector('#f-surveyedBy-s1'), val => { state.surveyedBy = val; });

      // Block negative numbers on Age, Persons Slept, and Rooms
      attachNonNegativeGuard(container.querySelector('#f-age'), true, val => { state.age = val; });
      attachNonNegativeGuard(container.querySelector('#f-slept'), true, val => { state.personsSlept = val; });
      attachNonNegativeGuard(container.querySelector('#f-rooms'), true, val => { state.rooms = val; });

      const bindStep1 = () => {
        state.houseNo = container.querySelector('#f-houseNo').value.trim();
        state.purokId = container.querySelector('#f-purokId').value;
        const pObj = me.puroks.find(p => String(p.id) === String(state.purokId));
        state.purokName = pObj ? pObj.name : '';
        state.headOfFamily = formatPersonName(container.querySelector('#f-head').value.trim());
        state.age = sanitizeNonNegativeInt(container.querySelector('#f-age').value, true);
        state.sex = container.querySelector('#f-sex').value;
        state.civilStatus = container.querySelector('#f-civil').value;
        state.occupation = container.querySelector('#f-occ').value.trim();
        state.personsSlept = sanitizeNonNegativeInt(container.querySelector('#f-slept').value, true);
        state.schoolName = container.querySelector('#f-school').value.trim();
        state.buildingStructure = container.querySelector('#f-struct').value;
        state.storeys = container.querySelector('#f-storeys').value;
        state.screening = container.querySelector('#f-screen').value;
        state.rooms = sanitizeNonNegativeInt(container.querySelector('#f-rooms').value, true);
        state.surveyedBy = formatPersonName(container.querySelector('#f-surveyedBy-s1').value.trim());
        state.surveyDate = container.querySelector('#f-surveyDate-s1').value;
      };

      container.querySelector('#btn-cancel').addEventListener('click', () => { window.location.hash = '#/'; });
      container.querySelector('#btn-draft').addEventListener('click', () => {
        bindStep1();
        Store.saveDraft({ id: draftId || `draft-${Date.now()}`, taskId: state.taskId, savedAt: Date.now(), progress: 33, form: state });
        window.location.hash = '#/forms';
      });
      container.querySelector('#btn-next').addEventListener('click', () => {
        bindStep1();
        if (!state.houseNo) { alert(BHW_STRINGS.errors.houseNoEmpty); return; }
        if (!state.purokId) { alert(BHW_STRINGS.errors.purokEmpty); return; }
        if (!state.headOfFamily || state.age === '' || !state.sex || state.personsSlept === '') {
          alert('Please complete all required (*) household fields.');
          return;
        }
        if (!state.surveyedBy) {
          alert(BHW_STRINGS.errors.surveyedByEmpty);
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

        <div class="bhw-panel" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px;">
          <button id="btn-prev" class="bhw-pill-btn outline" type="button">Previous</button>
          <div style="display:flex; gap:10px;">
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
          const isCustomType = item.containerType && !types.includes(item.containerType);

          box.innerHTML = `
            <div class="bhw-container-row-top">
              <div class="bhw-field" style="flex:1; margin-bottom:0;">
                <label>Type of container</label>
                <select class="bhw-control c-type" ${isDisabled ? 'disabled' : ''}>
                  <option value="">Select type of container (optional)</option>
                  ${types.map(t => `<option value="${t}" ${item.containerType === t ? 'selected' : ''}>${t}</option>`).join('')}
                  ${isCustomType ? `<option value="${item.containerType}" selected>${item.containerType}</option>` : ''}
                </select>
              </div>
              ${locItems.length > 1 ? `
                <button type="button" class="bhw-pill-btn outline sm rm-btn" style="height:42px; color:#C81E1E; border-color:#FECACA;" ${isDisabled ? 'disabled' : ''}>
                  ${icon('trash', 12)} Remove
                </button>
              ` : ''}
            </div>

            <div class="bhw-container-nums ${loc === 'natural' ? 'natural-grid' : ''}">
              ${loc !== 'natural' ? `
                <div class="bhw-field">
                  <label>With cover</label>
                  <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-with" value="${item.withCover}" ${isDisabled ? 'disabled' : ''}>
                </div>
                <div class="bhw-field">
                  <label>Without cover</label>
                  <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-without" value="${item.withoutCover}" ${isDisabled ? 'disabled' : ''}>
                </div>
                <div class="bhw-field">
                  <label>Total</label>
                  <div class="bhw-total-readout c-total">${item.total}</div>
                </div>
              ` : `
                <div class="bhw-field">
                  <label>Total found</label>
                  <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-nat-total" value="${item.total}" ${isDisabled ? 'disabled' : ''}>
                </div>
              `}
              <div class="bhw-field">
                <label>Positive (+)</label>
                <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-pos" value="${item.positive}" ${isDisabled ? 'disabled' : ''}>
              </div>
              <div class="bhw-field">
                <label>No. of larvae</label>
                <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-larvae" value="${item.larvaeCount}" ${isDisabled ? 'disabled' : ''}>
              </div>
              <div class="bhw-field">
                <label>No. of pupae</label>
                <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-pupae" value="${item.pupaeCount}" ${isDisabled ? 'disabled' : ''}>
              </div>
            </div>
          `;

          box.querySelector('.c-type').addEventListener('change', e => {
            let val = e.target.value;
            if (val === 'Others') {
              const custom = prompt('Specify container name (e.g. Pale, Basin):');
              val = custom ? formatPersonName(custom.trim()) : '';
            }
            item.containerType = val;
            render();
          });

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

          box.querySelectorAll('input[type="number"]').forEach(inp => {
            attachNonNegativeGuard(inp, false, recalc);
          });

          box.querySelector('.rm-btn')?.addEventListener('click', () => {
            state.containers = state.containers.filter(c => c !== item);
            render();
          });

          rowsContainer.appendChild(box);
        });

        sec.querySelector('.bhw-add-small-btn').addEventListener('click', () => {
          if (state.noContainersFound) return;
          state.containers.push({ location: loc, containerType: '', withCover: 0, withoutCover: 0, total: 0, positive: 0, larvaeCount: 0, pupaeCount: 0 });
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
        Store.saveDraft({ id: draftId || `draft-${Date.now()}`, taskId: state.taskId, savedAt: Date.now(), progress: 66, form: state });
        window.location.hash = '#/forms';
      });
      container.querySelector('#btn-next').addEventListener('click', () => {
        const rowsWithCountsButNoType = state.containers.filter(c => !c.containerType && (c.total > 0 || c.positive > 0 || c.larvaeCount > 0 || c.pupaeCount > 0));
        if (rowsWithCountsButNoType.length > 0) {
          alert('Please select a container type for any row where you entered container counts.');
          return;
        }

        const filledContainers = state.containers.filter(c => c.containerType && c.total > 0);
        if (!state.noContainersFound && filledContainers.length === 0) {
          alert(BHW_STRINGS.errors.noRowsOrChecked);
          return;
        }
        for (const c of filledContainers) {
          if (c.positive > c.total) {
            alert(BHW_STRINGS.errors.positiveExceeds(c.containerType, c.location));
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

      const sumGroup = (list) => list.reduce((acc, c) => ({
        withCover: acc.withCover + (Number(c.withCover) || 0),
        withoutCover: acc.withoutCover + (Number(c.withoutCover) || 0),
        total: acc.total + (Number(c.total) || 0),
        positive: acc.positive + (Number(c.positive) || 0),
        larvae: acc.larvae + (Number(c.larvaeCount) || 0),
        pupae: acc.pupae + (Number(c.pupaeCount) || 0)
      }), { withCover: 0, withoutCover: 0, total: 0, positive: 0, larvae: 0, pupae: 0 });

      const totals = sumGroup(validConts);
      const cIndex = totals.total > 0 ? ((totals.positive / totals.total) * 100).toFixed(1) : '0.0';
      const completionPct = state.certified ? 100 : 67;

      const locLabels = {
        indoor: 'A. Indoor Containers',
        outdoor: 'B. Outdoor Containers',
        natural: 'C. Natural Containers'
      };

      const renderGroupedTableRows = () => {
        if (validConts.length === 0) {
          return `<tr><td colspan="7" style="text-align:center; color:#6B7280; padding:14px;">No water containers recorded (No containers found at this household).</td></tr>`;
        }
        return ['indoor', 'outdoor', 'natural'].map(loc => {
          const rows = validConts.filter(c => c.location === loc);
          if (rows.length === 0) return '';
          const sub = sumGroup(rows);
          return `
            <tr class="cat-row"><td colspan="7">${locLabels[loc]}</td></tr>
            ${rows.map(c => `
              <tr>
                <td><strong>${c.containerType}</strong></td>
                <td>${loc === 'natural' ? '—' : c.withCover}</td>
                <td>${c.withoutCover}</td>
                <td><strong>${c.total}</strong></td>
                <td>${c.positive}</td>
                <td>${c.larvaeCount}</td>
                <td>${c.pupaeCount}</td>
              </tr>
            `).join('')}
            <tr style="background:#FCFDFC; font-weight:600; color:#374151;">
              <td>Subtotal (${loc})</td>
              <td>${loc === 'natural' ? '—' : sub.withCover}</td>
              <td>${sub.withoutCover}</td>
              <td>${sub.total}</td>
              <td>${sub.positive}</td>
              <td>${sub.larvae}</td>
              <td>${sub.pupae}</td>
            </tr>
          `;
        }).join('');
      };

      container.innerHTML = `
        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Review and submit</h2>
              <p class="bhw-panel-sub">Verify all household, container, and BHW surveyor entries before final submission.</p>
            </div>
          </div>

          <div class="bhw-result-banner ${totals.positive > 0 ? 'is-alert' : ''}">
            <div>
              <div style="font-size:11px; font-weight:800; color:${totals.positive > 0 ? '#C81E1E' : '#134E3A'}; text-transform:uppercase; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                <span class="bhw-dot ${totals.positive > 0 ? 'red' : 'green'}"></span> INSPECTION RESULT
              </div>
              <strong style="font-size:16px; display:block;">${totals.positive === 0 ? 'No larvae or pupae detected' : `${totals.positive} positive container(s) with larvae/pupae detected`}</strong>
              <span style="font-size:12px; color:#6B7280;">House ${state.houseNo} · ${state.headOfFamily} · ${purokLabel}, Barangay ${me.barangay.name}</span>
            </div>
            <div style="text-align:right;">
              <strong style="font-size:26px; color:${totals.positive > 0 ? '#C81E1E' : '#134E3A'};">${totals.positive}</strong><span style="font-size:14px; color:#6B7280;"> / ${totals.total}</span>
              <div style="font-size:11px; color:#6B7280;">containers positive (${cIndex}% CI)</div>
            </div>
          </div>

          <div class="bhw-review-grid-2col">
            <div class="bhw-review-box no-mb">
              <div class="bhw-review-hdr">
                <span>HOUSEHOLD INFORMATION</span>
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
                <span>BUILDING STRUCTURE</span>
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

          <div class="bhw-review-box">
            <div class="bhw-review-hdr">
              <span>WATER CONTAINERS PRESENT (DENGUE FORM 5)</span>
              <button type="button" id="edit-s2" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:700;color:#134E3A;display:inline-flex;align-items:center;gap:5px;">${icon('edit', 13)} Edit containers</button>
            </div>
            <div class="bhw-stat-strip-6">
              <div><span style="font-size:11px;color:#6B7280;display:block;">Inspected</span><strong style="font-size:18px;">${totals.total}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">With cover</span><strong style="font-size:18px;">${totals.withCover}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">Without cover</span><strong style="font-size:18px;">${totals.withoutCover}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">Positive (+)</span><strong style="font-size:18px;color:${totals.positive > 0 ? '#C81E1E' : '#111827'};">${totals.positive}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">Larvae</span><strong style="font-size:18px;">${totals.larvae}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">Pupae</span><strong style="font-size:18px;">${totals.pupae}</strong></div>
            </div>

            <table class="bhw-table">
              <thead>
                <tr>
                  <th>Type of container</th>
                  <th>With cover</th>
                  <th>Without cover</th>
                  <th>Total</th>
                  <th>(+) Containers</th>
                  <th>Larvae</th>
                  <th>Pupae</th>
                </tr>
              </thead>
              <tbody>
                ${renderGroupedTableRows()}
              </tbody>
            </table>

            <div class="bhw-total-bar">
              <span>Total, all containers</span>
              <span>${totals.withCover}</span>
              <span>${totals.withoutCover}</span>
              <span>${totals.total}</span>
              <span>${totals.positive}</span>
              <span>${totals.larvae}</span>
              <span>${totals.pupae}</span>
            </div>
          </div>

          <div class="bhw-review-box no-mb">
            <div class="bhw-review-hdr">
              <span>SURVEY DETAILS · CONDUCTED BY</span>
            </div>
            <div style="padding: 16px 18px;">
              <div class="bhw-form-grid-2">
                <div class="bhw-field">
                  <label>Surveyed by (BHW Full Name) <span class="req">*</span></label>
                  <input id="f-surveyedBy" class="bhw-control" type="text" maxlength="100" autocomplete="off" placeholder="e.g. Maria L. Reyes" value="${state.surveyedBy}">
                  <span style="font-size:11px; color:#6B7280; display:block; margin-top:4px;">Required because this barangay shares a single console account.</span>
                </div>
                <div class="bhw-field">
                  <label>Date of survey <span class="req">*</span></label>
                  <input id="f-surveyDate" class="bhw-control" type="date" value="${state.surveyDate}">
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="bhw-panel">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
              <h2 class="bhw-panel-title">Certification & submission</h2>
              <p class="bhw-panel-sub">Confirm that the entomological findings above match the household inspection.</p>
            </div>
            <strong style="font-size:15px; color:#134E3A;">${completionPct}% complete</strong>
          </div>

          <div class="bhw-progress-track" style="margin-bottom:14px;">
            <div class="bhw-progress-fill" style="width:${completionPct}%;"></div>
          </div>

          <div class="bhw-switch-row" style="border-top:none; padding-top:4px;">
            <button id="sw-cert" type="button" class="bhw-switch ${state.certified ? 'on' : ''}">
              <div class="bhw-switch-knob"></div>
            </button>
            <strong style="font-size:13px;">I certify that the information provided in this Dengue Form 5 survey is true and correct.</strong>
          </div>
        </section>

        <div class="bhw-panel" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px;">
          <button id="btn-prev" class="bhw-pill-btn outline" type="button">Previous</button>
          <div style="display:flex; gap:10px;">
            <button id="btn-draft" class="bhw-pill-btn outline" type="button">${icon('save', 14)} Save draft</button>
            <button id="btn-submit" class="bhw-pill-btn primary" type="button" ${!state.certified ? 'disabled' : ''}>${icon('send', 14)} Submit form</button>
          </div>
        </div>
      `;

      attachNameAutoCap(container.querySelector('#f-surveyedBy'), val => { state.surveyedBy = val; });
      container.querySelector('#f-surveyDate').addEventListener('change', e => { state.surveyDate = e.target.value; });

      container.querySelectorAll('.edit-s1').forEach(b => b.addEventListener('click', () => { state.step = 1; render(); }));
      container.querySelector('#edit-s2').addEventListener('click', () => { state.step = 2; render(); });

      container.querySelector('#sw-cert').addEventListener('click', () => {
        state.surveyedBy = formatPersonName(container.querySelector('#f-surveyedBy').value.trim());
        state.surveyDate = container.querySelector('#f-surveyDate').value;
        state.certified = !state.certified;
        render();
      });

      container.querySelector('#btn-prev').addEventListener('click', () => { state.step = 2; render(); });
      container.querySelector('#btn-draft').addEventListener('click', () => {
        Store.saveDraft({ id: draftId || `draft-${Date.now()}`, taskId: state.taskId, savedAt: Date.now(), progress: 90, form: state });
        window.location.hash = '#/forms';
      });

      container.querySelector('#btn-submit').addEventListener('click', async () => {
        state.surveyedBy = formatPersonName(container.querySelector('#f-surveyedBy').value.trim());
        state.surveyDate = container.querySelector('#f-surveyDate').value;

        if (!state.surveyedBy) {
          alert(BHW_STRINGS.errors.surveyedByEmpty);
          return;
        }

        const today = new Date().setHours(0, 0, 0, 0);
        const selDate = new Date(state.surveyDate).setHours(0, 0, 0, 0);
        if (selDate > today) {
          alert(BHW_STRINGS.errors.dateFuture);
          return;
        }
        if ((today - selDate) > 14 * 86400000) {
          alert(BHW_STRINGS.errors.dateTooOld);
          return;
        }

        const payload = {
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
          surveyedBy: state.surveyedBy,
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
          completeTask: false
        };

        try {
          const submitBtn = container.querySelector('#btn-submit');
          submitBtn.disabled = true;
          const res = await post('/api/bhw/surveys', payload);
          if (draftId) Store.deleteDraft(draftId);
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
          alert('Findings submitted. The barangay was re-scored.');
          window.location.hash = '#/forms';
        } catch (err) {
          if (err.status === 400 && err.data?.error) {
            alert(err.data.error);
            container.querySelector('#btn-submit').disabled = false;
            return;
          }
          Store.enqueue({
            id: `queue-${Date.now()}`,
            queuedAt: Date.now(),
            taskId: state.taskId,
            purokName: purokLabel,
            payload
          });
          if (draftId) Store.deleteDraft(draftId);
          updateSyncBadge();
          alert('No connection. Your findings are saved on this phone and will be sent when you press Synchronize.');
          window.location.hash = '#/forms';
        }
      });
    }
  };

  render();
}