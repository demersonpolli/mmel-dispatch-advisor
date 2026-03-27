import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

// Browser-friendly replacements for native support path
const triggerHaptic = () => {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(18);
  }
};

type Severity = 'go' | 'conditional' | 'no-go';

type TraceabilityItem = {
  id: string;
  label: string;
  detail: string;
};

type DispatchResponse = {
  query: {
    aircraft: string;
    issue: string;
  };
  decision: {
    severity: Severity;
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
  manualPage?: {
    mimeType: 'image/jpeg';
    base64: string;
  };
  manualPageUrl?: string;
};

// Azure backend response shape
type AdvisorItem = {
  id: string;
  aircraft: string;
  sequence: string;
  systemTitle: string;
  item: string;
  repairCategory: string;
  installed: string;
  required: string;
  remarks: string;
  imageUrls: string[];
  fromCrossReference: boolean;
};

type AdvisorImage = {
  url: string;
  blobPath: string;
  page: string;
  itemId: string;
  sequence: string;
};

type AdvisorResponse = {
  report: string;
  items: AdvisorItem[];
  images: AdvisorImage[];
  retrievalNotes: string;
};

type DispatchChecklistItem = {
  type: 'maintenance' | 'operational' | 'repair' | 'availability';
  critical: boolean;
  label: string;
  detail: string;
};

function buildDispatchChecklist(items: AdvisorItem[]): DispatchChecklistItem[] {
  const repairLabel: Record<string, string> = {
    A: 'Class A — Repair per remarks',
    B: 'Class B — Repair within 3 consecutive days',
    C: 'Class C — Repair within 10 consecutive days',
    D: 'Class D — Repair within 120 consecutive days',
  };
  const checklist: DispatchChecklistItem[] = [];

  for (const item of items.filter(i => !i.fromCrossReference)) {
    const hasM = /\(M\)/.test(item.remarks);
    const hasO = /\(O\)/.test(item.remarks);

    if (hasM) {
      checklist.push({
        type: 'maintenance',
        critical: true,
        label: `Maintenance action required (M) — ${item.sequence}`,
        detail: item.item,
      });
    }
    if (hasO) {
      checklist.push({
        type: 'operational',
        critical: false,
        label: `Operational procedure required (O) — ${item.sequence}`,
        detail: item.item,
      });
    }
    if (item.repairCategory) {
      checklist.push({
        type: 'repair',
        critical: item.repairCategory === 'A',
        label: repairLabel[item.repairCategory] ?? `Class ${item.repairCategory} — Check remarks`,
        detail: `${item.sequence} — ${item.item}`,
      });
    }
    if (item.installed && item.required) {
      checklist.push({
        type: 'availability',
        critical: false,
        label: `Equipment requirement — ${item.sequence}`,
        detail: `Requires ${item.required} operative · ${item.installed} installed`,
      });
    }
  }
  return checklist;
}

function toDispatchResponse(raw: AdvisorResponse, aircraft: string, issue: string): DispatchResponse {
  const primary = raw.items.find(i => !i.fromCrossReference) ?? raw.items[0];
  const primaryItems = raw.items.filter(i => !i.fromCrossReference);
  const hasM = primaryItems.some(i => /\(M\)/.test(i.remarks));
  const hasO = primaryItems.some(i => /\(O\)/.test(i.remarks));
  const severity: Severity =
    raw.items.length === 0 ? 'no-go' : 'conditional';

  return {
    query: { aircraft, issue },
    decision: {
      severity,
      title: severity === 'no-go' ? 'No items found — review manually'
           : hasM && hasO ? 'Dispatch permitted — maintenance + operational procedures required'
           : hasM ? 'Dispatch permitted — maintenance action required'
           : hasO ? 'Dispatch permitted — operational procedure required'
           : 'Dispatch permitted with conditions',
    },
    summary: raw.report.split('\n\n')[0].replace(/^#+\s*/, '').trim(),
    actions: raw.items.slice(0, 5).map(i => `[${i.repairCategory}] ${i.item} — ${i.sequence}`),
    limitations: raw.items
      .filter(i => i.repairCategory === 'B' && i.remarks)
      .map(i => i.remarks)
      .slice(0, 3),
    traceability: [
      { id: '01', label: 'Query sent', detail: `${aircraft}: "${issue}"` },
      { id: '02', label: 'Items matched', detail: `${raw.items.length} MMEL item(s) retrieved` },
      { id: '03', label: 'RAG notes', detail: raw.retrievalNotes || 'n/a' },
    ],
    matchedRecord: {
      recordId: primary?.id ?? 'none',
      aircraft: primary?.aircraft ?? aircraft,
      equipmentName: primary?.item ?? issue,
    },
    manualPageUrl: raw.images[0]?.url,
  };
}

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL ?? 'https://mmel-dispatch-advisor.azurewebsites.net';
const API_KEY: string = (import.meta as any).env?.VITE_API_KEY ?? '';

// Aircraft option loaded from /api/aircraft
type AircraftOption = { name: string; norm: string };

// RAG hint returned by /api/rag-hints
type RagHint = { sequence: string; system: string; title: string };

const QUICK_INPUTS = [
  'Boeing 737 MAX with one air conditioning pack inoperative',
  'ATR72 with ELT missing, placard installed',
  'A320 with one navigation display inoperative',
  'EMB-145 with anti-skid fault during turnaround',
];

const FALLBACK_RESPONSE: DispatchResponse = {
  query: {
    aircraft: 'Boeing 737 MAX',
    issue: 'Boeing 737 MAX with one air conditioning pack inoperative',
  },
  decision: {
    severity: 'conditional',
    title: 'Dispatch permitted with conditions',
  },
  summary:
    'The aircraft may be dispatched under MEL conditions if the remaining pack is operational and procedural controls are observed. Connect the API to replace this fallback with live backend guidance.',
  actions: [
    'Verify the remaining pack is operational.',
    'Confirm placarding and maintenance logging are complete.',
    'Notify the crew of any operating limitations before release.',
  ],
  limitations: [
    'This fallback appears when the API is not reachable.',
  ],
  traceability: [
    {
      id: '01',
      label: 'Local fallback used',
      detail: 'The app is showing a local response because the API request failed.',
    },
  ],
  matchedRecord: {
    recordId: 'fallback',
    aircraft: 'Boeing 737 MAX',
    equipmentName: 'Air Conditioning Pack',
  },
};

function statusMeta(severity: Severity) {
  switch (severity) {
    case 'go':
      return { label: 'Dispatch OK', tone: styles.statusGo, badge: 'GO' };
    case 'conditional':
      return { label: 'Conditional Dispatch', tone: styles.statusConditional, badge: 'CHECK' };
    case 'no-go':
      return { label: 'No Dispatch', tone: styles.statusNoGo, badge: 'NO-GO' };
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '')          // remove image syntax
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')       // links → label only
    .replace(/^#{1,4}\s+/gm, '')              // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')          // bold
    .replace(/\*(.+?)\*/g, '$1')              // italic
    .replace(/`(.+?)`/g, '$1')               // inline code
    .replace(/\n{3,}/g, '\n\n')              // collapse excess blank lines
    .trim();
}

let SpeechRecognition: any = null;

if (typeof window !== 'undefined') {
  const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (SpeechRecognitionAPI) {
    SpeechRecognition = new SpeechRecognitionAPI();
    SpeechRecognition.continuous = false;
    SpeechRecognition.interimResults = false;
    SpeechRecognition.lang = 'en-US';
  }
}

export default function App() {
  const [selectedAircraft, setSelectedAircraft] = useState('');
  const [selectedAircraftNorm, setSelectedAircraftNorm] = useState('');
  const [aircraftOptions, setAircraftOptions] = useState<AircraftOption[]>([]);
  const [issueText, setIssueText] = useState('');
  const [ragHints, setRagHints] = useState<RagHint[]>([]);
  const [advisorRawItems, setAdvisorRawItems] = useState<AdvisorItem[]>([]);
  const [advisorReport, setAdvisorReport] = useState<string>('');
  const [result, setResult] = useState<DispatchResponse>(FALLBACK_RESPONSE);
  const [loading, setLoading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);

  // Load aircraft list from Cosmos DB via backend
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/aircraft`)
      .then(r => r.json())
      .then((data: AircraftOption[]) => {
        setAircraftOptions(data);
        if (data.length > 0) {
          setSelectedAircraft(data[0].name);
          setSelectedAircraftNorm(data[0].norm);
        }
      })
      .catch(err => console.warn('Failed to load aircraft list', err));
  }, []);

  // Server-side RAG hints as user types (debounced 400 ms)
  useEffect(() => {
    if (!issueText || issueText.length < 3) {
      setRagHints([]);
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: issueText });
      if (selectedAircraftNorm) params.set('aircraft', selectedAircraftNorm);
      fetch(`${API_BASE_URL}/api/rag-hints?${params}`)
        .then(r => r.json())
        .then((data: RagHint[]) => setRagHints(data))
        .catch(() => setRagHints([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [issueText, selectedAircraftNorm]);

  useEffect(() => {
    recognitionRef.current = SpeechRecognition;
    loadHistory();
  }, []);

  const loadHistory = () => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('dispatchHistory');
        if (saved) {
          setHistory(JSON.parse(saved));
        }
      }
    } catch (e) {
      console.warn('History load failed', e);
    }
  };

  const saveHistory = useCallback((issue: string) => {
    try {
      const newHistory = [issue, ...history.slice(0, 4)].filter((h, i, self) => self.indexOf(h) === i);
      setHistory(newHistory);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('dispatchHistory', JSON.stringify(newHistory));
      }
    } catch (e) {
      console.warn('History save failed', e);
    }
  }, [history]);

  async function handleAnalyze(nextIssue?: string) {
    const issue = nextIssue ?? issueText;
    if (!issue.trim()) return setErrorMsg('Please enter or speak an issue.');
    
    setLoading(true);
    setErrorMsg('');

    if (nextIssue) saveHistory(nextIssue);

    try {
      const response = await fetch(`${API_BASE_URL}/api/advise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'x-functions-key': API_KEY } : {}),
        },
        body: JSON.stringify({ query: `${selectedAircraftNorm || selectedAircraft} ${issue}` }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const raw = await response.json() as AdvisorResponse;
      setAdvisorRawItems(raw.items);
      setAdvisorReport(raw.report ?? '');
      setResult(toDispatchResponse(raw, selectedAircraft, issue));
    } catch (error) {
      console.warn('API failed, using fallback:', error);
      setResult({
        ...FALLBACK_RESPONSE,
        query: {
          aircraft: selectedAircraft,
          issue,
        },
      });
      setErrorMsg('Could not reach the backend. Showing fallback response.');
    } finally {
      setLoading(false);
    }
  }

  const toggleVoice = () => {
    if (!recognitionRef.current) {
      Alert.alert('Voice Not Supported', 'Speech recognition not available on this platform. Use text input.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      triggerHaptic();
      return;
    }

    try {
      recognitionRef.current.onstart = () => {
        setIsListening(true);
        setErrorMsg('');
        triggerHaptic();
      };

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setIssueText(transcript);
        handleAnalyze(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        setErrorMsg(`Voice error: ${event.error}`);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.start();
    } catch (e) {
      setErrorMsg('Mic permission denied. Enable in browser settings.');
      setIsListening(false);
    }
  };

  const handleReset = () => {
    setIssueText('');
    setResult(FALLBACK_RESPONSE);
    setAdvisorRawItems([]);
    setAdvisorReport('');
    setErrorMsg('');
    setManualOpen(false);
    triggerHaptic();
  };

  const clearError = () => setErrorMsg('');

  const manualUri = result.manualPageUrl
    ?? (result.manualPage?.base64
      ? `data:${result.manualPage.mimeType};base64,${result.manualPage.base64}`
      : undefined);

  const meta = useMemo(() => statusMeta(result.decision.severity), [result.decision.severity]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={styles.flex1}
      >
        <View style={styles.root}>
          <View style={styles.sidebar}>
            <Text style={styles.brandEyebrow}>AI DISPATCH ADVISOR</Text>
            <Text style={styles.brandTitle}>Minimum Equipment List Compliance</Text>

            <View style={styles.sidebarCard}>
              <Text style={styles.cardLabel}>Ops Mode</Text>
              <Text style={styles.sidebarValue}>Ramp / Turnaround</Text>
              <Text style={styles.sidebarHint}>Tablet-first flow for mechanics and dispatchers.</Text>
            </View>

            <View style={styles.sidebarCard}>
              <Text style={styles.cardLabel}>Recent History</Text>
              {history.map((h, i) => (
                <Pressable key={i} onPress={() => {
                  setIssueText(h);
                  handleAnalyze(h);
                }} style={styles.historyItem}>
                  <Text style={styles.historyText} numberOfLines={1}>{h}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.mainScroll} keyboardShouldPersistTaps="handled">
            {errorMsg ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{errorMsg}</Text>
                <Pressable onPress={clearError} style={styles.errorClose}>
                  <Text style={styles.errorCloseText}>×</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.heroRow}>
              <View style={styles.heroTextBlock}>
                <Text style={styles.heroTitle}>Fast, traceable dispatch decisions during turnaround</Text>
                <Text style={styles.heroSubtitle}>
                  Enter a defect in free text or <Text style={styles.highlight}>speak</Text> the issue. App returns dispatch summary, procedures, limitations, manual evidence.
                </Text>
              </View>

              <View style={[styles.statusCard, meta.tone]}>
                <Text style={styles.statusBadge}>{meta.badge}</Text>
                <Text style={styles.statusTitle}>{meta.label}</Text>
                <Text style={styles.statusAircraft}>{result.matchedRecord.aircraft}</Text>
              </View>
            </View>

            <View style={styles.grid}>
              <View style={styles.leftColumn}>
                <View style={styles.panel}>
                  <Text style={styles.panelTitle}>Issue input</Text>
                  <Text style={styles.panelSubtext}>Optimized for ramp speed.</Text>

                  <Text style={styles.fieldLabel}>Aircraft</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                    {aircraftOptions.map((item) => {
                      const selected = item.name === selectedAircraft;
                      return (
                        <Pressable
                          key={item.norm}
                          onPress={() => {
                            setSelectedAircraft(item.name);
                            setSelectedAircraftNorm(item.norm);
                            setRagHints([]);
                          }}
                          style={[styles.chip, selected && styles.chipSelected]}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{item.name}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.fieldLabel}>Failure condition</Text>
                  <TextInput
                    multiline
                    value={issueText}
                    onChangeText={setIssueText}
                    placeholder="e.g. Boeing 737 MAX air conditioning pack inoperative"
                    placeholderTextColor="#6C748E"
                    style={styles.input}
                    textAlignVertical="top"
                  />

                  {ragHints.length > 0 && (
                    <View style={styles.ragHints}>
                      <Text style={styles.ragHintsLabel}>Related MMEL items</Text>
                      {ragHints.map((h, i) => (
                        <Pressable
                          key={`${h.sequence}-${i}`}
                          onPress={() => { setIssueText(h.title); setRagHints([]); }}
                          style={styles.ragHintRow}
                        >
                          <Text style={styles.ragHintSeq}>{h.sequence}</Text>
                          <Text style={styles.ragHintTitle} numberOfLines={1}>{h.title}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <View style={styles.actionRow}>
                    <Pressable style={styles.primaryButton} onPress={() => handleAnalyze()} disabled={loading}>
                      <Text style={styles.primaryButtonText}>{loading ? 'Analyzing...' : 'Analyze Dispatch'}</Text>
                    </Pressable>
                    <Pressable style={[styles.secondaryButton, isListening && styles.buttonListening]} onPress={toggleVoice} disabled={loading}>
                      <Text style={[styles.secondaryButtonText, isListening && styles.listeningText]}>
                        {isListening ? 'Stop' : '🎤 Voice'}
                      </Text>
                    </Pressable>
                  </View>

                  <Pressable style={styles.resetButton} onPress={handleReset}>
                    <Text style={styles.resetButtonText}>Reset</Text>
                  </Pressable>

                  <Text style={styles.fieldLabel}>Quick scenarios</Text>
                  <View style={styles.quickList}>
                    {QUICK_INPUTS.map((preset) => (
                      <Pressable
                        key={preset}
                        style={styles.quickCard}
                        onPress={() => handleAnalyze(preset)}
                      >
                        <Text style={styles.quickCardText}>{preset}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.panel}>
                  <View style={styles.panelHeaderInline}>
                    <Text style={styles.panelTitle}>MMEL Manual Page</Text>
                    <Pressable onPress={() => setManualOpen(true)}>
                      <Text style={styles.linkText}>View Full</Text>
                    </Pressable>
                  </View>

                  <View style={styles.manualCard}>
                    <Text style={styles.manualPlaceholderTitle}>Manual page preview</Text>
                    {manualUri ? (
                      <Image source={{ uri: manualUri }} style={styles.manualImage} resizeMode="contain" />
                    ) : (
                      <View style={styles.manualFallback}>
                        <Text style={styles.manualFallbackText}>Tap "View Full" for MMEL page.</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              <View style={styles.rightColumn}>
                <View style={styles.panel}>
                  <Text style={styles.panelTitle}>Dispatch Report</Text>
                  {loading ? <ActivityIndicator size="large" color="#DCE7FF" style={{ marginVertical: 20 }} /> : null}
                  <Text style={styles.reportTitle}>{result.decision.title}</Text>
                  <Text style={styles.reportSummary}>{result.summary}</Text>

                  {advisorRawItems.length > 0 ? (
                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitle}>Dispatch Checklist</Text>
                      {buildDispatchChecklist(advisorRawItems).map((ci, i) => (
                        <View
                          key={i}
                          style={[
                            styles.checklistRow,
                            ci.type === 'maintenance' && styles.checklistMaintenance,
                            ci.type === 'operational' && styles.checklistOperational,
                            ci.type === 'repair' && styles.checklistRepair,
                            ci.type === 'availability' && styles.checklistAvailability,
                          ]}
                        >
                          <Text style={styles.checklistIcon}>
                            {ci.type === 'maintenance' ? '⚠️'
                              : ci.type === 'operational' ? '📋'
                              : ci.type === 'repair' ? '🔧'
                              : '✈️'}
                          </Text>
                          <View style={styles.checklistContent}>
                            <Text style={[styles.checklistLabel, ci.critical && styles.checklistLabelCritical]}>
                              {ci.label}
                            </Text>
                            {ci.detail ? (
                              <Text style={styles.checklistDetail}>{ci.detail}</Text>
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <>
                      <View style={styles.sectionBlock}>
                        <Text style={styles.sectionTitle}>Actions Required</Text>
                        {result.actions.map((action, i) => (
                          <View key={i} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={styles.bulletText}>{action}</Text>
                          </View>
                        ))}
                      </View>
                      <View style={styles.sectionBlock}>
                        <Text style={styles.sectionTitle}>Limitations</Text>
                        {result.limitations.map((item, i) => (
                          <View key={i} style={styles.bulletRow}>
                            <View style={styles.bulletDotMuted} />
                            <Text style={styles.bulletText}>{item}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}

                  {advisorReport ? (
                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitle}>Foundry Analysis</Text>
                      <View style={styles.reportBlock}>
                        {stripMarkdown(advisorReport).split('\n\n').map((para, i) => (
                          <Text key={i} style={styles.reportParagraph}>{para.trim()}</Text>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>

                <View style={styles.panel}>
                  <Text style={styles.panelTitle}>Traceability</Text>
                  {result.traceability.map((item) => (
                    <View key={item.id} style={styles.timelineRow}>
                      <View style={styles.timelineMarker}>
                        <Text style={styles.timelineMarkerText}>{item.id}</Text>
                      </View>
                      <View style={styles.timelineContent}>
                        <Text style={styles.timelineTitle}>{item.label}</Text>
                        <Text style={styles.timelineText}>{item.detail}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={manualOpen} transparent animationType="fade" onRequestClose={() => setManualOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.panelHeaderInline}>
              <Text style={styles.panelTitle}>MMEL Manual Page</Text>
              <Pressable onPress={() => setManualOpen(false)}>
                <Text style={styles.linkText}>Close</Text>
              </Pressable>
            </View>
            {manualUri ? (
              <Image source={{ uri: manualUri }} style={styles.modalImage} resizeMode="contain" />
            ) : (
              <View style={styles.manualFallback}>
                <Text style={styles.manualFallbackText}>No manual page matched this issue.</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  safeArea: { flex: 1, backgroundColor: '#07111F' },
  root: { flex: 1, flexDirection: 'row', backgroundColor: '#07111F' },
  sidebar: {
    width: 300,
    padding: 20,
    borderRightWidth: 1,
    borderRightColor: 'rgba(143, 169, 255, 0.12)',
    backgroundColor: '#0A1528',
  },
  brandEyebrow: {
    color: '#8BA3FF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  brandTitle: {
    color: '#F4F7FF',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    marginBottom: 22,
  },
  sidebarCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
  },
  cardLabel: {
    color: '#92A2C4',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sidebarValue: {
    color: '#F4F7FF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  sidebarHint: {
    color: '#AEB9D1',
    fontSize: 13,
    lineHeight: 19,
  },
  workflowItem: {
    color: '#DFE7FB',
    fontSize: 14,
    marginBottom: 8,
  },
  historyItem: {
    paddingVertical: 6,
  },
  historyText: {
    color: '#CDE1FF',
    fontSize: 13,
    lineHeight: 18,
  },
  mainScroll: {
    padding: 20,
    paddingBottom: 40,
  },
  errorBanner: {
    backgroundColor: 'rgba(255,82,82,0.9)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    color: '#FFFBFA',
    fontSize: 14,
    flex: 1,
  },
  errorClose: {
    padding: 4,
  },
  errorCloseText: {
    color: '#FFFBFA',
    fontSize: 20,
    fontWeight: 'bold',
  },
  highlight: {
    color: '#DCE7FF',
    fontWeight: '700',
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
  },
  heroTextBlock: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 22,
  },
  heroTitle: {
    color: '#F8FAFF',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    marginBottom: 10,
    maxWidth: 760,
  },
  heroSubtitle: {
    color: '#B8C5E0',
    fontSize: 15,
    lineHeight: 24,
    maxWidth: 760,
  },
  statusCard: {
    width: 240,
    borderRadius: 28,
    padding: 22,
    justifyContent: 'space-between',
    minHeight: 156,
    borderWidth: 1,
  },
  statusGo: {
    backgroundColor: 'rgba(29, 185, 84, 0.14)',
    borderColor: 'rgba(29, 185, 84, 0.25)',
  },
  statusConditional: {
    backgroundColor: 'rgba(255, 184, 0, 0.14)',
    borderColor: 'rgba(255, 184, 0, 0.26)',
  },
  statusNoGo: {
    backgroundColor: 'rgba(255, 82, 82, 0.14)',
    borderColor: 'rgba(255, 82, 82, 0.24)',
  },
  statusBadge: {
    color: '#F4F7FF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  statusTitle: {
    color: '#F4F7FF',
    fontSize: 24,
    fontWeight: '800',
  },
  statusAircraft: {
    color: '#D8E2FB',
    fontSize: 14,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    gap: 18,
  },
  leftColumn: {
    flex: 1.15,
  },
  rightColumn: {
    flex: 0.95,
  },
  panel: {
    backgroundColor: '#0D1A31',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
    marginBottom: 18,
  },
  panelTitle: {
    color: '#F7F9FF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  panelSubtext: {
    color: '#9EAFCC',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  fieldLabel: {
    color: '#D8E2FB',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 8,
  },
  chipsRow: {
    marginBottom: 14,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: '#13233F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 10,
  },
  chipSelected: {
    backgroundColor: '#D9E5FF',
  },
  chipText: {
    color: '#DBE5FD',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#0B1630',
  },
  input: {
    minHeight: 140,
    borderRadius: 22,
    backgroundColor: '#07111F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#F5F8FF',
    fontSize: 16,
    lineHeight: 24,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    marginBottom: 10,
  },
  primaryButton: {
    backgroundColor: '#DCE7FF',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flex: 1,
  },
  primaryButtonText: {
    color: '#09142A',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(220,231,255,0.2)',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flex: 1,
  },
  buttonListening: {
    backgroundColor: 'rgba(29,185,84,0.2)',
    borderColor: 'rgba(29,185,84,0.4)',
  },
  secondaryButtonText: {
    color: '#DCE7FF',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  listeningText: {
    color: '#29A65C',
  },
  resetButton: {
    backgroundColor: 'rgba(255,82,82,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,82,82,0.3)',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  resetButtonText: {
    color: '#FFB3B3',
    fontSize: 15,
    fontWeight: '700',
  },
  quickList: { marginTop: 6 },
  quickCard: {
    backgroundColor: '#13233F',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 10,
  },
  quickCardText: {
    color: '#E3EBFF',
    fontSize: 14,
    lineHeight: 20,
  },
  panelHeaderInline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkText: {
    color: '#95AEFF',
    fontSize: 14,
    fontWeight: '700',
  },
  manualCard: {
    backgroundColor: '#09111F',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 16,
  },
  manualPlaceholderTitle: {
    color: '#F5F8FF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  manualImage: {
    width: '100%',
    height: 260,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  manualFallback: {
    minHeight: 220,
    borderRadius: 20,
    backgroundColor: '#FCFCFE',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  manualFallbackText: {
    color: '#1B2333',
    fontSize: 16,
    textAlign: 'center',
  },
  reportTitle: {
    color: '#F9FBFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 10,
    marginTop: 10,
  },
  reportSummary: {
    color: '#D0DBF2',
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 16,
  },
  sectionBlock: {
    marginTop: 18,
  },
  sectionTitle: {
    color: '#F4F8FF',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    paddingRight: 8,
  },
  bulletDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: '#A8C5FF',
    marginTop: 7,
    marginRight: 10,
  },
  bulletDotMuted: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: '#5F6F92',
    marginTop: 7,
    marginRight: 10,
  },
  bulletText: {
    flex: 1,
    color: '#D6E0F7',
    fontSize: 14,
    lineHeight: 22,
  },
  timelineRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  timelineMarker: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#13233F',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  timelineMarkerText: {
    color: '#EAF1FF',
    fontWeight: '800',
    fontSize: 12,
  },
  timelineContent: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 14,
  },
  timelineTitle: {
    color: '#F5F8FF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  timelineText: {
    color: '#AEBADB',
    fontSize: 14,
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 16, 0.72)',
    justifyContent: 'center',
    padding: 30,
  },
  modalCard: {
    alignSelf: 'center',
    width: '86%',
    maxWidth: 980,
    borderRadius: 30,
    backgroundColor: '#0D1A31',
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalImage: {
    width: '100%',
    height: 520,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
  },
  reportBlock: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  reportParagraph: {
    color: '#C8D8F0',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 10,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    borderRadius: 12,
    padding: 10,
    paddingLeft: 12,
  },
  checklistMaintenance: {
    backgroundColor: 'rgba(255,82,82,0.12)',
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,82,82,0.6)',
  },
  checklistOperational: {
    backgroundColor: 'rgba(255,184,0,0.10)',
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,184,0,0.55)',
  },
  checklistRepair: {
    backgroundColor: 'rgba(139,163,255,0.08)',
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(139,163,255,0.35)',
  },
  checklistAvailability: {
    backgroundColor: 'rgba(41,166,92,0.08)',
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(41,166,92,0.35)',
  },
  checklistIcon: {
    fontSize: 15,
    marginRight: 10,
    marginTop: 1,
  },
  checklistContent: {
    flex: 1,
  },
  checklistLabel: {
    color: '#E3EBFF',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  checklistLabelCritical: {
    color: '#FFB3B3',
    fontWeight: '700',
  },
  checklistDetail: {
    color: '#8BA3C4',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  ragHints: {
    backgroundColor: 'rgba(139,163,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(139,163,255,0.2)',
    borderRadius: 16,
    padding: 10,
    marginBottom: 10,
  },
  ragHintsLabel: {
    color: '#8BA3FF',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  ragHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  ragHintSeq: {
    color: '#95AEFF',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 64,
    fontVariant: ['tabular-nums'],
  },
  ragHintTitle: {
    color: '#D0DCFF',
    fontSize: 13,
    flex: 1,
  },
});

