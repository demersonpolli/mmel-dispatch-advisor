import { mmelRecords } from '../data/mmel-records';
import { MMELRecord } from '../types/dispatch';

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function searchMmelRecords(issue: string, aircraft?: string): MMELRecord[] {
  const normalizedIssue = normalize(issue);
  const normalizedAircraft = aircraft ? normalize(aircraft) : '';

  return [...mmelRecords]
    .map((record) => {
      let score = 0;
      const recordAircraftTerms = [record.aircraft, ...record.aircraftAliases].map(normalize);

      if (normalizedAircraft && recordAircraftTerms.some((term) => term.includes(normalizedAircraft) || normalizedAircraft.includes(term))) {
        score += 7;
      }

      if (!normalizedAircraft && recordAircraftTerms.some((term) => normalizedIssue.includes(term))) {
        score += 5;
      }

      if (normalizedIssue.includes(normalize(record.equipmentName))) {
        score += 6;
      }

      for (const keyword of record.keywords) {
        if (normalizedIssue.includes(normalize(keyword))) {
          score += 3;
        }
      }

      return { record, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.record);
}