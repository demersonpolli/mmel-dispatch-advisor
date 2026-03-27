export type DispatchSeverity = 'go' | 'conditional' | 'no-go';

export type ManualPagePayload = {
  mimeType: 'image/jpeg';
  base64: string;
};

export type MMELRecord = {
  recordId: string;
  aircraft: string;
  aircraftAliases: string[];
  equipmentName: string;
  keywords: string[];
  installed: number;
  requiredForDispatch: number;
  placardRequired: boolean;
  repairInterval: string;
  conditions: string[];
  limitations: string[];
  summaryTemplate: string;
  manualPage: ManualPagePayload;
};

export type AnalyzeDispatchRequest = {
  aircraft?: string;
  issue: string;
  includeManualPage?: boolean;
};

export type TraceabilityItem = {
  id: string;
  label: string;
  detail: string;
};

export type DispatchResponse = {
  query: {
    aircraft: string;
    issue: string;
  };
  decision: {
    severity: DispatchSeverity;
    title: string;
  };
  summary: string;
  actions: string[];
  limitations: string[];
  traceability: TraceabilityItem[];
  matchedRecord: {
    recordId: string;
    aircraft: string;
    equipmentName: string;
  };
  manualPage?: ManualPagePayload;
};