"""Trace parse_pdf directly by importing and patching."""
import sys
sys.path.insert(0, r"utils")

# Monkey-patch parse_pdf to add debug output
import parse_mmel as pm
import pdfplumber

orig_parse_pdf = pm.parse_pdf

def debug_parse_pdf(pdf_path, short_model):
    systems_dict   = {}
    current_system = None
    current_eq     = None
    current_item   = None
    col_bounds     = None

    cat_re_strict = pm.re.compile(r'^[A-D]$')
    row_count = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            if not pm.PAGE_HEADER_RE.search(page_text):
                continue

            page_rows, col_bounds = pm.parse_page_lines(page, col_bounds)
            print(f"Page has {len(page_rows)} rows, bounds={col_bounds}", flush=True)

            for row in page_rows[:20]:  # Only first 20 rows
                item_col = row["item"]
                cat      = row["cat"]
                inst     = row["inst"]
                req      = row["req"]
                remarks  = row["rem"]

                row_count += 1
                print(f"  [{row_count}] item={item_col!r} cat={cat!r}", flush=True)

                if not item_col and not cat and not remarks:
                    print(f"       -> SKIP (blank)", flush=True)
                    continue

                item_col_stripped = item_col.lstrip()
                m_sys = pm.SYSTEM_RE.match(item_col_stripped)
                if m_sys:
                    print(f"       -> SYS_MATCH: num={m_sys.group(1)} cat_empty={not cat}", flush=True)
                if m_sys and not cat and int(m_sys.group(1)) >= 21 and len(item_col_stripped) < 70:
                    print(f"       -> SET current_system={m_sys.group(2)}", flush=True)
                    sys_num = m_sys.group(1)
                    sys_title = m_sys.group(2).strip()
                    if sys_num not in systems_dict:
                        systems_dict[sys_num] = {"title": sys_title, "equipment": []}
                    current_system = systems_dict[sys_num]
                    current_eq = None
                    current_item = None
                    continue

                if not current_system:
                    print(f"       -> SKIP (no current_system)", flush=True)
                    continue

                item_col_stripped = item_col.lstrip()
                m_seq = pm.SEQUENCE_RE.match(item_col_stripped)
                if m_seq:
                    print(f"       -> SEQ {m_seq.group(1)}, cat={cat!r}", flush=True)
            break  # Only first TABLE KEY page

debug_parse_pdf(r"documents\mmel\atr\ATR-72_Rev_21.pdf", "ATR72")
