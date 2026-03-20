"""
parse_bd500.py
Parser for the BD-500 (A220) MMEL PDF (Transport Canada format).

Pages with data contain "ATA - XX" (with regular or Unicode dash).
System title is on the line like "21-AIR CONDITIONING".
Sequences are XX-XX format (e.g., 00-01, 20-01).
Sub-items use 1), 2), and sub-sub use A), B).
Uses Unicode minus sign (U+2212) as dash in some places.
"""

import re
import json
import sys
from pathlib import Path
from mmel_common import (
    CAT_RE, make_item, finalize,
)

# Normalize unicode dashes to regular hyphen
def norm(s):
    return s.replace('\u2212', '-').replace('\u2013', '-')

# ATA page marker
ATA_PAGE_RE = re.compile(r'ATA\s*[\-\u2013\u2212]\s*(\d{2})')

# System title: "21-AIR CONDITIONING" or "22-AUTO FLIGHT"
# Must have uppercase letter after dash (not a digit, to avoid matching sequences)
SYSTEM_TITLE_RE = re.compile(r'^(\d{2})\s*[\-\u2212\u2013]\s*([A-Z].+)')

# Sequence: XX-XX (e.g., 00-01, 20-01, 21-19) with optional trailing text
# Must NOT be followed by more dashes/digits (to avoid matching references like 21-00-133-01)
SEQUENCE_RE = re.compile(r'^(\d{2}[\-\u2212]\d{2})(?![\-\u2212\d])\s*(.*)')

# Sub-item: "1) description" or "11) description"
SUBITEM_RE = re.compile(r'^(\d+)\)\s*(.*)')

# Sub-sub-item: "A) description" or "B) description"
SUBSUB_RE = re.compile(r'^([A-Z])\)\s*(.*)')

# Inline category pattern: "C 1 0" or "D - 0" or "B 2 1"
CAT_DATA_RE = re.compile(r'\s([A-D])\s+(\d+|-)\s+(\d+|-)\s')

# Lines to skip
SKIP_RE = re.compile(
    r'(System & Sequence|Number Installed|Number Required|'
    r'Remarks or Exceptions|Master Minimum Equipment|'
    r'BD500|Transport Canada|Issue \d|Page \d|'
    r'^\s*Aircraft\s*$|^\s*A220)',
    re.IGNORECASE
)

CONTD_RE = re.compile(r'^\(Cont', re.IGNORECASE)

# Detect remarks column from "4. Remarks" position on system title line
REMARKS_COL_RE = re.compile(r'4\.\s+Remarks')


