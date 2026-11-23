# AeDispatch

An early-warning decision-support and dispatch system for municipal dengue vector control. AeDispatch gives every barangay a threat score built from five kinds of data, ranks the barangays from highest to lowest threat, and recommends where the health office should send its limited field teams first. A health officer confirms or rejects every recommendation; nothing is dispatched automatically.

Course project for CS117 Software Engineering 1, BS Computer Science, Bicol University.
Team MuskiThree: Clint John Bonagua, Rhea Nicole Lumbes, John Irish Milallos.

## What the prototype shows

One working loop:

1. Data come in: weather, weekly confirmed cases, resident reports and checks, and BHW (barangay health worker) field surveys.
2. The affected barangay's threat score is recalculated and the ranking updates at once (Max Heap).
3. The health officer reviews the top-ranked barangays and confirms or rejects each recommendation.
4. A confirmed recommendation becomes a field task for the barangay's BHWs.
5. The BHW's survey goes back into the barangay's score.

### Parts

| Part | Who uses it | How to open it |
| --- | --- | --- |
| Municipal dashboard | Health officer | Browser on a computer |
| Resident app | Residents | Phone, by QR code from Demo tools |
| BHW field app | Barangay health workers | Phone, by QR code from Demo tools (one code per barangay) |
| Demo tools | Development team | Dashboard sidebar, "Demo tools" (tabs: Phones, Weather, Weights, Results) |

### How the score is built

Five factors, each from 0 to 1, with provisional starting weights:

| Factor | Starting weight | Comes from |
| --- | --- | --- |
| Weather | 20% | Past temperature and rain (municipal), a favorability index, not a forecast |
| Household and community reports | 15% | Residents' daily answers and household reports |
| Anonymous symptom checks | 10% | Checks with warning signs, per 1,000 residents, last 7 days |
| BHW field findings | 25% | BHW surveys of homes, containers and puroks |
| Confirmed cases | 30% | The weekly case file |

The weighted sum is adjusted for population density and shown on a 0–100 scale. Risk levels: Low below 25, Moderate to 40, Elevated to 70, High above. Sparse counts are smoothed (Bayesian) so a few reports do not swing a score, and a missing field survey falls back to a neutral starting value instead of changing the weights.

Recommended action: Tier 1 (Search and Destroy / larviciding) from a score of 40. Tier 2 (fogging review) only when a purok has more than 2 confirmed cases over the last two case weeks; a high score alone never unlocks it.

The weights are starting values. They have not been calibrated on real data.

### What residents and BHWs can do

