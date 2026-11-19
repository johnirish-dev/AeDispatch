import { BHW_STRINGS } from './strings.js';
import { icon } from './icons.js';
import { esc, sumGroup } from './review.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatSurveyDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

export function formatStamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Printed form layout: standard rows are fixed, "Others, specify" lines hold the custom names.
const SECTIONS = [
  { key: 'indoor', title: 'A. INDOOR CONTAINERS', spare: 2 },
  { key: 'outdoor', title: 'B. OUTDOOR CONTAINERS', spare: 4 },
  { key: 'natural', title: 'C. NATURAL CONTAINERS', spare: 3 }
];

const field = (label, value, extra = '') =>
  `<div class="bhw-pf ${extra}"><span class="lbl">${label}</span><span class="val">${esc(value)}</span></div>`;

const norm = (s) => String(s ?? '').trim().toLowerCase();

function checkRow(label, checked) {
  return `<div class="bhw-pc"><span class="blank">${checked ? icon('check', 13, 2) : ''}</span><span>${label}</span></div>`;
}

export function renderFormPaper({ details = {}, containers = [], houseNo, head, purok, barangay, stampLabel, stampTs }) {
  const d = details;
  const structure = norm(d.buildingStructure);
  const st = d.storeys;
  const single = st === 1 || norm(st) === 'single storey';
  const multi = (typeof st === 'number' && st >= 2) || norm(st) === '2 or more storeys';
  const screened = d.screening === 'Screened' || d.screened === true;
  const unscreened = d.screening === 'Unscreened' || d.screened === false;

  const conts = containers.filter((c) => c.containerType);
  const totals = sumGroup(conts);

  const blank = (n) => (Number(n) > 0 ? n : '');

  const bodyRows = SECTIONS.map((sec) => {
    const natural = sec.key === 'natural';
    const inSec = conts.filter((c) => c.location === sec.key);
    const standard = (BHW_STRINGS.containers[sec.key] || []).filter((t) => t !== 'Others');
    const standardKeys = new Set(standard.map(norm));
    const custom = inSec.filter((c) => !standardKeys.has(norm(c.containerType)));
    const otherNo = standard.length + 1;

    const cells = (rows) => {
      const s = sumGroup(rows);
      return `
        ${natural ? '<td class="grey"></td><td class="grey"></td>' : `<td>${blank(s.withCover)}</td><td>${blank(s.withoutCover)}</td>`}
        <td>${blank(s.total)}</td>
        <td>${blank(s.positive)}</td>
        <td>${blank(s.larvae)}</td>
        <td>${blank(s.pupae)}</td>`;
    };

    const stdRows = standard.map((name, i) => {
      const match = inSec.filter((c) => norm(c.containerType) === norm(name));
      return `<tr><td class="nm">${i + 1}.&nbsp;&nbsp;${name}</td>${cells(match)}</tr>`;
    }).join('');

    const slots = Math.max(sec.spare, custom.length);
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const spareRows = Array.from({ length: slots }, (_, i) => {
      const c = custom[i];
      return `<tr><td class="nm">${otherNo}${letters[i]}.${c ? `&nbsp;&nbsp;${esc(c.containerType)}` : ''}</td>${cells(c ? [c] : [])}</tr>`;
    }).join('');

    return `
      <tr class="sec"><th colspan="7" scope="colgroup">${sec.title}</th></tr>
      ${stdRows}
      <tr><td class="nm">${otherNo}.&nbsp;&nbsp;Others, specify</td>${cells([])}</tr>
      ${spareRows}`;
  }).join('');

  return `
    <div class="bhw-paper-scroll">
      <article class="bhw-paper" aria-label="Dengue Form 5">
        <div class="bhw-paper-tag">Dengue Form - 5</div>
        <header class="bhw-paper-title">
          <div>NATIONAL DENGUE PREVENTION AND CONTROL PROGRAM</div>
          <div>DENGUE ENTOMOLOGICAL SURVEY</div>
          <strong>QUESTIONNAIRE</strong>
        </header>

        <div class="bhw-paper-grid">
          ${field('House No.', houseNo)}
          ${field('Name of School, if Applicable', d.schoolName)}
          ${field('Municipality/City', 'Daraga')}
          <div></div>
          ${field('Head of the Family', head)}
          ${field('Purok/Sitio', purok)}
          <div class="bhw-pf-trio">
            ${field('Age', d.age, 'w-age')}
            ${field('Sex', d.sex, 'w-sex')}
            ${field('Status', d.civilStatus, 'w-status')}
          </div>
          <div></div>
          ${field('Occupation', d.occupation)}
          ${field('Barangay', barangay)}
        </div>
        ${field('No. of person in the household who slept the night before the survey', d.personsSlept, 'full')}

        <h3 class="bhw-paper-h">I. Building Structure : (Please Check)</h3>
        <div class="bhw-paper-checks">
          <div>
            ${checkRow('Concrete', structure === 'concrete')}
            ${checkRow('Semi-Concrete', structure === 'semi-concrete')}
            ${checkRow('Light/wooden', structure === 'light/wooden')}
          </div>
          <div>
            ${checkRow('Shanty', structure === 'shanty')}
            ${checkRow('Single storey', single)}
            ${checkRow('2 or more storeys', multi)}
          </div>
          <div>
            <div class="bhw-pc"><span class="blank num">${esc(d.rooms ?? '')}</span><span>No. of rooms</span></div>
            ${checkRow('Screened', screened)}
            ${checkRow('Unscreened', unscreened)}
          </div>
        </div>

        <h3 class="bhw-paper-h">II. Types of water containers present.</h3>
        <div class="bhw-paper-table-scroll">
        <table class="bhw-paper-table">
          <thead>
            <tr>
              <th rowspan="2" class="corner"></th>
              <th colspan="2">NO. OF CONTAINERS</th>
              <th rowspan="2">TOTAL</th>
              <th rowspan="2">NO. OF CONTAINERS (+) FOR LARVA/PUPA</th>
              <th colspan="2">RESULTS/SPECIES</th>
            </tr>
            <tr>
              <th>WITH COVER</th>
              <th>WITHOUT COVER</th>
              <th>NO. OF LARVAE</th>
              <th>NO. OF PUPAE</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td class="nm">Total</td>
              <td>${totals.withCover}</td>
              <td>${totals.withoutCover}</td>
              <td>${totals.total}</td>
              <td>${totals.positive}</td>
              <td>${totals.larvae}</td>
              <td>${totals.pupae}</td>
            </tr>
          </tfoot>
        </table>
        </div>

        <div class="bhw-paper-sign">
          <div class="bhw-pf"><span class="lbl">Surveyed by :</span><span class="val">${esc(d.surveyedBy)}</span></div>
          <div class="bhw-pf"><span class="lbl">Date :</span><span class="val">${esc(formatSurveyDate(d.surveyDate))}</span></div>
          ${stampTs ? `<div class="bhw-paper-stamp">${stampLabel} ${formatStamp(stampTs)}</div>` : ''}
        </div>
      </article>
    </div>`;
}
