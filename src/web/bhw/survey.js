import { Store } from './store.js';
import { get, post } from '../shared/api.js';
import { updateSyncBadge } from './dashboard.js';
import { BHW_STRINGS } from './strings.js';
import { icon } from './icons.js';

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
    activeTab: 'indoor',
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
    surveyedBy: me.name || '',
    surveyDate: new Date().toISOString().split('T')[0],
    noContainersFound: false,
    certified: false,
    containers: [
      { location: 'indoor', containerType: '', withCover: 0, withoutCover: 0, total: 0, positive: 0, larvaeCount: 0, pupaeCount: 0 }
    ]
  };

  if (draftId) {
    const found = Store.getDrafts().find(d => d.id === draftId);
    if (found) state = { ...state, ...found.form };
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
              <input id="f-head" class="bhw-control" type="text" placeholder="Full name" autocomplete="off" value="${state.headOfFamily}">
            </div>
            <div class="bhw-field">
              <label>Age <span class="req">*</span></label>
              <input id="f-age" class="bhw-control" type="number" inputmode="numeric" value="${state.age}">
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
              <input id="f-slept" class="bhw-control" type="number" inputmode="numeric" value="${state.personsSlept}">
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
              <input id="f-rooms" class="bhw-control" type="number" inputmode="numeric" value="${state.rooms}">
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

      const bindStep1 = () => {
        state.houseNo = container.querySelector('#f-houseNo').value.trim();
        state.purokId = container.querySelector('#f-purokId').value;
        const pObj = me.puroks.find(p => String(p.id) === String(state.purokId));
        state.purokName = pObj ? pObj.name : '';
        state.headOfFamily = container.querySelector('#f-head').value.trim();
        state.age = container.querySelector('#f-age').value;
        state.sex = container.querySelector('#f-sex').value;
        state.civilStatus = container.querySelector('#f-civil').value;
        state.occupation = container.querySelector('#f-occ').value.trim();
        state.personsSlept = container.querySelector('#f-slept').value;
        state.schoolName = container.querySelector('#f-school').value.trim();
        state.buildingStructure = container.querySelector('#f-struct').value;
        state.storeys = container.querySelector('#f-storeys').value;
        state.screening = container.querySelector('#f-screen').value;
        state.rooms = container.querySelector('#f-rooms').value;
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
        if (!state.headOfFamily || !state.age || !state.sex || !state.personsSlept) {
          alert('Please complete all required (*) household fields.');
          return;
        }
        state.step = 2;
        render();
      });

    } else if (state.step === 2) {
      const loc = state.activeTab || 'indoor';
      const locItems = state.containers.filter(c => c.location === loc);

      container.innerHTML = `
        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Types of water containers present</h2>
              <p class="bhw-panel-sub">Record only the containers found at this household.</p>
            </div>
            <span class="bhw-collapse-icon">${icon('chevronUp', 14)}</span>
          </div>

          <div class="bhw-seg-tabs">
            <button type="button" class="bhw-seg-tab ${loc === 'indoor' ? 'active' : ''}" data-loc="indoor">Indoor containers</button>
            <button type="button" class="bhw-seg-tab ${loc === 'outdoor' ? 'active' : ''}" data-loc="outdoor">Outdoor containers</button>
            <button type="button" class="bhw-seg-tab ${loc === 'natural' ? 'active' : ''}" data-loc="natural">Natural containers</button>
          </div>

          <div id="containers-list"></div>

          <button id="btn-add-cont" type="button" class="bhw-dashed-add">${icon('plus', 14)} Add another ${loc} container</button>

          <div class="bhw-switch-row">
            <button id="sw-nocont" type="button" class="bhw-switch ${state.noContainersFound ? 'on' : ''}" aria-pressed="${state.noContainersFound}">
              <div class="bhw-switch-knob"></div>
            </button>
            <strong style="font-size:13px;">No containers found at this household</strong>
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

      container.querySelectorAll('.bhw-seg-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          state.activeTab = btn.dataset.loc;
          render();
        });
      });

      const listEl = container.querySelector('#containers-list');
      locItems.forEach((item, idx) => {
        const box = document.createElement('div');
        box.className = 'bhw-container-box';
        const types = BHW_STRINGS.containers[loc] || [];
        const isCustomType = item.containerType && !types.includes(item.containerType);

        box.innerHTML = `
          <div class="bhw-container-box-hdr">
            <span>${loc.toUpperCase()} CONTAINER ${idx + 1}</span>
            ${state.containers.length > 1 ? `<button type="button" class="rm-btn" style="background:none;border:none;color:#C81E1E;cursor:pointer;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">${icon('trash', 12)} Remove</button>` : ''}
          </div>
          <div style="padding: 16px;">
            <div class="bhw-field">
              <label>Type of container</label>
              <select class="bhw-control c-type">
                <option value="">Select type of container</option>
                ${types.map(t => `<option value="${t}" ${item.containerType === t ? 'selected' : ''}>${t}</option>`).join('')}
                ${isCustomType ? `<option value="${item.containerType}" selected>${item.containerType}</option>` : ''}
              </select>
            </div>
            <div class="bhw-container-nums">
              <div class="bhw-field">
                <label>With cover</label>
                <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-with" value="${item.withCover}" ${loc === 'natural' ? 'disabled' : ''}>
              </div>
              <div class="bhw-field">
                <label>Without cover</label>
                <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-without" value="${item.withoutCover}">
              </div>
              <div class="bhw-field" style="text-align:center;">
                <label>Total</label>
                <strong class="c-total" style="font-size:15px; display:block; padding-top:6px;">${item.total}</strong>
              </div>
              <div class="bhw-field">
                <label>Positive (+)</label>
                <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-pos" value="${item.positive}">
              </div>
              <div class="bhw-field">
                <label>Larvae</label>
                <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-larvae" value="${item.larvaeCount}">
              </div>
              <div class="bhw-field">
                <label>Pupae</label>
                <input type="number" min="0" inputmode="numeric" class="bhw-num-input c-pupae" value="${item.pupaeCount}">
              </div>
            </div>
          </div>
        `;

        box.querySelector('.c-type').addEventListener('change', e => {
          let val = e.target.value;
          if (val === 'Others') {
            val = prompt('Specify container name:') || 'Others';
          }
          item.containerType = val;
          render();
        });

        const recalc = () => {
          item.withCover = loc === 'natural' ? 0 : (parseInt(box.querySelector('.c-with').value, 10) || 0);
          item.withoutCover = parseInt(box.querySelector('.c-without').value, 10) || 0;
          item.total = item.withCover + item.withoutCover;
          item.positive = parseInt(box.querySelector('.c-pos').value, 10) || 0;
          item.larvaeCount = parseInt(box.querySelector('.c-larvae').value, 10) || 0;
          item.pupaeCount = parseInt(box.querySelector('.c-pupae').value, 10) || 0;
          box.querySelector('.c-total').textContent = String(item.total);
        };

        box.querySelectorAll('input').forEach(inp => inp.addEventListener('input', recalc));
        box.querySelector('.rm-btn')?.addEventListener('click', () => {
          state.containers = state.containers.filter(c => c !== item);
          render();
        });

        listEl.appendChild(box);
      });

      container.querySelector('#btn-add-cont').addEventListener('click', () => {
        state.noContainersFound = false;
        state.containers.push({ location: loc, containerType: '', withCover: 0, withoutCover: 0, total: 0, positive: 0, larvaeCount: 0, pupaeCount: 0 });
        render();
      });

      container.querySelector('#sw-nocont').addEventListener('click', () => {
        state.noContainersFound = !state.noContainersFound;
        if (state.noContainersFound) state.containers = [];
        render();
      });

      container.querySelector('#btn-prev').addEventListener('click', () => { state.step = 1; render(); });
      container.querySelector('#btn-draft').addEventListener('click', () => {
        Store.saveDraft({ id: draftId || `draft-${Date.now()}`, taskId: state.taskId, savedAt: Date.now(), progress: 66, form: state });
        window.location.hash = '#/forms';
      });
      container.querySelector('#btn-next').addEventListener('click', () => {
        const validContainers = state.containers.filter(c => c.containerType && c.total > 0);
        if (!state.noContainersFound && validContainers.length === 0) {
          alert(BHW_STRINGS.errors.noRowsOrChecked);
          return;
        }
        if (state.noContainersFound && validContainers.length > 0) {
          alert(BHW_STRINGS.errors.rowsAndChecked);
          return;
        }
        for (const c of validContainers) {
          if (c.positive > c.total) {
            alert(BHW_STRINGS.errors.positiveExceeds(c.containerType, c.location));
            return;
          }
        }
        state.step = 3;
        render();
      });

    } else if (state.step === 3) {
      const validConts = state.containers.filter(c => c.containerType && c.total > 0);
      const totals = validConts.reduce((acc, c) => ({
        withCover: acc.withCover + (Number(c.withCover) || 0),
        withoutCover: acc.withoutCover + (Number(c.withoutCover) || 0),
        total: acc.total + (Number(c.total) || 0),
        positive: acc.positive + (Number(c.positive) || 0),
        larvae: acc.larvae + (Number(c.larvaeCount) || 0),
        pupae: acc.pupae + (Number(c.pupaeCount) || 0)
      }), { withCover: 0, withoutCover: 0, total: 0, positive: 0, larvae: 0, pupae: 0 });

      const cIndex = totals.total > 0 ? ((totals.positive / totals.total) * 100).toFixed(1) : '0.0';
      const completionPct = state.certified ? 100 : 67;

      container.innerHTML = `
        <section class="bhw-panel">
          <div class="bhw-panel-header">
            <div>
              <h2 class="bhw-panel-title">Review and submit</h2>
              <p class="bhw-panel-sub">Verify all entries before submission.</p>
            </div>
            <span class="bhw-collapse-icon">${icon('chevronUp', 14)}</span>
          </div>

          <div class="bhw-result-banner">
            <div>
              <div style="font-size:11px; font-weight:800; color:#134E3A; text-transform:uppercase; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                <span class="bhw-dot green"></span> INSPECTION RESULT
              </div>
              <strong style="font-size:16px; display:block;">${totals.positive === 0 ? 'No larvae or pupae detected' : 'Larvae or pupae detected'}</strong>
              <span style="font-size:12px; color:#6B7280;">House ${state.houseNo}, ${purokLabel}</span>
            </div>
            <div style="text-align:right;">
              <strong style="font-size:24px; color:#134E3A;">${totals.positive}</strong><span style="font-size:14px; color:#6B7280;">/${totals.total}</span>
              <div style="font-size:11px; color:#6B7280;">containers positive</div>
            </div>
          </div>

          <div class="bhw-review-box">
            <div class="bhw-review-hdr">
              <span>HOUSEHOLD INFORMATION</span>
              <button type="button" class="edit-s1" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;">${icon('edit', 13)} Edit</button>
            </div>
            <div class="bhw-review-grid-3">
              <div class="bhw-review-cell"><span>House no.</span><strong>${state.houseNo || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Municipality/City</span><strong>Daraga</strong></div>
              <div class="bhw-review-cell"><span>Purok/Sitio</span><strong>${purokLabel}</strong></div>
              <div class="bhw-review-cell"><span>Barangay</span><strong>${me.barangay.name}</strong></div>
              <div class="bhw-review-cell"><span>Head of the family</span><strong>${state.headOfFamily || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Age</span><strong>${state.age || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Sex</span><strong>${state.sex || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Civil status</span><strong>${state.civilStatus || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Occupation</span><strong>${state.occupation || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Persons who slept here</span><strong>${state.personsSlept || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Name of school</span><strong>${state.schoolName || '—'}</strong></div>
              <div class="bhw-review-cell shaded"></div>
            </div>
          </div>

          <div class="bhw-review-box">
            <div class="bhw-review-hdr">
              <span>BUILDING STRUCTURE</span>
              <button type="button" class="edit-s1" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;">${icon('edit', 13)} Edit</button>
            </div>
            <div class="bhw-review-grid-3">
              <div class="bhw-review-cell"><span>Structure</span><strong>${state.buildingStructure || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Storeys</span><strong>${state.storeys || '—'}</strong></div>
              <div class="bhw-review-cell"><span>No. of rooms</span><strong>${state.rooms || '—'}</strong></div>
              <div class="bhw-review-cell"><span>Screening</span><strong>${state.screening || '—'}</strong></div>
              <div class="bhw-review-cell shaded"></div>
              <div class="bhw-review-cell shaded"></div>
            </div>
          </div>

          <div class="bhw-review-box">
            <div class="bhw-review-hdr">
              <span>WATER CONTAINERS PRESENT</span>
              <button type="button" id="edit-s2" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;">${icon('edit', 13)} Edit</button>
            </div>
            <div class="bhw-stat-strip-6">
              <div><span style="font-size:11px;color:#6B7280;display:block;">Inspected</span><strong style="font-size:18px;">${totals.total}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">With cover</span><strong style="font-size:18px;">${totals.withCover}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">Without cover</span><strong style="font-size:18px;">${totals.withoutCover}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">Positive (+)</span><strong style="font-size:18px;">${totals.positive}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">Larvae</span><strong style="font-size:18px;">${totals.larvae}</strong></div>
              <div><span style="font-size:11px;color:#6B7280;display:block;">Pupae</span><strong style="font-size:18px;">${totals.pupae}</strong></div>
            </div>
            <div style="padding: 0 16px 8px; font-size:12px; color:#6B7280;">Container index (positive ÷ inspected): <strong style="color:#111827">${cIndex}%</strong></div>

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
                ${validConts.map(c => `
                  <tr>
                    <td><strong>${c.containerType}</strong></td>
                    <td>${c.withCover}</td>
                    <td>${c.withoutCover}</td>
                    <td>${c.total}</td>
                    <td>${c.positive}</td>
                    <td>${c.larvaeCount}</td>
                    <td>${c.pupaeCount}</td>
                  </tr>
                `).join('')}
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

          <div class="bhw-review-box" style="padding: 16px;">
            <div style="font-size:12px; font-weight:800; color:#134E3A; text-transform:uppercase; margin-bottom:12px;">SURVEY DETAILS</div>
            <div class="bhw-form-grid-2">
              <div class="bhw-field">
                <label>Surveyed by <span class="req">*</span></label>
                <input id="f-surveyedBy" class="bhw-control" type="text" maxlength="100" placeholder="Name of BHW" value="${state.surveyedBy}">
                <span style="font-size:11px; color:#6B7280; display:block; margin-top:4px;">Enter the name of the BHW who conducted this survey.</span>
              </div>
              <div class="bhw-field">
                <label>Date <span class="req">*</span></label>
                <input id="f-surveyDate" class="bhw-control" type="date" value="${state.surveyDate}">
              </div>
            </div>
          </div>
        </section>

        <section class="bhw-panel">
          <h2 class="bhw-panel-title">Survey summary</h2>
          <p class="bhw-panel-sub" style="margin-bottom:14px;">Final check before submission.</p>

          <div style="background:#F9FAFB; border:1px solid #E4E8E6; border-radius:10px; padding:4px 16px; margin-bottom:16px;">
            <div class="bhw-purok-row" style="border-top:none;"><span>House no.</span><strong>${state.houseNo}</strong></div>
            <div class="bhw-purok-row"><span>Purok</span><strong>${purokLabel}</strong></div>
            <div class="bhw-purok-row"><span>Head of family</span><strong>${state.headOfFamily}</strong></div>
            <div class="bhw-purok-row"><span>Containers inspected</span><strong>${totals.total}</strong></div>
            <div class="bhw-purok-row"><span>Positive (+)</span><strong>${totals.positive}</strong></div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="font-size:12px;">Overall completion</strong>
            <strong style="font-size:14px; color:#134E3A;">${completionPct}%</strong>
          </div>
          <div class="bhw-progress-track" style="margin-bottom:12px;">
            <div class="bhw-progress-fill" style="width:${completionPct}%;"></div>
          </div>

          <div style="font-size:12px; display:flex; flex-direction:column; gap:6px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between;"><span>Household information</span><strong style="color:#134E3A;">Complete</strong></div>
            <div style="display:flex; justify-content:space-between;"><span>Water containers</span><strong style="color:#134E3A;">Complete</strong></div>
            <div style="display:flex; justify-content:space-between;"><span>Certification</span><strong style="color:${state.certified ? '#134E3A' : '#B45309'};">${state.certified ? 'Complete' : 'Pending'}</strong></div>
          </div>

          <div class="bhw-switch-row">
            <button id="sw-cert" type="button" class="bhw-switch ${state.certified ? 'on' : ''}">
              <div class="bhw-switch-knob"></div>
            </button>
            <strong style="font-size:13px;">I certify that the information provided is correct.</strong>
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

      container.querySelectorAll('.edit-s1').forEach(b => b.addEventListener('click', () => { state.step = 1; render(); }));
      container.querySelector('#edit-s2').addEventListener('click', () => { state.step = 2; render(); });
      container.querySelector('#f-surveyedBy').addEventListener('input', e => { state.surveyedBy = e.target.value; });
      container.querySelector('#f-surveyDate').addEventListener('change', e => { state.surveyDate = e.target.value; });

      container.querySelector('#sw-cert').addEventListener('click', () => {
        state.surveyedBy = container.querySelector('#f-surveyedBy').value.trim();
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
        state.surveyedBy = container.querySelector('#f-surveyedBy').value.trim();
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

        // Exact POST /api/bhw/surveys schema for aedispatch.db
        const payload = {
          ...(state.taskId ? { taskId: Number(state.taskId) } : {}),
          purokId: Number(state.purokId),
          houseNo: state.houseNo,
          headOfFamily: state.headOfFamily || undefined,
          age: state.age ? Number(state.age) : undefined,
          sex: state.sex || undefined,
          civilStatus: state.civilStatus || undefined,
          occupation: state.occupation || undefined,
          personsSlept: state.personsSlept ? Number(state.personsSlept) : undefined,
          buildingStructure: state.buildingStructure || undefined,
          storeys: state.storeys === 'Single storey' ? 1 : state.storeys ? 2 : undefined,
          rooms: state.rooms ? Number(state.rooms) : undefined,
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