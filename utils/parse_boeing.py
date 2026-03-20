"""
parse_boeing.py
Parser for Boeing MMEL PDFs.

Boeing uses hierarchical sequence numbering relative to the ATA system chapter:
  - Group headers: 01, 01-01 (no category, carry a group name)
  - Sequences:     01A, 01B, 01-01-01, 01-01-01A (have items with categories)
  - Some models (B-747-400) use XX-X or XX-XX as actual sequences with items

The system chapter number (e.g., 21, 22) is NOT part of the sequence number.
"""

import re
import json
from pathlib import Path
from mmel_common import (
    extract_metadata, extract_rows, finalize,
    SYSTEM_RE, SUBITEM_RE, CAT_RE, is_contd, make_item,
)

# Sequence patterns (relative to system, no leading system chapter)
# B-777 style with leading dash: -00-01, -24-01-01, -26-05A
SEQ_DASH_RE = re.compile(r'^(-[\d-]+[A-Z]?)\b')
# Full: 01-01-01 or 01-01-01A
SEQ_FULL_RE = re.compile(r'^(\d{2}-\d{2}-\d{1,2}[A-Z]?)\b')
# Short with letter suffix: 01A, 01B  (items, not group headers)
SEQ_SHORT_LETTER_RE = re.compile(r'^(\d{2}[A-Z])\s')
# Mid: 01-01 or 20-01 (could be group or item depending on context)
SEQ_MID_RE = re.compile(r'^(\d{2}-\d{1,2}[A-Z]?)\s')
# Short: 01 (usually a group header)
SEQ_SHORT_RE = re.compile(r'^(\d{2})\s')


def parse_pdf(pdf_path, dash_sequences=False):
    """
    Parse a Boeing MMEL PDF.
    Set dash_sequences=True for B-777 style sequences (-XX-XX, -XX-XX-XX).
    """
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        aircraft, revision, revision_date = extract_metadata(pdf)

        systems = []
        systems_map = {}
        current_system = None
        current_equip = None
        current_item = None
        equip_name = ""
        group_name = ""
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
                    group_name = ""
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

                # Try to match a sequence number
                seq_num = None
                rest = ""

                # Try dash-prefixed (B-777 only): -00-01, -24-01-01, -26-05A
                if dash_sequences:
                    m = SEQ_DASH_RE.match(item_col)
                    if m:
                        seq_num = m.group(1)
                        rest = item_col[m.end():].strip()
                if not seq_num:
                    # Try full XX-XX-XX
                    m = SEQ_FULL_RE.match(item_col)
                    if m:
                        seq_num = m.group(1)
                        rest = item_col[m.end():].strip()
                if not seq_num:
                    # Try short with letter: 01A (always an item, not group)
                    m = SEQ_SHORT_LETTER_RE.match(item_col + " ")
                    if m:
                        seq_num = m.group(1)
                        rest = item_col[m.end():].strip()
                if not seq_num:
                    # Try mid: XX-XX or XX-X
                    m = SEQ_MID_RE.match(item_col + " ")
                    if m:
                        seq_num = m.group(1)
                        rest = item_col[m.end():].strip()
                if not seq_num:
                    # Try short: XX
                    m = SEQ_SHORT_RE.match(item_col + " ")
                    if m:
                        seq_num = m.group(1)
                        rest = item_col[m.end():].strip()

                if seq_num:
                    # Decide: group header or item sequence?
                    has_letter = bool(re.search(r'[A-Z]$', seq_num))
                    is_dash_prefix = seq_num.startswith('-')

                    # Group header: no category, has name, short/mid form, no letter suffix
                    # For dash-prefixed: -XX-XX is group, -XX-XX-XX is item
                    if is_dash_prefix:
                        dash_parts = seq_num.lstrip('-').split('-')
                        is_group = (not cat and rest and len(dash_parts) <= 2
                                    and not has_letter)
                    else:
                        is_group = (not cat and rest
                                    and not SEQ_FULL_RE.match(seq_num)
                                    and not has_letter)

                    if is_group:
                        group_name = rest
                        current_equip = None
                        current_item = None
                        equip_name = ""
                        continue

                    # It's an actual sequence
                    existing = next(
                        (eq for eq in current_system["equipment"]
                         if eq["sequence"] == seq_num), None)
                    if existing:
                        current_equip = existing
                    else:
                        current_equip = {"sequence": seq_num, "items": []}
                        current_system["equipment"].append(current_equip)

                    if rest:
                        equip_name = rest
                    elif group_name:
                        equip_name = group_name
                    else:
                        equip_name = ""

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

                # Category-only row
                if cat and CAT_RE.match(cat) and not item_col and current_equip is not None:
                    current_item = make_item(equip_name, cat, inst, req, remarks, pages=[page_num])
                    current_equip["items"].append(current_item)
                    continue

                # Item text with category
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
    # (pdf_path, dash_sequences)
    files = [
        (Path("../documents/mmel/boeing/B-737_Rev_62.pdf"), False),
        (Path("../documents/mmel/boeing/B-737_MAX_Rev_6.pdf"), False),
        (Path("../documents/mmel/boeing/B-747-400_Rev_32.pdf"), False),
        (Path("../documents/mmel/boeing/B-777_Rev_23a.pdf"), True),
    ]

    for pdf_path, dash in files:
        if not pdf_path.exists():
            print(f"Not found: {pdf_path}")
            continue

        print(f"\n--- {pdf_path.name} ---")
        try:
            result = parse_pdf(str(pdf_path), dash_sequences=dash)
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
