import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';

const presets = [
  'Air Conditioning Pack Inoperative', 
  'Navigation Display Failed', 
  'ELT Missing', 
  'Anti-Ice Fault'
];

type AircraftOption = { name: string; norm: string };

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL ?? '';
const API_KEY: string = (import.meta as any).env?.VITE_API_KEY ?? '';

const FALLBACK_AIRCRAFT: AircraftOption[] = [
  { name: 'Boeing 737 MAX', norm: 'boeing 737 max' },
  { name: 'Airbus A320', norm: 'airbus a320' },
  { name: 'ATR 72', norm: 'atr 72' },
  { name: 'Embraer EMB-145', norm: 'embraer emb-145' },
];

function App() {
  const [aircraftOptions, setAircraftOptions] = useState<AircraftOption[]>(FALLBACK_AIRCRAFT);
  const [selectedAircraft, setSelectedAircraft] = useState<AircraftOption>(FALLBACK_AIRCRAFT[0]);
  const [aircraft, setAircraft] = useState(FALLBACK_AIRCRAFT[0].name);
  const [issue, setIssue] = useState('');
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState('');
  const [supportSpeech, setSupportSpeech] = useState(true);
  const [history, setHistory] = useState<Array<{aircraft: string, issue: string, items: any[]}>>([]);
  const [isRetrieved, setIsRetrieved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [foundItems, setFoundItems] = useState<any[]>([]);
  const recognitionRef = React.useRef<any>(null);

  // Load aircraft list from the backend
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/aircraft`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: AircraftOption[]) => {
        if (data.length > 0) {
          setAircraftOptions(data);
          setAircraft(data[0].name);
          setSelectedAircraft(data[0]);
        }
      })
      .catch(err => {
        console.warn('Failed to load aircraft from backend, using fallback:', err);
        setAircraft(FALLBACK_AIRCRAFT[0].name);
        setSelectedAircraft(FALLBACK_AIRCRAFT[0]);
      });
  }, []);

  const createPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let yPosition = 20;

    // Title
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('AI AIRCRAFT DISPATCH REPORT', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 20;

    // Section: FLIGHT DISPATCH INFORMATION
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('FLIGHT DISPATCH INFORMATION', 20, yPosition);
    yPosition += 10;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const currentDate = new Date().toLocaleString();
    doc.text(`Date/Time: ${currentDate}`, 20, yPosition);
    yPosition += 8;
    doc.text(`Aircraft: ${aircraft}`, 20, yPosition);
    yPosition += 8;
    doc.setFont('helvetica', 'bold');
    if (isRetrieved) {
      doc.setTextColor(0, 212, 170); // green
    } else if (issue !== '') {
      doc.setTextColor(255, 215, 0); // yellow
    } else {
      doc.setTextColor(255, 255, 255); // white
    }
    doc.text(`Reported MEL Issue: ${issue || 'N/A'}`, 20, yPosition);
    doc.setTextColor(0, 0, 0); // reset to black
    doc.setFont('helvetica', 'normal');
    yPosition += 15;

    // Section: DISPATCH DECISION
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DISPATCH DECISION', 20, yPosition);
    yPosition += 10;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('CHECK', 20, yPosition);
    yPosition += 8;

    doc.setFont('helvetica', 'normal');
    const decisionText = result === 'GO' ? 'Dispatch permitted' : 'Dispatch permitted with conditions';
    doc.text(decisionText, 20, yPosition);
    yPosition += 15;

    // Section: OPERATIONAL SUMMARY
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('OPERATIONAL SUMMARY', 20, yPosition);
    yPosition += 10;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const summaryText = `Dispatch may be allowed because the equipment count required for dispatch is zero, provided placarding and repair interval controls are in place. Installed units: 1. Required for dispatch: 0.`;
    const splitSummary = doc.splitTextToSize(summaryText, pageWidth - 40);
    doc.text(splitSummary, 20, yPosition);
    yPosition += splitSummary.length * 5 + 10;

    // Section: REQUIRED ACTIONS
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('REQUIRED ACTIONS', 20, yPosition);
    yPosition += 10;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const actions = requiredActionsForIssue(issue || presets[0]);
    actions.forEach(action => {
      const splitAction = doc.splitTextToSize(`• ${action}`, pageWidth - 40);
      doc.text(splitAction, 20, yPosition);
      yPosition += splitAction.length * 5;
    });
    yPosition += 10;

    // Section: OPERATIONAL LIMITATIONS
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('OPERATIONAL LIMITATIONS', 20, yPosition);
    yPosition += 10;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const limitations = [
      'Dispatch is only acceptable under the approved MEL item wording.',
      'Repair interval tracking must be active from time of release.'
    ];
    limitations.forEach(limitation => {
      const splitLim = doc.splitTextToSize(`• ${limitation}`, pageWidth - 40);
      doc.text(splitLim, 20, yPosition);
      yPosition += splitLim.length * 5;
    });
    yPosition += 10;

    // Section: MMEL TRACEABILITY
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('MMEL TRACEABILITY', 20, yPosition);
    yPosition += 10;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Record ID: ${aircraft.toLowerCase().replace(' ', '-')}-${(issue || 'N/A').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 10)}-001`, 20, yPosition);
    yPosition += 8;
    doc.text(`Equipment: ${issue || 'N/A'}`, 20, yPosition);

    doc.save('dispatch_report.pdf');
  };


  const requiredActionsForIssue = (issueText: string) => {
    const normalized = issueText.toLowerCase();
    if (normalized.includes('ac pack')) return ['Inspect AC packs', 'Reset circuit breaker', 'Log discrepancy in MEL'];
    if (normalized.includes('nav display')) return ['Perform NVIS self-test', 'Replace failed display', 'Validate flight plan'];
    if (normalized.includes('elt')) return ['Verify ELT is installed', 'Replace battery if expired', 'Record in technical log'];
    if (normalized.includes('anti-ice')) return ['Check pitot heat system', 'Inspect wing anti-ice ducts', 'Perform leak test'];
    if (!normalized) return ['Confirm issue detail', 'Run full systems check'];
    return ['Evaluate the fault code', 'Dispatch maintenance crew', 'Update report'];
  };

  const analyze = async () => {
    const queryText = issue.trim();
    if (!queryText) return;

    // Strip (M) and (O) markers from the search query for better RAG/Search matching
    const cleanedQuery = queryText.replace(/\s*\([mo]\)\s*/gi, ' ').trim();
    if (!cleanedQuery) return;

    setLoading(true);
    setApiError('');
    setResult('');
    setFoundItems([]);

    try {
      // Step 1: Fetch RAG hints using cleaned query
      const ragUrl = `${API_BASE_URL}/api/rag-hints?q=${encodeURIComponent(cleanedQuery)}&aircraft=${encodeURIComponent(selectedAircraft.norm)}`;
      const ragResponse = await fetch(ragUrl);
      if (!ragResponse.ok) throw new Error(`RAG Error ${ragResponse.status}`);
      const hints = await ragResponse.json();

      if (!hints || hints.length === 0) {
        setApiError("No relevant MMEL hints found.");
        setResult('NONE');
        // Save to history as a structured object
        setHistory(prev => [{
          aircraft: selectedAircraft.name, 
          issue: queryText, 
          items: []
        }, ...prev].slice(0, 2));
        return;
      }

      // Step 2: Fetch details from Cosmos for each unique sequence
      const seqToTitle = new Map<string, string>();
      hints.forEach((h: any) => {
        if (h.sequence && !seqToTitle.has(h.sequence)) {
          seqToTitle.set(h.sequence, h.title || '');
        }
      });

      const uniqueSequences = Array.from(seqToTitle.keys());
      const allFoundItems: any[] = [];

      for (const seq of uniqueSequences) {
        const hintTitle = seqToTitle.get(seq) || cleanedQuery;
        const searchUrl = `${API_BASE_URL}/api/search?aircraft=${encodeURIComponent(selectedAircraft.norm)}&q=${encodeURIComponent(hintTitle)}&sequence=${encodeURIComponent(String(seq))}`;
        const searchResponse = await fetch(searchUrl, {
          headers: {
            ...(API_KEY ? { 'x-functions-key': API_KEY } : {}),
          }
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (Array.isArray(searchData)) {
            allFoundItems.push(...searchData);
          }
        }
      }

      setFoundItems(allFoundItems);
      const status = allFoundItems.length > 0 ? 'CONDITIONAL' : 'NO ITEMS';
      setResult(status);
      // Save to history as a structured object
      setHistory(prev => [{
        aircraft: selectedAircraft.name, 
        issue: queryText, 
        items: allFoundItems
      }, ...prev].slice(0, 2));
      
      if (allFoundItems.length === 0) {
        setApiError("No matching items found in Cosmos DB.");
      }
    } catch (err: any) {
      console.error('Analysis failed:', err);
      setApiError(err.message || 'Unknown error');
      setResult('ERROR');
      // Save to history even on error
      setHistory(prev => [{
        aircraft: selectedAircraft.name, 
        issue: queryText, 
        items: []
      }, ...prev].slice(0, 2));
    } finally {
      setLoading(false);
    }
  };


  React.useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupportSpeech(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = (event.results[0][0].transcript || '').trim();
      if (!transcript) return;
      setIssue(transcript);
      setIsRetrieved(true);

      // Trigger analyze automatically if user says it explicitly
      if (transcript.toLowerCase().includes('analyze') || transcript.toLowerCase().includes('check')) {
        setTimeout(() => analyze(), 250);
      }
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.onerror = (error: any) => {
      console.warn('Voice recognition error:', error);
      setListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
    };
  }, []);

  const voice = () => {
    if (!supportSpeech) {
      alert('Voice commands are not supported in this browser');
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    setListening(true);
    setResult('');
    try {
      recognitionRef.current?.start();
    } catch (err) {
      console.warn('Could not start voice recognition', err);
      setListening(false);
    }
  };

  const cardStyle = {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    backdropFilter: 'blur(25px)',
    WebkitBackdropFilter: 'blur(25px)',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 25px rgba(255,255,255,0.1)',
    borderRadius: 25,
    padding: 16,
    color: '#edf6ff'
  } as React.CSSProperties;
  const buttonGradient = {backgroundImage: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#ffffff', boxShadow: '0 4px 8px rgba(0,0,0,0.3)'};


  return (
    <div className="app-container" style={{background: 'linear-gradient(135deg, #0a1425 0%, #1a2332 50%, #0f1419 100%)', minHeight: '100vh', color: 'white', fontFamily: 'Arial, sans-serif'}}>
      <style>
        {`
          html, body {
            margin: 0;
            padding: 0;
            background: #0a1425;
            overflow: hidden;
            height: 100%;
            width: 100%;
            -webkit-font-smoothing: antialiased;
          }
          * {
            box-sizing: border-box;
          }
          .app-container {
            padding: 0;
            width: 100vw;
            height: 100vh;
            margin: 0;
            background: #0a1425;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .main-content {
            padding: 15px 30px 30px;
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          .grid-container {
            display: grid;
            grid-template-columns: 1.4fr 1.4fr 1.6fr;
            gap: 20px;
            align-items: stretch;
            width: 100%;
            height: 100%;
            overflow: hidden;
            min-height: 0;
          }
          .dashboard-col {
            display: flex;
            flex-direction: column;
            gap: 20px;
            height: 100%;
            overflow: hidden;
            min-width: 0;
          }
          .scrollable-card {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            min-height: 0;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 15px;
          }
          .card-fixed {
            flex: 0 0 auto;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 15px;
          }
          .history-flex {
            flex: 0 0 200px !important;
          }
          .report-flex {
            flex: 1 !important;
          }
          @media (max-width: 1400px) {
            .grid-container {
              grid-template-columns: repeat(2, 1fr);
              overflow-y: auto;
            }
          }
          .history-item {
            padding: 10px; 
            background: rgba(255,255,255,0.03); 
            border-radius: 8px; 
            margin-bottom: 8px; 
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.05);
            transition: all 0.2s ease;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .history-item:hover {
            background: rgba(42, 245, 194, 0.05) !important;
            border-color: rgba(42, 245, 194, 0.2) !important;
          }
          .mmel-carousel {
            display: flex;
            flex-direction: row;
            overflow-x: auto;
            gap: 15px;
            padding: 5px 5px 15px 5px;
            scroll-snap-type: x mandatory;
            min-height: 200px;
          }
          .mmel-card {
            flex: 0 0 350px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 16px;
            scroll-snap-align: start;
            display: flex;
            flex-direction: column;
            gap: 12px;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
          }
          .mmel-card:hover {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(42, 245, 194, 0.3);
            transform: translateY(-2px);
          }
          .mmel-card-manual {
            width: 100%;
            max-height: 120px;
            object-fit: contain;
            border-radius: 4px;
            display: block;
            margin-top: 5px;
          }
          /* Custom scrollbar */
          ::-webkit-scrollbar {
            width: 6px;
          }
          ::-webkit-scrollbar-track {
            background: transparent;
          }
          ::-webkit-scrollbar-thumb {
            background: rgba(42, 245, 194, 0.2);
            border-radius: 10px;
          }
          ::-webkit-scrollbar-thumb:hover {
            background: rgba(42, 245, 194, 0.4);
          }
        `}
      </style>
      <div className="banner" style={{
        backgroundImage: `linear-gradient(rgba(15, 28, 45, 0.7), rgba(26, 35, 50, 0.7)), url('/ai_airport_banner.png')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        padding: '80px 20px',
        textAlign: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'radial-gradient(circle at 70% 30%, rgba(42, 245, 194, 0.1) 0%, transparent 50%)',
          pointerEvents: 'none'
        }} />
        <h1 style={{
          fontSize: 48, 
          fontWeight: '900', 
          backgroundImage: 'linear-gradient(90deg, #a770ef, #cf8bf3, #00f3ff)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textShadow: '0 10px 20px rgba(0,0,0,0.5)', 
          margin: 0, 
          letterSpacing: '3px'
        }}>MMEL AI DISPATCH ADVISOR</h1>
        <p style={{fontSize: 24, color: 'rgba(255, 255, 255, 0.9)', margin: '20px 0 0', fontWeight: '400', letterSpacing: '1px'}}>Autonomous Airport Operations & Precision Dispatch Guidance</p>
      </div>

      <div className="main-content">
        <div className="grid-container">
          {/* Column 1: Selection & Semaphore */}
          <div className="dashboard-col">
            <div className="scrollable-card" style={cardStyle as React.CSSProperties}>
              <p style={{fontSize: 14, color: '#87ceeb', marginBottom: 15}}>Select an Aircraft and enter or search a question to get instant guidance</p>
              
              <h3 style={{marginBottom: 8, fontSize: 16, color: '#fff'}}>Aircraft</h3>
              <select 
                value={aircraft}
                onChange={(e) => {
                  const name = e.target.value;
                  setAircraft(name);
                  const opt = aircraftOptions.find(o => o.name === name);
                  if (opt) setSelectedAircraft(opt);
                }}
                style={{width: '100%', padding: 12, background: 'rgba(255,255,255,0.9)', color: '#000', borderRadius: 10, border: 'none', fontWeight: 'bold', marginBottom: 20}}
              >
                {aircraftOptions.map((opt) => (
                  <option key={opt.norm} value={opt.name}>{opt.name}</option>
                ))}
              </select>

              <h3 style={{marginBottom: 8, fontSize: 16, color: '#fff'}}>Issue 🎙️</h3>
              <textarea 
                value={issue}
                onChange={(e) => {
                  setIssue(e.target.value);
                  setIsRetrieved(false);
                }}
                placeholder='Enter your MEL issue here...'
                style={{width: '100%', height: 100, padding: 12, background: 'rgba(255,255,255,0.1)', color: isRetrieved ? '#00d4aa' : '#fff', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', marginBottom: 15}}
              />

              <div style={{display: 'flex', gap: 10, marginBottom: 10}}>
                <button onClick={voice} style={{flex: 1, padding: 12, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #07108a, #037d79)', color: '#fff', fontWeight: 'bold', cursor: 'pointer'}}>{listening ? '🔴 LISTENING' : 'Voice Control'}</button>
                <button onClick={analyze} disabled={loading} style={{flex: 1, padding: 12, borderRadius: 10, border: 'none', background: loading ? '#333' : 'linear-gradient(135deg, #07108a, #7d0360)', color: '#fff', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer'}}>{loading ? '⏳ ANALYZING...' : 'Analyze Dispatch'}</button>
              </div>
              <button 
                onClick={() => { setIssue(''); setIsRetrieved(false); setResult(''); setFoundItems([]); setApiError(''); }}
                style={{width: '100%', padding: 10, borderRadius: 10, border: 'none', background: 'linear-gradient(to right, #1e3c72, #2a5298)', color: '#fff', fontWeight: 'bold', cursor: 'pointer'}}
              >
                Reset / Clear Issue Text
              </button>
              {apiError && <div style={{marginTop: 10, color: '#ff6b6b', fontSize: 12, background: 'rgba(255,107,107,0.1)', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,107,107,0.2)'}}>⚠️ {apiError}</div>}
            </div>

            <div style={cardStyle as React.CSSProperties}>
              <h3 style={{marginBottom: 15, fontSize: 16, color: '#fff'}}>Auto OPS Semaphore</h3>
              <div style={{display: 'flex', flexDirection: 'column', gap: 15}}>
                {(() => {
                  const hasM = foundItems.some(i => /^\s*\(M\)/m.test(i.remarks || ''));
                  const hasO = foundItems.some(i => /^\s*\(O\)/m.test(i.remarks || ''));
                  return (
                    <>
                      <div style={{display: 'flex', alignItems: 'center', gap: 15, opacity: hasM ? 1 : 0.3}}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#00d4aa', boxShadow: hasM ? '0 0 20px #00d4aa' : 'none', border: '1px solid #fff'}} />
                        <span style={{fontSize: 14, fontWeight: 'bold'}}>RAMP / MAINTENANCE (M)</span>
                      </div>
                      <div style={{display: 'flex', alignItems: 'center', gap: 15, opacity: hasO ? 1 : 0.3}}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#ffd700', boxShadow: hasO ? '0 0 20px #ffd700' : 'none', border: '1px solid #fff'}} />
                        <span style={{fontSize: 14, fontWeight: 'bold'}}>TURNAROUND / OPERATIONS (O)</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Column 2: Check & Decision */}
          <div className="dashboard-col">
            <div className="scrollable-card" style={cardStyle as React.CSSProperties}>
              <h3 style={{marginBottom: 15, fontSize: 16, color: '#fff'}}>Dispatch Report</h3>
              
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
                background: 'rgba(0,0,0,0.2)', borderRadius: 15, padding: '15px 12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 20
              }}>
                <div style={{
                  display: 'flex', flexDirection: 'row', gap: 8, padding: '6px 10px', background: '#050505', borderRadius: 20, border: '1px solid #222'
                }}>
                  {/* RED LIGHT */}
                  <div style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: result === 'NONE' ? '#ff4b4b' : '#1a0000',
                    boxShadow: result === 'NONE' ? '0 0 12px #ff4b4b' : 'none',
                    border: `1px solid ${result === 'NONE' ? 'rgba(255,255,255,0.4)' : 'transparent'}`,
                    transition: 'all 0.4s ease'
                  }} />
                  {/* YELLOW LIGHT */}
                  <div style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: result === 'CONDITIONAL' ? '#ffd700' : '#1a1a00',
                    boxShadow: result === 'CONDITIONAL' ? '0 0 12px #ffd700' : 'none',
                    border: `1px solid ${result === 'CONDITIONAL' ? 'rgba(255,255,255,0.4)' : 'transparent'}`,
                    transition: 'all 0.4s ease'
                  }} />
                  {/* GREEN LIGHT */}
                  <div style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: !result || result === 'READY' ? '#00d4aa' : '#001a00',
                    boxShadow: !result || result === 'READY' ? '0 0 12px #00d4aa' : 'none',
                    border: `1px solid ${!result || result === 'READY' ? 'rgba(255,255,255,0.4)' : 'transparent'}`,
                    transition: 'all 0.4s ease'
                  }} />
                </div>
                <div style={{fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: '1px', textShadow: '0 0 8px rgba(255,255,255,0.2)'}}>
                  {result || 'READY'}
                </div>
              </div>
              <button 
                disabled={foundItems.length === 0} 
                onClick={createPDF}
                style={{width: '100%', padding: 12, borderRadius: 10, fontWeight: 'bold', ...buttonGradient, marginBottom: 10, cursor: foundItems.length === 0 ? 'not-allowed' : 'pointer', opacity: foundItems.length === 0 ? 0.5 : 1}}
              >
                Generate PDF Report
              </button>
              <p style={{fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 20}}>
                {foundItems.length === 0 ? 'No items retrieved yet. Enter an issue and click analyze.' : `${foundItems.length} items found.`}
              </p>
            </div>
          </div>

          {/* Column 4: History & Report */}
          <div className="dashboard-col">
            <div className="scrollable-card history-flex">
              <h3 style={{marginBottom: 15, fontSize: 16, color: '#fff'}}>History</h3>
              {history.length === 0 ? (
                <p style={{color: '#555', fontStyle: 'italic', textAlign: 'center', marginTop: 40}}>No events recorded</p>
              ) : (
                history.slice(0, 2).map((h, i) => (
                  <div 
                    key={i} 
                    onClick={() => {
                      setAircraft(h.aircraft);
                      setIssue(h.issue);
                      setFoundItems(h.items);
                      setIsRetrieved(true);
                      setResult(h.items.length > 0 ? 'CONDITIONAL' : 'NONE');
                    }}
                    className="history-item"
                  >
                    <div style={{fontWeight: 'bold', color: '#2af5c2', fontSize: 13}}>{h.aircraft}</div>
                    <div style={{opacity: 0.7, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{h.issue}</div>
                  </div>
                ))
              )}
            </div>

            <div className="scrollable-card report-flex">
              <h3 style={{marginBottom: 15, fontSize: 16, color: '#fff'}}>MMEL Items</h3>
              
              <div className="mmel-carousel">
                {foundItems.length === 0 ? (
                  <p style={{color: '#555', fontStyle: 'italic', padding: 20}}>No items found.</p>
                ) : (
                  foundItems.map((item, idx) => (
                    <div key={idx} className="mmel-card">
                      <div style={{flex: '0 0 auto'}}>
                        <div style={{fontWeight: '900', color: '#2af5c2', marginBottom: 5, fontSize: 14}}>{item.sequence}</div>
                        <div style={{fontSize: 13, color: '#fff', marginBottom: 8, fontWeight: 'bold'}}>{item.item}</div>
                        <div style={{fontSize: 11, color: '#aaa', marginBottom: 10}}>CAT {item.repairCategory} | INST {item.installed} | REQ {item.required}</div>
                        <div style={{fontSize: 12, color: '#e0e6ed', lineHeight: 1.4, opacity: 0.9}}>
                          {item.remarks}
                        </div>
                      </div>
                      
                      {item.imageUrls && item.imageUrls.length > 0 && (
                        <div style={{marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12}}>
                          <div style={{fontSize: 10, color: '#666', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1}}>Manual Reference</div>
                          <img 
                            src={item.imageUrls[0]} 
                            alt={`Manual page for ${item.sequence}`}
                            className="mmel-card-manual"
                            onError={(e) => (e.currentTarget.style.display = 'none')}
                          />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
