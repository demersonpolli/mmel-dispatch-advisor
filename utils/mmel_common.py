"""
mmel_common.py
Common parsing utilities for FAA MMEL PDF files.

Provides page-level text extraction, metadata extraction,
and row-level column detection shared by all format-specific parsers.
"""

import re
import datetime
import base64
import io
import pdfplumber


# ─── Metadata extraction ─────────────────────────────────────────────────────

def extract_metadata(pdf):
    """Extract aircraft model, revision number, and revision date from PDF."""
    aircraft = None
    revision = None
    revision_date = None

    for page in pdf.pages:
        text = page.extract_text() or ""
        if "TABLE KEY" not in text:
            continue

        lines = text.splitlines()
        for i, line in enumerate(lines):
            line = line.strip()

            if aircraft is None:
                m = re.search(r'AIRCRAFT:\s*(.*)', line, re.IGNORECASE)
                if m:
                    val = m.group(1).strip()
                    if not val:
                        for j in range(i + 1, len(lines)):
                            candidate = lines[j].strip()
                            if candidate and not re.match(
                                r'(REVISION|DATE:|PAGE|TABLE|1\.|2\.|3\.|4\.)',
                                candidate, re.IGNORECASE
                            ):
                                aircraft = candidate
                                break
                    else:
                        for hdr in ["1. REPAIR", "2. NO.", "REVISION", "PAGE NO.", "DATE:"]:
                            idx = val.upper().find(hdr.upper())
                            if idx >= 0:
                                val = val[:idx].strip()
                        if val:
                            aircraft = val

            if revision is None:
                m = re.search(r'REVISION\s+NO\.?\s*(\d+[a-zA-Z]?)', line, re.IGNORECASE)
                if m:
                    revision = m.group(1)

            if revision_date is None:
                m = re.search(r'DATE:\s*([\d/]{8,10})', line, re.IGNORECASE)
                if m:
                    raw = m.group(1)
                    for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"):
                        try:
                            revision_date = datetime.datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
                            break
                        except ValueError:
                            pass
                    if revision_date is None:
                        revision_date = raw

        if aircraft and revision and revision_date:
            break

    return aircraft or "UNKNOWN", revision or "UNKNOWN", revision_date or "UNKNOWN"


# ─── Remarks column detection ────────────────────────────────────────────────

def find_remarks_col(line):
    """
    Detect the remarks column start position from the header row:
      'Sequence No. Item             1  2   3 4'
    Returns the character position of '4' or None.
    """
    m = re.search(r'Sequence\s+No\.?\s+Item', line, re.IGNORECASE)
    if not m:
        return None
    rest = line[m.end():]
    offset = m.end()
    digits = [(mg.start() + offset, int(mg.group()))
              for mg in re.finditer(r'\b(\d)\b', rest)]
    col_map = {d: pos for pos, d in digits}
    if 4 in col_map:
        return col_map[4]
    return None


# ─── Line classification ─────────────────────────────────────────────────────

SKIP_RE = re.compile(
    r'(U\.S\.\s+DEPARTMENT|FEDERAL AVIATION|MASTER MINIMUM|'
    r'REVISION NO\.|DATE:\s*\d|PAGE NO\.|'
    r'TABLE KEY|1\.\s+REPAIR\s+CATEGORY|2\.\s+NO\.\s+INSTALLED|'
    r'3\.\s+NO\.\s+REQUIRED|4\.\s+REMARKS|'
    r'Sequence\s+No\.\s+Item|^\s*Change$|^\s*Bar$)',
    re.IGNORECASE
)

# System heading: "21. Air Conditioning"
SYSTEM_RE = re.compile(r'^(\d{2,3})\.\s+(.+)$')

# Sub-item: "1) description"
SUBITEM_RE = re.compile(r'^(\d+)\)\s*(.*)')

# Category: single letter A-D
CAT_RE = re.compile(r'^[A-D]$')

