"""
parse_mmel.py
Master script to parse all MMEL PDFs into JSON.

Routes each PDF to the appropriate parser based on manufacturer/format:
  - parse_standard: Airbus, ATR, Embraer (XX-XX-XX sequences)
  - parse_boeing:   Boeing (hierarchical sequences, with dash prefix for B-777)

Output JSON format (same for all):
{
    "aircraft": "...",
    "revision": "...",
    "revision_date": "YYYY-MM-DD",
    "system": [
        {
            "title": "...",
            "equipment": [
                {
                    "sequence": "XX-XX-XX",
                    "items": [
                        {
                            "item": "...",
                            "repair_category": "A/B/C/D",
                            "installed": int,
                            "required": int,
                            "remarks": "..."
                        }
                    ]
                }
            ]
        }
    ]
}
"""

import json
from pathlib import Path
from parse_standard import parse_pdf as parse_standard
from parse_boeing import parse_pdf as parse_boeing
from parse_bd500 import parse_pdf as parse_bd500
from mmel_common import embed_page_images

# PDF files and their parser configuration.
# Format: (relative path from documents/mmel, parser function, kwargs, output filename override)
#
# Not included (PDFs removed):
#   - boeing/B-787_Rev_19.pdf        (Boeing 787)
#   - embraer/MMEL ERJ-170-190 Rev 20.pdf  (Embraer ERJ-170/190)
PDF_CONFIG = [
    # Airbus
    ("airbus/A-320_Rev_32.pdf", parse_standard, {}, None),
    ("airbus/BD_500.pdf", parse_bd500, {}, "airbus/A-220_Rev_15.json"),
    # ATR
    ("atr/ATR-42_Rev_26a.pdf", parse_standard, {}, None),
    ("atr/ATR-72_Rev_21.pdf", parse_standard, {}, None),
    # Boeing
    ("boeing/B-737_Rev_62.pdf", parse_boeing, {"dash_sequences": False}, None),
    ("boeing/B-737_MAX_Rev_6.pdf", parse_boeing, {"dash_sequences": False}, None),
    ("boeing/B-747-400_Rev_32.pdf", parse_boeing, {"dash_sequences": False}, None),
    ("boeing/B-777_Rev_23a.pdf", parse_boeing, {"dash_sequences": True}, None),
    # Embraer
    ("embraer/EMB-135-145_Rev_19.pdf", parse_standard, {}, None),
]


if __name__ == "__main__":
    mmel_dir = Path(__file__).resolve().parent.parent / "documents" / "mmel"

    for rel_path, parser_fn, kwargs, out_override in PDF_CONFIG:
        pdf_path = mmel_dir / rel_path
        if not pdf_path.exists():
            print(f"Not found: {rel_path}")
            continue

        print(f"\n--- {pdf_path.name} ---")
        try:
            result = parser_fn(str(pdf_path), **kwargs)

            total_equip = sum(len(s['equipment']) for s in result['system'])
            total_items = sum(
                len(eq['items'])
                for s in result['system']
                for eq in s['equipment']
            )
            print(f"  Aircraft: {result['aircraft']}")
            print(f"  Revision: {result['revision']}  Date: {result['revision_date']}")
            print(f"  Systems: {len(result['system'])}  Equipment: {total_equip}  Items: {total_items}")

            # Embed base64 JPEG page images into each item
            print(f"  Rendering page images...", flush=True)
            embed_page_images(result, str(pdf_path))

            if out_override:
                out_path = mmel_dir / out_override
            else:
                out_path = pdf_path.with_suffix('.json')
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=4, ensure_ascii=False)
            print(f"  Saved: {out_path.name}")

        except Exception as e:
            import traceback
            print(f"  FAILED: {e}")
            traceback.print_exc()
