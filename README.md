# AeDispatch

An early-warning decision-support and dispatch system for municipal dengue vector control. AeDispatch gives every barangay a threat score built from five kinds of data, ranks the barangays from highest to lowest threat, and recommends where the health office should send its limited field teams first. A health officer confirms or rejects every recommendation; nothing is dispatched automatically.

Course project for CS117 Software Engineering 1, BS Computer Science, Bicol University.
Team MuskiThree: Clint John Bonagua, Rhea Nicole Lumbes, John Irish Milallos.

## What the prototype shows

One working loop:

1. Data come in: weather, weekly confirmed cases, resident reports and BHW (barangay health worker) findings.
2. The affected barangay's threat score is recalculated and the ranking updates at once (Max Heap).
3. The health officer reviews the top-ranked barangays and confirms or rejects each recommendation.
4. A confirmed recommendation becomes a field task for a BHW.
5. The BHW's inspection findings go back into the barangay's score.

### Parts

| Part | Who uses it | How to open it |
| --- | --- | --- |
| Municipal dashboard | Health officer | Browser on a computer |
| Resident screens | Residents | Phone, by QR code from the dashboard |
| BHW field screens | Barangay health workers | Phone, by QR code from the dashboard |
| Demo tools | Development team | Dashboard, "Demo tools" section |

### How the score is built

Five factors, each from 0 to 1, with starting weights:

| Factor | Starting weight |
| --- | --- |
| Weather (temperature, rainfall) | 20% |
| Household and community reports | 15% |
| Anonymous symptom checks | 10% |
| BHW field findings | 25% |
| Confirmed cases | 30% |

The weighted sum is adjusted for population density and shown on a 0–100 scale. Recommended action: Tier 1 (Search and Destroy / larviciding) from a score of 40; Tier 2 (fogging review) only when a purok has more than two confirmed cases.

## Requirements

- Node.js 20 or later
- Git

No separate database server is needed; the data are kept in an SQLite file.

## Installation

```bash
git clone https://github.com/johnirish-dev/AeDispatch.git
cd AeDispatch
npm install
cp .env.example .env
npm run seed
npm run dev
```

Then open http://localhost:3000.

`npm run seed` creates the database with 8 barangays, 8 weeks of history, and sample reports and findings. Run it again at any time to reset the demo data.

### Settings (`.env`)

| Setting | Meaning |
| --- | --- |
| `PORT` | Port to run on (default 3000) |
| `WEATHER_API_KEY` | Optional. If empty, the stored weather data are used |

### Opening the phone screens

The dashboard's Demo tools page shows two QR codes, one for the resident screens and one for the BHW screens. The phone must be on the same Wi-Fi network as the computer running the system.

### Demo login

Dashboard: username `officer`, password `demo1234`. The resident and BHW screens open from the QR codes without a login. The resident sign-in PIN is shown on screen.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the system |
| `npm run seed` | Creates or resets the database with the sample data |
| `npm test` | Runs the automated tests |
| `npm run evaluate` | Prints the evaluation report (see below) |

## Trying the demo

1. On the dashboard's **Priority overview**, note the ranked barangays.
2. In **Demo tools**, change the weather (for example, choose "heavy-rain week"). The ranking changes.
3. Scan the resident QR code on a phone, sign in with the on-screen PIN, and submit a household report for a barangay. Its score changes.
4. Open that barangay from the list, review the score breakdown, and confirm the recommendation. A field task is created.
5. Scan the BHW QR code, open the task, fill in the survey form and submit. The barangay is re-scored.
6. Under **Activity and dispatches**, open the submitted finding and print it or save it as a PDF.

## Evaluation

`npm run evaluate` compares AeDispatch's ranking with three simple rankings (by case count only, by weather only, and random) using Precision@k, NDCG@k and the dispatch Gini coefficient. It also compares the heap's update time with re-sorting the whole list as the number of barangays grows. The same report is on the dashboard under Demo tools.

## Not included in this prototype

| Item | In the prototype |
| --- | --- |
| SMS delivery of the sign-in PIN | Simulated on screen |
| Geofencing and other abuse controls | Not included |
| Offline syncing of BHW forms | Simulated |
| Calibration of weights on real historical data | Starting weights used |
| Live connection to hospital records | Weekly file import instead |
| The health office's real case-file format | Assumed columns: week, barangay, purok, cases |

## Data

All barangay data, reports, names and findings are made up for demonstration. No real resident or patient data are included.

## Tech

Node.js, TypeScript, Express, SQLite.
