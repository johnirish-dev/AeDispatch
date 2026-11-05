// Sample Daraga barangays and health workers used by the seed. Only the first
// row (Peñafrancia) comes from the decision-screen wireframe; the rest are
// made-up values for the demo. None of this is real data.

export interface SampleBarangay {
  name: string;
  population: number;
  areaKm2: number;
  puroks: number;
  /** Week index (0-7) when cases jump, or null for no outbreak. */
  onsetWeek: number | null;
  /** 0-based purok that carries most outbreak cases. */
  hotPurok?: number;
}

export const SAMPLE_MUNICIPALITY = "Daraga";

export const SAMPLE_BARANGAYS: SampleBarangay[] = [
  { name: "Peñafrancia", population: 4120, areaKm2: 1.8, puroks: 6, onsetWeek: 6, hotPurok: 1 },
  { name: "Tagas", population: 3560, areaKm2: 3.4, puroks: 5, onsetWeek: 7 },
  { name: "Bascaran", population: 2900, areaKm2: 2.1, puroks: 7, onsetWeek: 7, hotPurok: 3 },
  { name: "Busay", population: 2310, areaKm2: 2.9, puroks: 4, onsetWeek: null },
  { name: "Sagpon", population: 6850, areaKm2: 4.2, puroks: 7, onsetWeek: 5 },
  { name: "Mabini", population: 1980, areaKm2: 1.4, puroks: 4, onsetWeek: null },
  { name: "Kilicao", population: 2740, areaKm2: 3.1, puroks: 5, onsetWeek: null },
  { name: "Bañag", population: 1650, areaKm2: 5.6, puroks: 3, onsetWeek: null },
];

export const SAMPLE_BHWS = [
  { displayName: "Jun M. Santos", barangay: "Peñafrancia", team: "Team B" },
  { displayName: "Maria L. Reyes", barangay: "Bascaran", team: "Team A" },
  { displayName: "Ramon D. Cruz", barangay: "Busay", team: "Team C" },
  { displayName: "Liza P. Ortega", barangay: "Sagpon", team: "Team A" },
  { displayName: "Elena S. Garcia", barangay: "Tagas", team: "Team B" },
  { displayName: "Rico T. Mendoza", barangay: "Mabini", team: "Team C" },
  { displayName: "Nora B. Villanueva", barangay: "Kilicao", team: "Team D" },
  { displayName: "Ben A. Torres", barangay: "Bañag", team: "Team D" },
];
