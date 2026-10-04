---
name: PDF & Document Extraction
slug: pdf-document-extraction
description: Pull clean text, tables, and structure out of PDFs and scanned documents — web-first, then local extractors.
category: Productivity
requires: [workbench]
license: MIT
default: false
---

Get usable text out of PDFs and scanned documents. Try the web route first (no install); fall back to local extractors for local files or when you need OCR / batch.

Use when the Commander hands you a PDF, a scanned report, or asks to extract text/tables from a document.

## Step 1 — has a URL? Fetch it first
If the document is at a URL, `web_fetch("https://.../report.pdf")` often returns clean markdown with no local dependency. Only go local when the file is on disk, the fetch fails, or you need batch/OCR.

## Step 2 — pick a local extractor (via shell.exec)
| Need | Tool | Notes |
|---|---|---|
| Text-based PDF | `pymupdf` (fitz) | Small, fast; good text + basic tables. |
| Scanned PDF (OCR) | `marker-pdf` or `ocrmypdf`+`tesseract` | Handles image-only pages, 90+ languages. Heavier install. |
| Tables specifically | `pdfplumber` / `camelot` | Higher-accuracy table extraction. |
| DOCX | `python-docx` | Parses real structure — far better than OCR. |
| PPTX | `python-pptx` | Slides + speaker notes (see the PowerPoint skill). |

## Recipes
- **Text (pymupdf):** `python -c "import fitz;print(chr(10).join(p.get_text() for p in fitz.open('doc.pdf')))"`
- **OCR a scan:** `ocrmypdf input.pdf output.pdf` then extract text from the searchable output; or `marker_single doc.pdf out/` for markdown+tables.
- **Tables:** `pdfplumber` → `page.extract_tables()` per page.

## Method
1. Try web_fetch if there's a URL.
2. Detect: is it text-based (selectable) or a scan (image-only)? A pymupdf pass returning empty/garbage means it's scanned → switch to OCR.
3. Extract, then clean: strip repeated headers/footers, rejoin hyphenated line breaks, preserve table structure.
4. Save the extracted text/markdown to the workspace and summarize what you got (page count, whether OCR was needed, any low-confidence pages).

*Needs the WORKBENCH object to run the extractors (web_fetch alone covers URL-hosted PDFs without it).*