def parse_pdf(pdf_path):
    import pdfplumber

    aircraft = "A220-100 / A220-300"
    revision = "15"
    revision_date = "2024-10-11"

    systems = []
    systems_map = {}
    current_system = None
    current_equip = None
    current_item = None
    current_sys_num = ""
    equip_name = ""
    sub_label = ""  # e.g. "1) Check Valve"

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_num = page.page_number
            raw_text = page.extract_text() or ''
            if not ATA_PAGE_RE.search(raw_text):
                continue

            layout = page.extract_text(layout=True) or ''
            lines = layout.splitlines()

            # Detect remarks column position from "4. Remarks" on this page
            rem_col = None
            for raw_line in lines:
                m_rc = REMARKS_COL_RE.search(raw_line)
                if m_rc:
                    rem_col = m_rc.start()
                    break

            for raw_line in lines:
                line = norm(raw_line).strip()
                if not line:
                    continue

                # ATA header line (e.g., "ATA - 21")
                if ATA_PAGE_RE.search(line):
                    continue

                # System title (e.g., "21-AIR CONDITIONING")
                # Check before SKIP_RE since the line may contain "Remarks or Exceptions"
                m_sys = SYSTEM_TITLE_RE.match(line)
                if m_sys:
                    sys_num = m_sys.group(1)
                    sys_title = m_sys.group(2).strip()
                    # Remove "4. Remarks or Exceptions" if appended
                    for suffix in ["4.", "4. Remarks"]:
                        idx = sys_title.find(suffix)
                        if idx >= 0:
                            sys_title = sys_title[:idx].strip()

                    if sys_num in systems_map:
                        current_system = systems_map[sys_num]
                    else:
                        current_system = {"title": sys_title, "equipment": []}
                        systems.append(current_system)
                        systems_map[sys_num] = current_system
                    current_sys_num = sys_num
                    current_equip = None
                    current_item = None
                    equip_name = ""
                    sub_label = ""
                    continue

                if SKIP_RE.search(line):
                    continue

                if current_system is None:
                    continue

                if CONTD_RE.match(line):
                    continue

                # Try to find CAT/INST/REQ pattern
                m_data = CAT_DATA_RE.search(raw_line)
                if m_data:
                    item_text = norm(raw_line[:m_data.start()]).strip()
                    cat = m_data.group(1)
                    inst = m_data.group(2)
                    req = m_data.group(3)
                    rem = norm(raw_line[m_data.end():]).strip()
                elif rem_col and len(raw_line) > rem_col:
                    # Split at remarks column
                    item_text = norm(raw_line[:rem_col]).strip()
                    rem = norm(raw_line[rem_col:]).strip()
                    cat = inst = req = ""
                else:
                    item_text = line
                    cat = inst = req = rem = ""

                # Remove change markers
                item_text = item_text.replace('***', '').strip()
                rem = rem.rstrip('| ').strip()

                if not item_text and not cat and not rem:
                    continue

                # Sequence row: XX-XX
                m_seq = SEQUENCE_RE.match(item_text)
                if m_seq:
                    seq_num = current_sys_num + "-" + m_seq.group(1).replace('\u2212', '-')
                    rest = m_seq.group(2).strip()

                    existing = next(
                        (eq for eq in current_system["equipment"]
                         if eq["sequence"] == seq_num), None)
                    if existing:
                        current_equip = existing
                    else:
                        current_equip = {"sequence": seq_num, "items": []}
                        current_system["equipment"].append(current_equip)

                    equip_name = rest
                    sub_label = ""

                    if cat and CAT_RE.match(cat):
                        current_item = make_item(equip_name, cat, inst, req, rem, pages=[page_num])
                        current_equip["items"].append(current_item)
                    else:
                        current_item = None
                    continue

                # Sub-sub-item: A), B)
                m_subsub = SUBSUB_RE.match(item_text)
                if m_subsub and current_equip is not None:
                    letter = m_subsub.group(1)
                    desc = m_subsub.group(2).strip()

                    if cat and CAT_RE.match(cat):
                        composed = equip_name
                        if sub_label:
                            composed += " - " + sub_label
                        composed += " - " + f"{letter}) {desc}"
                        current_item = make_item(composed, cat, inst, req, rem, pages=[page_num])
                        current_equip["items"].append(current_item)
                    else:
                        current_item = None
                    continue

                # Sub-item: 1), 2), 11)
                m_sub = SUBITEM_RE.match(item_text)
                if m_sub and current_equip is not None:
                    sub_num = m_sub.group(1)
                    sub_desc = m_sub.group(2).strip()
                    sub_label = f"{sub_num}) {sub_desc}"

                    if cat and CAT_RE.match(cat):
                        composed = equip_name
                        if composed:
                            composed += " - "
                        composed += sub_label
                        current_item = make_item(composed, cat, inst, req, rem, pages=[page_num])
                        current_equip["items"].append(current_item)
                    else:
                        current_item = None
                    continue

                # Category-only row (no item text)
                if cat and CAT_RE.match(cat) and not item_text and current_equip is not None:
                    name = equip_name
                    if sub_label:
                        name += " - " + sub_label
                    current_item = make_item(name, cat, inst, req, rem, pages=[page_num])
                    current_equip["items"].append(current_item)
                    continue

                # Item text with category
                if cat and CAT_RE.match(cat) and item_text and current_equip is not None:
                    current_item = make_item(item_text, cat, inst, req, rem, pages=[page_num])
                    current_equip["items"].append(current_item)
                    continue

                # Continuation line
                if current_item is not None:
                    if page_num not in current_item["pages"]:
                        current_item["pages"].append(page_num)
                    if item_text:
                        current_item["item"] = (current_item["item"] + " " + item_text).strip()
                        if sub_label:
                            sub_label = (sub_label + " " + item_text).strip()
                        else:
                            equip_name = (equip_name + " " + item_text).strip()
                    if rem:
                        current_item["remarks"] = (current_item["remarks"] + " " + rem).strip()
                elif current_equip is not None and item_text:
                    if sub_label:
                        sub_label = (sub_label + " " + item_text).strip()
                    else:
                        equip_name = (equip_name + " " + item_text).strip()

    return finalize(systems, aircraft, revision, revision_date)


if __name__ == "__main__":
    pdf_path = Path("../documents/mmel/airbus/BD_500.pdf")
    out_path = Path("../documents/mmel/airbus/A-220_Rev_15.json")

    print(f"--- {pdf_path.name} ---")
    try:
        result = parse_pdf(str(pdf_path))
        total_equip = sum(len(s['equipment']) for s in result['system'])
        total_items = sum(
            len(eq['items'])
            for s in result['system']
            for eq in s['equipment']
        )
        print(f"  Aircraft: {result['aircraft']}")
        print(f"  Revision: {result['revision']}  Date: {result['revision_date']}")
        print(f"  Systems: {len(result['system'])}  Equipment: {total_equip}  Items: {total_items}")

        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=4, ensure_ascii=False)
        print(f"  Saved: {out_path.name}")

    except Exception as e:
        import traceback
        print(f"  FAILED: {e}")
        traceback.print_exc()