- **Residents** (no login for the first three): see the risk level and the weather behind it, answer a daily question, do an anonymous symptom check, and, after signing in with a phone number and PIN, send a household report. A phone's symptom check counts once a day, a resident can send one household report in any 7 days, and the server limits how many warning-sign checks per barangay count each day.
- **BHWs:** open the barangay with its access code, see the tasks, fill in a survey (the surveyor's name is typed), and see the surveys of the last 30 days. Surveys are kept on the phone and sent automatically when there is a connection; a repeated send does not create a duplicate.

## Requirements

- Node.js 20 or later
- Git

No separate database server is needed; the data are kept in an SQLite file.

## Installation

```bash
git clone https://github.com/johnirish-dev/AeDispatch.git
cd AeDispatch
npm install
cp .env.example .env      # on Windows PowerShell: copy .env.example .env
npm run seed
npm run dev
```

Then open http://localhost:3000.

`npm run seed` creates the database with 8 barangays, 8 weeks of history, and sample reports and findings. Run it again at any time to reset the demo data. To rehearse an exact day, set `SEED_DATE=YYYY-MM-DD` first.

For a production-style run: `npm run build`, then `npm start`.

### Settings (`.env`)

| Setting | Meaning |
| --- | --- |
| `PORT` | Port to run on (default 3000) |
| `SESSION_SECRET` | Signs resident sign-in cookies. Any long random text. Empty = a random one at each start (everyone is signed out on restart) |
| `PHONE_HASH_SALT` | Scrambles residents' phone numbers before they are stored. Use long random text and do not change it after residents have signed in. Empty = a built-in development value (a warning is printed) |
| `PUBLIC_BASE_URL` | The address the QR codes point to, for example `http://192.168.137.1:3000` for the laptop's own hotspot. Empty = the laptop's Wi-Fi address is detected |
| `WEATHER_API_KEY` | Optional. If empty, the stored weather data are used |
| `DB_PATH` | Optional. Database file (default `aedispatch.db`) |
| `SEED_DATE` | Optional. The "today" used by `npm run seed` |

`.env` is not in git, so it must be created again on another computer.

### Opening the phone screens

**Demo tools → Phones** shows a QR code for the resident app and one for each barangay's BHW screens. The phone must be able to reach the computer: the same Wi-Fi, or the computer's own hotspot with `PUBLIC_BASE_URL` set. The QR codes do not open the dashboard.

### Demo login

Dashboard: username `officer`, password `demo1234` (shared and public; use a password on the hotspot). The resident app and BHW screens open from the QR codes without this login. The resident sign-in PIN is shown on screen because SMS is simulated.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the system (restarts on code changes) |
| `npm run build` / `npm start` | Compiles, then runs the compiled system |
| `npm run seed` | Creates or resets the database with the sample data |
| `npm test` | Runs the automated tests |
| `npm run test:coverage` | Runs the tests with a coverage report |
| `npm run evaluate` | Runs the full evaluation (see below) |
| `npm run evaluate -- --quick` | A smaller run that takes about a minute |

## Trying the demo

1. On the dashboard's **Priority queue**, note the ranked barangays.
2. In **Demo tools → Weather**, apply a rainy preset. The ranking changes.
3. Scan the resident QR code on a phone, sign in with the on-screen PIN, and send a household report. Its score changes.
4. Open that barangay, review the score breakdown, and confirm the recommendation. A field task is created.
5. Scan that barangay's BHW QR code, open the task, fill in the survey and submit. The barangay is re-scored.
6. Under **Activity & dispatches**, open the finding and print it or save it as a PDF.
7. In **Demo tools → Weights**, move a weight to see how the ranking depends on it, and open **Results** for the evaluation.

## Evaluation

`npm run evaluate` runs on simulated outbreaks (seeded and reproducible) and reports, with 95% intervals:

- ranking quality (Precision@k, NDCG@k, for all cases and for new outbreaks) against three baselines: case count only, weather only, and random;
- robustness to missing, sparse, noisy and spam reports;
- sensitivity to how early the signals appear;
- what each of the five sources adds (leaving one out at a time), and the effect of the smoothing;
- tiers against field-team capacity, and fairness across barangays (dispatch Gini, reporting differences);
- the heap's update time against re-sorting the whole list as the number of barangays grows.

Results are written to `reports/` and shown read-only under Demo tools → Results. They show behaviour on simulated data under stated assumptions, not accuracy on real dengue cases; where AeDispatch ties or loses to a baseline, the report says so. One finding is kept as a limitation: with the starting weights, the hospital-case factor works against early warning in the simulation.

## Not included in this prototype

| Item | In the prototype |
| --- | --- |
| SMS delivery of the sign-in PIN | Simulated on screen |
| Real identity checks and geofencing | Not included; limits slow repeated use, they do not prove who is sending |
| Offline use of the BHW screens | Forms are saved on the phone and sent when a connection returns; installing the screens for offline use works on `localhost` or https, not on a plain http hotspot address |
| Calibration of weights on real historical data | Starting weights used (future work) |
| Live connection to hospital records | Weekly file import instead |
| The health office's real case-file format | Assumed columns: week, barangay, purok, cases |

## Data

All barangay data, reports, names and findings are made up for demonstration. No real resident or patient data are included.

## Tech

Node.js, TypeScript, Express, SQLite (better-sqlite3), Vitest. The screens are plain HTML, CSS and JavaScript, with no framework.