# Inline category + installed + required pattern
CAT_DATA_RE = re.compile(r'\s([A-D])\s+(\d+|-)\s+(\d+|-)\s')


def is_skip_line(line):
    return bool(SKIP_RE.search(line))


def is_contd(text):
    return bool(re.match(r'^\(Cont', text.strip(), re.IGNORECASE))


# ─── Row extraction from a page ──────────────────────────────────────────────

def extract_rows(page, rem_col, page_num=None):
    """
    Extract rows from a single page using layout mode.
    Returns (rows, updated_rem_col).
    Each row: {item, cat, inst, req, rem, page}
    """
    text = page.extract_text(layout=True) or ""
    lines = text.splitlines()
    rows = []

    for raw_line in lines:
        new_rem = find_remarks_col(raw_line)
        if new_rem:
            rem_col = new_rem
            continue

        stripped = raw_line.strip()
        if not stripped or is_skip_line(stripped):
            continue

        m_data = CAT_DATA_RE.search(raw_line)

        if m_data:
            item_text = raw_line[:m_data.start()].strip()
            cat_text = m_data.group(1)
            inst_text = m_data.group(2)
            req_text = m_data.group(3)
            rem_text = raw_line[m_data.end():].strip()
        elif rem_col and len(raw_line) > rem_col:
            item_text = raw_line[:rem_col].strip()
            rem_text = raw_line[rem_col:].strip()
            cat_text = inst_text = req_text = ""
        else:
            item_text = stripped
            cat_text = inst_text = req_text = rem_text = ""

        # Clean markers
        rem_text = rem_text.rstrip('| ').strip()
        item_text = item_text.replace('***', '').strip()

        if not item_text and not cat_text and not rem_text:
            continue

        rows.append({
            "item": item_text,
            "cat": cat_text,
            "inst": inst_text,
            "req": req_text,
            "rem": rem_text,
            "page": page_num,
        })

    return rows, rem_col


def parse_int(s):
    """Parse string to int; returns '-' as-is, empty as 0."""
    if not s or s.strip() == '':
        return 0
    if s.strip() == '-':
        return '-'
    try:
        return int(s.strip())
    except ValueError:
        return s.strip()


def make_item(name, cat, inst, req, remarks, pages=None):
    """Create a standard item dict."""
    return {
        "item": name.strip(),
        "repair_category": cat,
        "installed": parse_int(inst),
        "required": parse_int(req),
        "remarks": remarks.strip(),
        "pages": pages if pages else [],
    }


def finalize(systems, aircraft, revision, revision_date):
    """Remove empty equipment/systems and build the final output dict."""
    for sys_data in systems:
        sys_data["equipment"] = [eq for eq in sys_data["equipment"] if eq["items"]]
    systems = [s for s in systems if s["equipment"]]

    return {
        "aircraft": aircraft,
        "revision": revision,
        "revision_date": revision_date,
        "system": systems,
    }


# ─── Page image embedding ────────────────────────────────────────────────────

def embed_page_images(result, pdf_path):
    """
    Replace each item's pages list (e.g. [13, 14]) with a dict of
    page number → base64 JPEG image (e.g. {"13": "...", "14": "..."}).
    Renders each unique page only once.
    """
    # Collect all unique page numbers
    all_pages = set()
    for sys_data in result["system"]:
        for eq in sys_data["equipment"]:
            for item in eq["items"]:
                all_pages.update(item.get("pages", []))

    if not all_pages:
        return

    # Render each page once
    rendered = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page_num in sorted(all_pages):
            page = pdf.pages[page_num - 1]  # page_number is 1-indexed
            page_image = page.to_image(resolution=150)
            pil_img = page_image.original
            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG", quality=85)
            rendered[page_num] = base64.b64encode(buf.getvalue()).decode("utf-8")

    # Replace lists with dicts in each item
    for sys_data in result["system"]:
        for eq in sys_data["equipment"]:
            for item in eq["items"]:
                page_list = item.get("pages", [])
                item["pages"] = {str(p): rendered[p] for p in page_list}
