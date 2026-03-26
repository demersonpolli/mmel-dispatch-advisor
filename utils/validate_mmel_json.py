"""
validate_mmel_json.py
Validates all MMEL JSON files under documents/mmel/.

Checks performed for each file:
  1. JSON parses and matches the expected MmelSourceRoot schema
  2. Summary counts: systems, equipment entries, items, images, remarks
  3. Items with empty sequence
  4. Items with no images (pages dict is empty)
  5. Items with no remarks
  6. Suspicious Unicode in remarks (control chars, zero-width chars, curly quotes, etc.)
  7. Cross-reference sequences in remarks (same regex as the backend) that do not
     resolve to any equipment sequence within the same aircraft file

Usage:
    cd utils
    python validate_mmel_json.py                  # scan all JSON files
    python validate_mmel_json.py --errors-only    # suppress per-item detail for passing files
"""

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

# ---------------------------------------------------------------------------
# Sequence regex — mirrors RemarkReferenceExtractor.cs exactly
# ---------------------------------------------------------------------------

_RE_STANDARD = re.compile(r'\b(\d{2}-\d{2}-\d{1,2}[A-Za-z]?)\b')
_RE_ITEM_PREFIX = re.compile(r'\bItem\s+(\d{2}-\d{2}-\d{1,2}[A-Za-z]?)\b', re.IGNORECASE)
_RE_DASH_PREFIX = re.compile(r'(?<![0-9A-Za-z])(-\d{1,2}-\d{1,2}(?:-\d{1,2})?[A-Za-z]?)\b')

# Unicode code-points that are suspicious in plain-text remarks
_SUSPICIOUS_CHARS = {
    '\u00ad',  # soft hyphen
    '\u200b',  # zero-width space
    '\u200c',  # zero-width non-joiner
    '\u200d',  # zero-width joiner
    '\u2018',  # left single quotation mark
    '\u2019',  # right single quotation mark
    '\u201c',  # left double quotation mark
    '\u201d',  # right double quotation mark
    '\u2013',  # en dash (normalised to '-' by backend, so harmless, but flag for awareness)
    '\u2212',  # minus sign (same)
    '\ufeff',  # BOM
}


def normalize_sequence(raw: str) -> str:
    """Mirror of RemarkReferenceExtractor.NormalizeSequenceToken."""
    return raw.replace('\u2212', '-').replace('\u2013', '-').strip().lower()


def extract_cross_references(remarks: str) -> set[str]:
    """Extract and normalize all sequence references from a remarks string."""
    refs: set[str] = set()
    for m in _RE_STANDARD.finditer(remarks):
        refs.add(normalize_sequence(m.group(1)))
    for m in _RE_ITEM_PREFIX.finditer(remarks):
        refs.add(normalize_sequence(m.group(1)))
    for m in _RE_DASH_PREFIX.finditer(remarks):
        refs.add(normalize_sequence(m.group(1)))
    return refs


