import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';

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
  const [foundryReport, setFoundryReport] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
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
    try {
    console.log('createPDF start, foundItems=', foundItems.length, 'reportLen=', foundryReport.length);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;
    let y = 0;
    let pageNum = 1;

    const repairDeadline = (cat: string) => {
      switch ((cat || '').toUpperCase()) {
        case 'A': return 'Cat A - Repair per remarks';
        case 'B': return 'Cat B - Repair within 3 consecutive days';
        case 'C': return 'Cat C - Repair within 10 consecutive days';
        case 'D': return 'Cat D - Repair within 120 consecutive days';
        default:  return cat ? `Cat ${cat}` : 'Unknown';
      }
    };

    const addFooter = () => {
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(160, 160, 160);
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
      doc.text('MMEL Dispatch Advisor - FOR INTERNAL USE ONLY', margin, pageHeight - 9);
      doc.text(new Date().toLocaleString(), pageWidth / 2, pageHeight - 9, { align: 'center' });
      doc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 9, { align: 'right' });
      doc.setTextColor(0, 0, 0);
      doc.setDrawColor(0, 0, 0);
    };

    const checkBreak = (needed: number) => {
      if (y + needed > pageHeight - 20) {
        addFooter();
        doc.addPage();
        pageNum++;
        y = 18;
      }
    };

    const sectionHeader = (num: string, title: string) => {
      checkBreak(14);
      doc.setFillColor(12, 28, 72);
      doc.rect(margin, y, contentWidth, 10, 'F');
      doc.setFillColor(42, 100, 210);
      doc.rect(margin, y, 6, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`${num}  ${title}`, margin + 10, y + 6.8);
      doc.setTextColor(0, 0, 0);
      y += 14;
    };

    // ── Dispatch status derived from report text ─────────────────
    const reportLower = foundryReport.toLowerCase();
    const dispatchStatus = reportLower.includes('no-go') || reportLower.includes('no go')
      ? 'NO-GO' : reportLower.includes('conditional') ? 'CONDITIONAL' : 'GO';
    const statusColor: [number, number, number] =
      dispatchStatus === 'NO-GO' ? [190, 30, 30] :
      dispatchStatus === 'CONDITIONAL' ? [180, 110, 0] : [0, 140, 90];

    // ── PAGE HEADER ──────────────────────────────────────────────
    doc.setFillColor(12, 28, 72);
    doc.rect(0, 0, pageWidth, 38, 'F');
    doc.setFillColor(42, 100, 210);
    doc.rect(0, 0, 7, 38, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('DISPATCH ADVISORY REPORT', pageWidth / 2, 16, { align: 'center' });
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 200, 255);
    doc.text('MEL Compliance Assessment - Confidential', pageWidth / 2, 24, { align: 'center' });

    // Status badge
    doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.roundedRect(pageWidth - margin - 38, 10, 38, 14, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(dispatchStatus, pageWidth - margin - 19, 19.5, { align: 'center' });

    // Info bar
    doc.setFillColor(235, 240, 255);
    doc.rect(0, 38, pageWidth, 18, 'F');
    doc.setTextColor(20, 35, 80);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(`Aircraft:`, margin + 7, 46);
    doc.setFont('helvetica', 'normal');
    doc.text(selectedAircraft.name, margin + 24, 46);
    doc.setFont('helvetica', 'bold');
    doc.text(`Issue:`, margin + 7, 52);
    doc.setFont('helvetica', 'normal');
    const issueShort = doc.splitTextToSize(issue, contentWidth - 60);
    doc.text(issueShort[0] || '', margin + 20, 52);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 110, 140);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - margin, 52, { align: 'right' });

    doc.setTextColor(0, 0, 0);
    y = 64;

    // ══════════════════════════════════════════════════════════════
    // SECTION 1 — MMEL ITEMS FOUND
    // ══════════════════════════════════════════════════════════════
    sectionHeader('1', 'MMEL ITEMS FOUND');

    if (foundItems.length === 0) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(130, 130, 130);
      doc.text('No MMEL items retrieved.', margin + 4, y);
      doc.setTextColor(0, 0, 0);
      y += 10;
    }

    foundItems.forEach((item: any, idx: number) => {
      checkBreak(28);
      const bgColor: [number, number, number] = idx % 2 === 0 ? [248, 251, 255] : [255, 255, 255];
      doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
      doc.setDrawColor(210, 220, 240);
      doc.roundedRect(margin, y, contentWidth, 24, 2, 2, 'FD');

      // Sequence badge
      doc.setFillColor(42, 100, 210);
      doc.roundedRect(margin + 3, y + 3, 34, 7, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text(item.sequence || '', margin + 20, y + 7.8, { align: 'center' });

      // Item name
      doc.setTextColor(15, 28, 70);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const nameLines = doc.splitTextToSize(item.item || '', contentWidth - 90);
      doc.text(nameLines[0] || '', margin + 41, y + 8);

      // System + repair info
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(90, 105, 145);
      doc.text(item.systemTitle || '', margin + 41, y + 14);
      doc.text(
        `${repairDeadline(item.repairCategory)}   |   Installed: ${item.installed}   Required: ${item.required}`,
        margin + 41, y + 20
      );

      // (M) / (O) flags — right side
      const hasM = /\(M\)/.test(item.remarks || '');
      const hasO = /\(O\)/.test(item.remarks || '');
      let fx = pageWidth - margin - 3;
      if (hasO) {
        doc.setFillColor(180, 100, 0);
        doc.roundedRect(fx - 11, y + 4, 11, 6, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.text('(O)', fx - 5.5, y + 8.3, { align: 'center' });
        fx -= 14;
      }
      if (hasM) {
        doc.setFillColor(170, 20, 20);
        doc.roundedRect(fx - 11, y + 4, 11, 6, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.text('(M)', fx - 5.5, y + 8.3, { align: 'center' });
      }

      doc.setTextColor(0, 0, 0);
      y += 27;
    });

    y += 4;

    // ══════════════════════════════════════════════════════════════
    // SECTION 2 — OPERATOR RECOMMENDATION
    // ══════════════════════════════════════════════════════════════
    sectionHeader('2', 'OPERATOR RECOMMENDATION (FOUNDRY AI ANALYSIS)');

    const cleanReport = foundryReport
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[(.+?)\]\(.*?\)/g, '$1')
      .replace(/^#{1,4}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/^\s*[-\u2013\u2022]\s*/gm, '- ')
      .trim();

    const reportParagraphs = cleanReport.split(/\n{2,}/).filter(p => p.trim());

    reportParagraphs.forEach(para => {
      const lines = para.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        const isBullet = line.trimStart().startsWith('- ');
        const isHeading = /^[A-Z\s]{6,}$/.test(line.trim());
        const indentX = isBullet ? margin + 6 : margin + 2;
        const wrapWidth = isBullet ? contentWidth - 8 : contentWidth - 4;

        doc.setFontSize(isHeading ? 9 : 8.5);
        doc.setFont('helvetica', isHeading ? 'bold' : 'normal');
        doc.setTextColor(isHeading ? 12 : 35, isHeading ? 28 : 45, isHeading ? 72 : 80);

        const wrapped = doc.splitTextToSize(line.trim(), wrapWidth);
        checkBreak(wrapped.length * 5 + 2);

        if (isBullet) {
          doc.setFillColor(42, 100, 210);
          doc.rect(margin + 1.5, y + 1, 2, 2, 'F');
        }
        doc.text(wrapped, indentX, y + 4);
        y += wrapped.length * 5 + 2;
      });
      y += 2;
    });

    y += 4;

    // ══════════════════════════════════════════════════════════════
    // SECTION 3 — DISPATCH CHECKLIST
    // ══════════════════════════════════════════════════════════════
    sectionHeader('3', 'DISPATCH CHECKLIST');

    // Status banner
    checkBreak(12);
    const bannerBg: [number,number,number] = dispatchStatus === 'NO-GO' ? [255, 220, 220] : dispatchStatus === 'CONDITIONAL' ? [255, 245, 210] : [215, 255, 235];
    doc.setFillColor(bannerBg[0], bannerBg[1], bannerBg[2]);
    doc.setDrawColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, y, contentWidth, 10, 2, 2, 'FD');
    doc.setLineWidth(0.2);
    doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.roundedRect(margin, y, 4, 10, 1, 1, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
    const statusLabel = dispatchStatus === 'NO-GO'
      ? 'NO-GO: Aircraft cannot be dispatched. Address all items below before flight.'
      : dispatchStatus === 'CONDITIONAL'
      ? 'CONDITIONAL: Dispatch permitted - all conditions below must be met.'
      : 'GO: Aircraft may be dispatched. Retain documentation per MEL.';
    doc.text(statusLabel, margin + 7, y + 6.8);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    y += 14;

    // Checklist rows
    foundItems.forEach((item: any) => {
      const hasM = /\(M\)/.test(item.remarks || '');
      const hasO = /\(O\)/.test(item.remarks || '');
      const cat = (item.repairCategory || '').toUpperCase();

      // Main item row
      checkBreak(10);
      doc.setDrawColor(80, 110, 180);
      doc.setLineWidth(0.4);
      doc.rect(margin + 3, y + 0.5, 5, 5);
      doc.setLineWidth(0.2);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 28, 70);
      const mainLabel = `[${item.sequence}]  ${item.item}`;
      const mainWrapped = doc.splitTextToSize(mainLabel, contentWidth - 14);
      checkBreak(mainWrapped.length * 5 + 2);
      doc.text(mainWrapped, margin + 11, y + 4.5);
      y += mainWrapped.length * 5 + 1;

      // Repair deadline sub-row
      checkBreak(7);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(70, 85, 130);
      doc.text(`     ${repairDeadline(cat)}   |   Installed: ${item.installed}   Required: ${item.required}`,
        margin + 11, y + 3.5);
      y += 6;

      // (M) row
      if (hasM) {
        checkBreak(7);
        doc.setFillColor(255, 235, 235);
        doc.rect(margin + 11, y - 0.5, contentWidth - 13, 6.5, 'F');
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(160, 20, 20);
        doc.text('(M)  Maintenance action required - verify remarks and perform per approved procedure', margin + 13, y + 4);
        doc.setTextColor(0, 0, 0);
        y += 7.5;
      }

      // (O) row
      if (hasO) {
        checkBreak(7);
        doc.setFillColor(255, 245, 220);
        doc.rect(margin + 11, y - 0.5, contentWidth - 13, 6.5, 'F');
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(150, 90, 0);
        doc.text('(O)  Operational procedure required - crew must apply procedure per remarks before flight', margin + 13, y + 4);
        doc.setTextColor(0, 0, 0);
        y += 7.5;
      }

      // Separator
      checkBreak(5);
      doc.setDrawColor(220, 228, 245);
      doc.line(margin + 10, y + 1, pageWidth - margin, y + 1);
      doc.setDrawColor(0, 0, 0);
      y += 4;
    });

    // Signature block
    checkBreak(30);
    y += 6;
    doc.setDrawColor(180, 190, 220);
    doc.setFillColor(248, 250, 255);
    doc.roundedRect(margin, y, contentWidth, 26, 2, 2, 'FD');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 55, 100);
    doc.text('DISPATCHER SIGNATURE', margin + 6, y + 8);
    doc.text('DATE', margin + contentWidth / 2 + 6, y + 8);
    doc.setDrawColor(120, 140, 190);
    doc.line(margin + 6, y + 20, margin + contentWidth / 2 - 6, y + 20);
    doc.line(margin + contentWidth / 2 + 6, y + 20, pageWidth - margin - 6, y + 20);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    y += 30;

    addFooter();

    console.log('createPDF: calling output blob');
    const aircraftSlug = selectedAircraft.name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Dispatch_Report_${aircraftSlug}_${dateStr}.pdf`;
    const blob = doc.output('blob');
    console.log('createPDF: blob size=', blob.size);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    } catch (err: any) {
      console.error('PDF generation failed:', err);
      alert('Could not generate PDF: ' + (err?.message ?? String(err)));
    }
  };


  const analyze = async () => {
    const queryText = issue.trim();
    if (!queryText) return;

    setLoading(true);
    setApiError('');
    setResult('');
    setFoundItems([]);
    setFoundryReport('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/advise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'x-functions-key': API_KEY } : {}),
        },
        body: JSON.stringify({ query: `${selectedAircraft.norm} ${queryText}` }),
      });

      if (!response.ok) throw new Error(`Advise Error ${response.status}`);

      const data = await response.json();
      const items: any[] = data.items ?? [];

      setFoundItems(items);
      setFoundryReport(data.report ?? '');
      setResult(items.length > 0 ? 'CONDITIONAL' : 'NONE');

      setHistory(prev => [{
        aircraft: selectedAircraft.name,
        issue: queryText,
        items,
      }, ...prev].slice(0, 2));

      if (items.length === 0) {
        setApiError('No matching MMEL items found.');
      }
    } catch (err: any) {
      console.error('Analysis failed:', err);
      setApiError(err.message || 'Unknown error');
      setResult('ERROR');
      setHistory(prev => [{
        aircraft: selectedAircraft.name,
        issue: queryText,
        items: [],
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
            border-radius: 25px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 16px;
          }
          .card-fixed {
            flex: 0 0 auto;
            border-radius: 25px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 16px;
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
            flex: 0 0 calc(50% - 8px);
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
            cursor: pointer;
          }
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(10px);
            z-index: 9999;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
          }
          .modal-content {
            background: #000;
            width: 95%;
            max-width: 1000px;
            height: 95vh;
            border-radius: 15px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          }
          .modal-scroll-area {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            justify-content: center;
          }
          .modal-close {
            position: absolute;
            top: 25px;
            right: 25px;
            padding: 8px 16px;
            background: rgba(0, 0, 0, 0.6);
            border: 2px solid #2af5c2;
            border-radius: 30px;
            color: #2af5c2;
            cursor: pointer;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            font-size: 13px;
            font-weight: 900;
            letter-spacing: 1px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            text-transform: uppercase;
          }
          .modal-close:hover {
            background: rgba(255, 255, 255, 0.25);
          }
          .modal-image {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 0 auto;
            image-rendering: high-quality;
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
            <div className="scrollable-card" style={{ ...cardStyle, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'hidden' } as React.CSSProperties}>
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
              <div style={{
                flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 15, padding: 15, fontSize: 13, lineHeight: 1.6,
                color: foundryReport ? '#d0e8ff' : '#999',
                whiteSpace: 'pre-wrap',
              }}>
                {loading
                  ? 'Analyzing with Foundry AI...'
                  : foundryReport
                    ? foundryReport
                        .replace(/!\[.*?\]\(.*?\)/g, '')
                        .replace(/\[(.+?)\]\(.*?\)/g, '$1')
                        .replace(/^#{1,4}\s+/gm, '')
                        .replace(/\*\*(.+?)\*\*/g, '$1')
                        .replace(/\*(.+?)\*/g, '$1')
                        .replace(/`(.+?)`/g, '$1')
                        .trim()
                    : 'Foundry analysis results and detailed dispatch guidance will appear here...'}
              </div>
            </div>
          </div>

          {/* Column 4: History & Report */}
          <div className="dashboard-col">
            <div className="scrollable-card history-flex" style={cardStyle as React.CSSProperties}>
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

            <div className="scrollable-card report-flex" style={cardStyle as React.CSSProperties}>
              <h3 style={{marginBottom: 15, fontSize: 16, color: '#fff'}}>MMEL Items</h3>
              
              <div className="mmel-carousel">
                {foundItems.length === 0 ? (
                  <p style={{color: '#555', fontStyle: 'italic', padding: 20}}>No items found.</p>
                ) : (
                  foundItems.map((item, idx) => (
                    <div 
                      key={idx} 
                      className="mmel-card"
                      onClick={() => item.imageUrls?.length > 0 && setSelectedImage(item.imageUrls[0])}
                      style={{cursor: item.imageUrls?.length > 0 ? 'pointer' : 'default'}}
                    >
                      <div style={{flex: '0 0 auto'}}>
                        <div style={{fontWeight: '900', color: '#2af5c2', marginBottom: 5, fontSize: 14}}>{item.sequence}</div>
                        <div style={{fontSize: 13, color: '#fff', marginBottom: 8, fontWeight: 'bold'}}>{item.item}</div>
                        <div style={{fontSize: 11, color: '#aaa'}}>CAT {item.repairCategory} | INST {item.installed} | REQ {item.required}</div>
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

      {/* Manual Page Modal */}
      {selectedImage && (
        <div className="modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedImage(null)}>Close</button>
            <div className="modal-scroll-area">
              <img 
                src={selectedImage} 
                alt="Full Manual Page" 
                className="modal-image"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
