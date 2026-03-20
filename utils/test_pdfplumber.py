import pdfplumber
import sys

def test_parsing():
    pdf_path = r"documents/mmel/airbus/A-220_Rev_15.pdf"
    
    with pdfplumber.open(pdf_path) as pdf:
        text = ""
        for i, page in enumerate(pdf.pages):
            page_text = page.extract_text(layout=True)
            if page_text:
                text += page_text + "\n"
        print(f"Extracted {len(text)} chars.")
        print("TABLE KEY" in text)

if __name__ == "__main__":
    test_parsing()