def suspicious_chars_in(text: str) -> list[str]:
    """Return list of descriptions for any suspicious Unicode chars found."""
    found = []
    for ch in set(text):
        if ch in _SUSPICIOUS_CHARS:
            found.append(f'U+{ord(ch):04X} ({unicodedata.name(ch, "?")})')
        elif unicodedata.category(ch).startswith('C') and ch not in ('\n', '\r', '\t'):
            # Control / format / private-use characters
            found.append(f'U+{ord(ch):04X} category={unicodedata.category(ch)}')
    return found


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_file(json_path: Path) -> dict:
    """
    Returns a result dict with keys:
      ok, aircraft, counts, warnings (list of str), errors (list of str)
    """
    result = {
        'path': str(json_path),
        'ok': True,
        'aircraft': '?',
        'counts': {},
        'warnings': [],
        'errors': [],
    }

    # 1. Parse JSON
    try:
        with open(json_path, encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        result['errors'].append(f'JSON parse error: {e}')
        result['ok'] = False
        return result

    # 2. Check top-level schema
    for field in ('aircraft', 'revision', 'revision_date', 'system'):
        if field not in data:
            result['errors'].append(f'Missing top-level field: {field}')
            result['ok'] = False

    aircraft = data.get('aircraft', '')
    result['aircraft'] = aircraft or '(empty)'
    if not aircraft:
        result['errors'].append('aircraft field is empty')

    systems = data.get('system', [])
    if not isinstance(systems, list):
        result['errors'].append('"system" is not a list')
        result['ok'] = False
        return result

    # 3. Collect all normalized sequences present in this file (for cross-ref check)
    all_sequences: set[str] = set()
    total_items = 0
    total_equipment = 0
    total_images = 0
    total_with_remarks = 0

    for sys_idx, system in enumerate(systems):
        for eq_idx, equipment in enumerate(system.get('equipment', [])):
            total_equipment += 1
            seq_raw = equipment.get('sequence', '')
            seq_norm = normalize_sequence(seq_raw)
            if seq_norm:
                all_sequences.add(seq_norm)

    # 4. Detailed per-item checks
    items_empty_seq: list[str] = []
    items_no_images: list[str] = []
    items_no_remarks: list[str] = []
    unicode_issues: list[str] = []
    unresolved_refs: list[str] = []

    for sys_idx, system in enumerate(systems):
        sys_title = system.get('title', f'System[{sys_idx}]')
        for eq_idx, equipment in enumerate(system.get('equipment', [])):
            seq_raw = equipment.get('sequence', '')
            seq_norm = normalize_sequence(seq_raw)
            label = f'{sys_title} / seq={seq_raw!r}'

            for item_idx, item in enumerate(equipment.get('items', [])):
                total_items += 1
                item_label = f'{label} item[{item_idx}] {str(item.get("item", ""))[:60]!r}'

                # Empty sequence
                if not seq_norm:
                    items_empty_seq.append(item_label)

                # No images
                pages = item.get('pages', {})
                if not pages:
                    items_no_images.append(item_label)
                else:
                    total_images += len(pages)

                # No remarks
                remarks = item.get('remarks', '')
                if remarks:
                    total_with_remarks += 1
                else:
                    items_no_remarks.append(item_label)

                # Suspicious Unicode
                if remarks:
                    sus = suspicious_chars_in(remarks)
                    if sus:
                        unicode_issues.append(f'{item_label}: {", ".join(sus)}')

                # Cross-reference resolution
                refs = extract_cross_references(remarks)
                for ref in sorted(refs):
                    if ref == seq_norm:
                        continue  # self-reference, harmless
                    if ref not in all_sequences:
                        unresolved_refs.append(
                            f'{item_label}: references {ref!r} (not found in this file)'
                        )

    result['counts'] = {
        'systems': len(systems),
        'equipment': total_equipment,
        'items': total_items,
        'items_with_remarks': total_with_remarks,
        'total_images': total_images,
        'distinct_sequences': len(all_sequences),
    }

    if items_empty_seq:
        for msg in items_empty_seq:
            result['errors'].append(f'Empty sequence: {msg}')
        result['ok'] = False

    if unresolved_refs:
        for msg in unresolved_refs:
            result['warnings'].append(f'Unresolved cross-ref: {msg}')

    if items_no_images:
        result['warnings'].append(
            f'{len(items_no_images)} item(s) have no images'
        )

    if items_no_remarks:
        result['warnings'].append(
            f'{len(items_no_remarks)} item(s) have no remarks'
        )

    if unicode_issues:
        for msg in unicode_issues:
            result['warnings'].append(f'Suspicious Unicode: {msg}')

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description='Validate all MMEL JSON files.')
    parser.add_argument(
        '--errors-only', action='store_true',
        help='Only print detail for files with errors; suppress warnings for clean files.'
    )
    parser.add_argument(
        'paths', nargs='*',
        help='Specific JSON file(s) to validate. Defaults to all files under documents/mmel/.'
    )
    args = parser.parse_args()

    if args.paths:
        json_files = [Path(p) for p in args.paths]
    else:
        repo_root = Path(__file__).resolve().parent.parent
        mmel_dir = repo_root / 'documents' / 'mmel'
        json_files = sorted(mmel_dir.rglob('*.json'))

    if not json_files:
        print('No JSON files found.')
        return 1

    all_results = []
    for path in json_files:
        result = validate_file(path)
        all_results.append(result)

    # Print per-file results
    total_errors = 0
    total_warnings = 0
    for r in all_results:
        has_errors = bool(r['errors'])
        has_warnings = bool(r['warnings'])
        if args.errors_only and not has_errors:
            continue

        status = 'FAIL' if has_errors else ('WARN' if has_warnings else 'OK  ')
        c = r['counts']
        counts_str = (
            f"systems={c.get('systems',0)}  "
            f"equipment={c.get('equipment',0)}  "
            f"items={c.get('items',0)}  "
            f"images={c.get('total_images',0)}  "
            f"sequences={c.get('distinct_sequences',0)}"
        ) if c else ''

        print(f"\n[{status}] {Path(r['path']).name}  ({r['aircraft']})")
        if counts_str:
            print(f"       {counts_str}")

        for msg in r['errors']:
            print(f"  ERROR   {msg}")
            total_errors += 1
        for msg in r['warnings']:
            print(f"  WARN    {msg}")
            total_warnings += 1

    # Summary
    n_ok   = sum(1 for r in all_results if not r['errors'] and not r['warnings'])
    n_warn = sum(1 for r in all_results if not r['errors'] and r['warnings'])
    n_fail = sum(1 for r in all_results if r['errors'])
    print(f"\n{'='*60}")
    print(f"Files: {len(all_results)}  OK={n_ok}  WARN={n_warn}  FAIL={n_fail}")
    print(f"Total errors: {total_errors}  Total warnings: {total_warnings}")
    print('='*60)

    return 1 if total_errors > 0 else 0


if __name__ == '__main__':
    sys.exit(main())
