"""
Generate a single Markdown file from all MMEL JSON files, suitable for RAG.
Each item becomes a section with the item as heading (primary search field),
and includes aircraft, system title, sequence, and dispatch details.
"""

import json
import os

JSON_FILES = [
    "documents/mmel/airbus/A-320_Rev_32.json",
    "documents/mmel/airbus/A-220_Rev_15.json",
    "documents/mmel/atr/ATR-42_Rev_26a.json",
    "documents/mmel/atr/ATR-72_Rev_21.json",
    "documents/mmel/boeing/B-737_Rev_62.json",
    "documents/mmel/boeing/B-737_MAX_Rev_6.json",
    "documents/mmel/boeing/B-747-400_Rev_32.json",
    "documents/mmel/boeing/B-777_Rev_23a.json",
    "documents/mmel/embraer/EMB-135-145_Rev_19.json",
]

OUTPUT_FILE = "documents/mmel_rag.md"


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lines: list[str] = []

    lines.append("# MMEL – Master Minimum Equipment List (All Aircraft)\n")

    for rel_path in JSON_FILES:
        full_path = os.path.join(root, rel_path)
        if not os.path.exists(full_path):
            print(f"WARNING: {full_path} not found, skipping.")
            continue

        with open(full_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        aircraft = data["aircraft"]
        revision = data.get("revision", "")
        revision_date = data.get("revision_date", "")

        lines.append(f"## Aircraft: {aircraft} (Rev. {revision}, {revision_date})\n")

        for system in data.get("system", []):
            system_title = system["title"]

            for equipment in system.get("equipment", []):
                sequence = equipment.get("sequence", "")

                for item_obj in equipment.get("items", []):
                    item_name = item_obj.get("item", "")
                    repair_cat = item_obj.get("repair_category", "")
                    installed = item_obj.get("installed", "")
                    required = item_obj.get("required", "")
                    remarks = item_obj.get("remarks", "")

                    lines.append(f"### {item_name}\n")
                    lines.append(f"- **Aircraft:** {aircraft}")
                    lines.append(f"- **System:** {system_title}")
                    lines.append(f"- **Sequence:** {sequence}")
                    lines.append(f"- **Repair Category:** {repair_cat}")
                    lines.append(f"- **Installed:** {installed}")
                    lines.append(f"- **Required:** {required}")
                    lines.append(f"- **Remarks:** {remarks}\n")

    output_path = os.path.join(root, OUTPUT_FILE)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Generated {output_path} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
