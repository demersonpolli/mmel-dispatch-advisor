"""
parse_standard.py
Parser for standard MMEL PDFs (Airbus, ATR, Embraer).

Sequence numbers are in the format XX-XX-XX or XX-XX-X (e.g., 21-22-01, 21-10-1).
All items belong directly under their sequence.
"""

import re
import json
from pathlib import Path
from mmel_common import (
    extract_metadata, extract_rows, finalize,
    SYSTEM_RE, SUBITEM_RE, CAT_RE, is_contd, make_item,
)

# Sequence: XX-XX-XX or XX-XX-X, optionally with trailing letter
SEQUENCE_RE = re.compile(r'^(\d{2}-\d{2}-\d{1,2}[A-Z]?)\b')


def parse_pdf(pdf_path):
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        aircraft, revision, revision_date = extract_metadata(pdf)

        systems = []
        systems_map = {}
        current_system = None
        current_equip = None
        current_item = None
        equip_name = ""
        rem_col = None

        for page in pdf.pages:
            page_text = page.extract_text() or ""
            if "TABLE KEY" not in page_text:
                continue

            rows, rem_col = extract_rows(page, rem_col, page.page_number)

            for row in rows:
                item_col = row["item"]
                cat = row["cat"]
                inst = row["inst"]
                req = row["req"]
                remarks = row["rem"]
                page_num = row["page"]

                if item_col == '|':
                    continue

                # System heading
                m_sys = SYSTEM_RE.match(item_col)
                if m_sys and not cat:
                    sys_num = m_sys.group(1)
                    sys_title = m_sys.group(2).strip()
                    if sys_num in systems_map:
                        current_system = systems_map[sys_num]
                    else:
                        current_system = {"title": sys_title, "equipment": []}
                        systems.append(current_system)
                        systems_map[sys_num] = current_system
                    current_equip = None
                    current_item = None
                    equip_name = ""
                    continue

                if current_system is None:
                    continue

                if is_contd(item_col):
                    continue

                # Skip aircraft name lines
                if re.match(r'AIRCRAFT:', item_col, re.IGNORECASE):
                    continue
                if item_col.strip().lower() == aircraft.lower():
                    continue

                # Sequence number
                m_seq = SEQUENCE_RE.match(item_col)
                if m_seq:
                    seq_num = m_seq.group(1)
                    rest = item_col[m_seq.end():].strip()

                    existing = next(
                        (eq for eq in current_system["equipment"]
                         if eq["sequence"] == seq_num), None)
                    if existing:
                        current_equip = existing
                    else:
                        current_equip = {"sequence": seq_num, "items": []}
                        current_system["equipment"].append(current_equip)

                    equip_name = rest

                    if cat and CAT_RE.match(cat):
                        current_item = make_item(equip_name, cat, inst, req, remarks, pages=[page_num])
                        current_equip["items"].append(current_item)
                    else:
                        current_item = None
                    continue

                # Sub-item: "1) description"
                m_sub = SUBITEM_RE.match(item_col)
                if m_sub and current_equip is not None:
                    sub_num = m_sub.group(1)
                    sub_desc = m_sub.group(2).strip()

                    if cat and CAT_RE.match(cat):
                        composed = equip_name
                        if composed:
                            composed += " - "
                        composed += f"{sub_num}) {sub_desc}"
                        current_item = make_item(composed, cat, inst, req, remarks, pages=[page_num])
                        current_equip["items"].append(current_item)
                    else:
                        if equip_name:
                            equip_name += " - "
                        equip_name += f"{sub_num}) {sub_desc}"
                        current_item = None
                    continue

                # Category-only row (no item text)
                if cat and CAT_RE.match(cat) and not item_col and current_equip is not None:
                    current_item = make_item(equip_name, cat, inst, req, remarks, pages=[page_num])
                    current_equip["items"].append(current_item)
                    continue

                # Item text with category (no sequence, no sub-item)
                if cat and CAT_RE.match(cat) and item_col and current_equip is not None:
                    current_item = make_item(item_col, cat, inst, req, remarks, pages=[page_num])
                    current_equip["items"].append(current_item)
                    continue

                # Continuation line
                if current_item is not None:
                    if page_num not in current_item["pages"]:
                        current_item["pages"].append(page_num)
                    if item_col:
                        current_item["item"] = (current_item["item"] + " " + item_col).strip()
                        equip_name = (equip_name + " " + item_col).strip()
                    if remarks:
                        current_item["remarks"] = (current_item["remarks"] + " " + remarks).strip()
                elif current_equip is not None and item_col:
                    equip_name = (equip_name + " " + item_col).strip()

    return finalize(systems, aircraft, revision, revision_date)


if __name__ == "__main__":
    files = [
        Path("../documents/mmel/airbus/A-320_Rev_32.pdf"),
        Path("../documents/mmel/atr/ATR-42_Rev_26a.pdf"),
        Path("../documents/mmel/atr/ATR-72_Rev_21.pdf"),
        Path("../documents/mmel/embraer/EMB-135-145_Rev_19.pdf"),
    ]

    for pdf_path in files:
        if not pdf_path.exists():
            print(f"Not found: {pdf_path}")
            continue

        print(f"\n--- {pdf_path.name} ---")
        try:
            result = parse_pdf(str(pdf_path))
            total_equip = sum(len(s['equipment']) for s in result['system'])
            total_items = sum(len(eq['items']) for s in result['system'] for eq in s['equipment'])
            print(f"  Aircraft: {result['aircraft']}  Rev: {result['revision']}  Date: {result['revision_date']}")
            print(f"  Systems: {len(result['system'])}  Equipment: {total_equip}  Items: {total_items}")

            out_path = pdf_path.with_suffix('.json')
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=4, ensure_ascii=False)
            print(f"  Saved: {out_path.name}")
        except Exception as e:
            import traceback
            print(f"  FAILED: {e}")
            traceback.print_exc()
