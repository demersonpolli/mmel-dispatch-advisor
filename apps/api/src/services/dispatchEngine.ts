import {
  AnalyzeDispatchRequest,
  DispatchResponse,
  DispatchSeverity,
  MMELRecord,
  TraceabilityItem
} from '../types/dispatch';
import { searchMmelRecords } from './sampleSearch';

function detectAircraftFromIssue(issue: string): string {
  const knownAircraft = [
    'Boeing 737 MAX',
    'ATR72',
    'Airbus A320',
    'Embraer EMB-145'
  ];

  const lower = issue.toLowerCase();
  const match = knownAircraft.find((item) => lower.includes(item.toLowerCase()) || lower.includes(item.toLowerCase().replace(/\s+/g, '')));
  return match ?? 'Unspecified aircraft';
}

function computeSeverity(record: MMELRecord): DispatchSeverity {
  if (record.requiredForDispatch === 0 || record.requiredForDispatch < record.installed) {
    return 'conditional';
  }
  return 'no-go';
}

function computeTitle(severity: DispatchSeverity): string {
  if (severity === 'conditional') return 'Dispatch permitted with conditions';
  if (severity === 'go') return 'Dispatch permitted';
  return 'Dispatch not recommended until reviewed';
}

function buildActions(record: MMELRecord): string[] {
  const actions: string[] = [
    `Confirm aircraft logbook reflects the item "${record.equipmentName}".`
  ];

  if (record.placardRequired) {
    actions.push('Verify the required placard is installed and visible to the crew.');
  }

  actions.push(`Track the repair interval: ${record.repairInterval}`);

  for (const condition of record.conditions) {
    actions.push(condition);
  }

  return actions;
}

function buildTraceability(record: MMELRecord, aircraft: string, issue: string): TraceabilityItem[] {
  return [
    {
      id: '01',
      label: 'Input captured',
      detail: `Issue received for ${aircraft}: "${issue}".`
    },
    {
      id: '02',
      label: 'MMEL item located',
      detail: `Matched record ${record.recordId} for ${record.equipmentName}.`
    },
    {
      id: '03',
      label: 'Operational criteria extracted',
      detail: `Installed=${record.installed}, required=${record.requiredForDispatch}, placard=${record.placardRequired ? 'yes' : 'no'}.`
    },
    {
      id: '04',
      label: 'Response assembled',
      detail: 'Summary, actions, limitations, and manual page payload prepared for the tablet UI.'
    }
  ];
}

export function analyzeDispatch(input: AnalyzeDispatchRequest): DispatchResponse {
  const aircraft = input.aircraft?.trim() || detectAircraftFromIssue(input.issue);
  const candidates = searchMmelRecords(input.issue, aircraft);

  const record = candidates[0];
  if (!record) {
    return {
      query: { aircraft, issue: input.issue },
      decision: {
        severity: 'no-go',
        title: 'No matching MMEL item found'
      },
      summary:
        'The local MVP search did not find a matching MMEL item. In production, this is the point where Azure AI Search and the full MMEL corpus would be queried.',
      actions: [
        'Review the issue wording and aircraft selection.',
        'Search the full MMEL corpus in Azure AI Search.',
        'Escalate to maintenance control if no approved MEL relief exists.'
      ],
      limitations: [
        'A dispatch recommendation cannot be produced without a matching MMEL record.'
      ],
      traceability: [
        {
          id: '01',
          label: 'Input captured',
          detail: `Issue received for ${aircraft}: "${input.issue}".`
        },
        {
          id: '02',
          label: 'No record matched',
          detail: 'Search candidates returned zero results in the local sample dataset.'
        }
      ],
      matchedRecord: {
        recordId: 'unmatched',
        aircraft,
        equipmentName: 'Unknown'
      }
    };
  }

  const severity = computeSeverity(record);
  const summary = `${record.summaryTemplate} Installed units: ${record.installed}. Required for dispatch: ${record.requiredForDispatch}.`;

  return {
    query: { aircraft, issue: input.issue },
    decision: {
      severity,
      title: computeTitle(severity)
    },
    summary,
    actions: buildActions(record),
    limitations: record.limitations,
    traceability: buildTraceability(record, aircraft, input.issue),
    matchedRecord: {
      recordId: record.recordId,
      aircraft: record.aircraft,
      equipmentName: record.equipmentName
    },
    manualPage: input.includeManualPage === false ? undefined : record.manualPage
  };
}