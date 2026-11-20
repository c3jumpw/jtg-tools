#!/usr/bin/env python3
"""One-time setup for building and testing HaloDeck: a local copy of the PDF reader (the app fetches it from a
CDN; the screenshot and test runs serve this copy instead) and a handful of sample PDFs."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent
CACHE = ROOT / ".cache"
PDFJS_VER = "4.10.38"

def pdfjs():
    d = CACHE / "pdfjs"
    if (d / "node_modules/pdfjs-dist/build/pdf.min.mjs").exists():
        return
    d.mkdir(parents=True, exist_ok=True)
    subprocess.run(["npm", "install", "--silent", "--prefix", str(d), f"pdfjs-dist@{PDFJS_VER}"], check=True)

def pdfs():
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter, landscape
    from reportlab.lib.colors import HexColor
    from reportlab.lib import pdfencrypt
    d = CACHE / "testpdfs"; d.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(d / "letter-report.pdf"), pagesize=letter); c.setTitle("Quarterly report")
    for i in range(1, 4):
        c.setFillColor(HexColor("#0E2A47")); c.rect(54, 640, 504, 100, fill=1, stroke=0)
        c.setFillColor(HexColor("#FFFFFF")); c.setFont("Helvetica-Bold", 28); c.drawString(72, 680, f"Quarterly report page {i}")
        c.setFillColor(HexColor("#1C1B1A")); c.setFont("Helvetica", 13)
        for j, line in enumerate(["Revenue grew in every region this quarter.", f"Key finding number {i}: churn fell sharply.", "Appendix tables follow on the next page."]):
            c.drawString(72, 590 - j * 22, line)
        c.setStrokeColor(HexColor("#E5484D")); c.setLineWidth(3); c.rect(72, 300, 200, 120)
        c.showPage()
    c.save()
    c = canvas.Canvas(str(d / "slides-169.pdf"), pagesize=(720, 405))
    for i in range(1, 3):
        c.setFillColor(HexColor("#F2A93B")); c.rect(0, 0, 720, 405, fill=1, stroke=0)
        c.setFillColor(HexColor("#1C1B1A")); c.setFont("Helvetica-Bold", 40); c.drawString(50, 300, f"Slide deck title {i}")
        c.setFont("Helvetica", 18); c.drawString(50, 250, "Exported from a slides app as PDF")
        c.showPage()
    c.save()
    c = canvas.Canvas(str(d / "mixed.pdf"), pagesize=letter)
    c.setFont("Helvetica", 24); c.drawString(72, 700, "Portrait page"); c.showPage()
    c.setPageSize(landscape(letter)); c.setFont("Helvetica", 24); c.drawString(72, 500, "Landscape page"); c.showPage()
    c.save()
    c = canvas.Canvas(str(d / "scan.pdf"), pagesize=letter)
    c.setFillColor(HexColor("#888888")); c.rect(100, 200, 400, 400, fill=1, stroke=0); c.showPage(); c.save()
    c = canvas.Canvas(str(d / "locked.pdf"), pagesize=letter, encrypt=pdfencrypt.StandardEncryption("secret", canPrint=1))
    c.drawString(72, 700, "secret"); c.showPage(); c.save()

if __name__ == "__main__":
    pdfjs(); pdfs()
    print("ready:", CACHE)
