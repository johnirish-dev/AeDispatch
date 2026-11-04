// src/sim/generator.ts
export function createSeededRandom(seed: number) {
  let s = seed;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSyntheticData(weeks: number, seed: number = 12345) {
  const random = createSeededRandom(seed);
  
  // 8 Daraga Barangays (Sample Data)
  const barangays = [
    { id: 'B1', name: 'Peñafrancia', municipality: 'Daraga', pop: 4120, area: 1.8, puroks: 6 },
    { id: 'B2', name: 'Tagas', municipality: 'Daraga', pop: 8200, area: 2.1, puroks: 7 },
    { id: 'B3', name: 'Bascaran', municipality: 'Daraga', pop: 5100, area: 2.5, puroks: 5 },
    { id: 'B4', name: 'Busay', municipality: 'Daraga', pop: 3400, area: 1.5, puroks: 4 },
    { id: 'B5', name: 'Sagpon', municipality: 'Daraga', pop: 6700, area: 1.9, puroks: 6 },
    { id: 'B6', name: 'Mabini', municipality: 'Daraga', pop: 2900, area: 1.2, puroks: 4 },
    { id: 'B7', name: 'Kilicao', municipality: 'Daraga', pop: 4800, area: 2.2, puroks: 5 },
    { id: 'B8', name: 'Bañag', municipality: 'Daraga', pop: 5300, area: 1.7, puroks: 6 },
  ];

  const weather = [];
  const cases = [];
  const symptoms = [];
  
  const now = new Date();
  
  for (let w = 0; w < weeks; w++) {
    const weekStart = new Date(now.getTime() - (weeks - w) * 7 * 24 * 60 * 60 * 1000);
    const isoWeek = `2026-W${45 - (weeks - w)}`; 

    // Weekly weather
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart.getTime() + d * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      weather.push({
        date,
        municipality: 'Daraga',
        mean_temp_c: 26 + random() * 6, // 26 to 32 C
        rainfall_mm: random() > 0.6 ? random() * 20 : 0, // Rain on ~40% of days
        source: 'simulated'
      });
    }

    // Weekly cases and symptoms per barangay
    for (const b of barangays) {
      symptoms.push({
        barangay_id: b.id,
        date: weekStart.toISOString().split('T')[0],
        checks: Math.floor(random() * 20),
        checks_with_warning_signs: Math.floor(random() * 3)
      });

      for (let p = 1; p <= b.puroks; p++) {
        // Force Tier 2 unlock condition for Bascaran Purok 4 in the most recent weeks
        let confirmed = Math.floor(random() * 2); 
        if (b.name === 'Bascaran' && p === 4 && w >= weeks - 2) {
          confirmed = 3; // > 2 cases to unlock Tier 2
        }
        
        cases.push({
          barangay_id: b.id,
          purok_id: `${b.id}_P${p}`,
          iso_week: isoWeek,
          week_start: weekStart.toISOString().split('T')[0],
          confirmed_cases: confirmed
        });
      }
    }
  }

  return { barangays, weather, cases, symptoms };
}