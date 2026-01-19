#!/usr/bin/env python3
"""
PDF to Markdown Converter using Docling.
Docling provides superior document understanding, table extraction, and layout analysis.
Falls back to PyMuPDF + Tesseract if docling fails.
"""

import os
import re
import sys
import json
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Tuple

# Try docling first
try:
    from docling.document_converter import DocumentConverter
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.document import PictureItem
    DOCLING_AVAILABLE = True
except ImportError:
    DOCLING_AVAILABLE = False
    print("Warning: Docling not available, falling back to PyMuPDF + Tesseract")

# Fallback imports
import fitz  # PyMuPDF for image extraction
from PIL import Image
from io import BytesIO


class PDFToMarkdownConverter:
    """
    Converts PDFs to Markdown using Docling for text/structure extraction
    and figure detection. Uses PyMuPDF to crop detected figures from pages.
    """

    def __init__(self, pdf_path: str, output_dir: str = "output", use_ocr: bool = True):
        """
        Initialize the converter.

        Args:
            pdf_path: Path to the input PDF file
            output_dir: Directory for output files
            use_ocr: Whether to use OCR for scanned documents
        """
        self.pdf_path = Path(pdf_path)
        self.output_dir = Path(output_dir)
        self.images_dir = self.output_dir / "images"
        self.use_ocr = use_ocr

        # Create output directories
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)

        # Store extracted figures with their metadata
        self.figures: List[Dict] = []
        self.question_figure_map: Dict[int, List[str]] = {}
        self.total_pages: int = 0

        # Store Docling result for figure extraction
        self.docling_result = None

    def extract_figures_from_docling(self, docling_result) -> List[Dict]:
        """
        Extract individual figures detected by Docling's layout analysis.
        Uses bounding boxes from Docling to crop figures from PDF pages.
        """
        figures = []
        doc = fitz.open(self.pdf_path)
        self.total_pages = len(doc)

        # Get pictures from Docling's document structure
        picture_items = []

        # Iterate through document items to find pictures
        for item, level in docling_result.document.iterate_items():
            if isinstance(item, PictureItem):
                picture_items.append(item)

        print(f"Docling detected {len(picture_items)} figures in the document")

        # Process each detected picture
        for idx, picture in enumerate(picture_items):
            try:
                # Get provenance info (page and bounding box)
                if not picture.prov or len(picture.prov) == 0:
                    print(f"  Figure {idx + 1}: No provenance info")
                    continue

                prov = picture.prov[0]  # First provenance entry
                page_num = prov.page_no  # 1-indexed in Docling
                bbox = prov.bbox

                if page_num < 1 or page_num > len(doc):
                    print(f"  Figure {idx + 1}: Invalid page number {page_num}")
                    continue

                # Get the PDF page (0-indexed in PyMuPDF)
                page = doc[page_num - 1]
                page_rect = page.rect

                # Get the bbox coordinates from Docling
                # Docling uses PDF coordinate system: origin at BOTTOM-left, y increases upward
                # bbox has l=left, t=top, r=right, b=bottom (in PDF coords where top > bottom)
                # PyMuPDF uses origin at TOP-left, y increases downward

                docling_l = bbox.l
                docling_t = bbox.t  # In PDF coords, this is the higher y value
                docling_r = bbox.r
                docling_b = bbox.b  # In PDF coords, this is the lower y value

                print(f"  Figure {idx + 1} on page {page_num}: docling_bbox=({docling_l:.1f}, {docling_b:.1f}, {docling_r:.1f}, {docling_t:.1f}), page_size=({page_rect.width:.1f}, {page_rect.height:.1f})")

                # Convert from PDF coordinates (bottom-left origin) to PyMuPDF (top-left origin)
                # PyMuPDF y = page_height - PDF y
                x0 = docling_l
                x1 = docling_r
                y0 = page_rect.height - docling_t  # top in PDF becomes smaller y in PyMuPDF
                y1 = page_rect.height - docling_b  # bottom in PDF becomes larger y in PyMuPDF

                print(f"    Converted to PyMuPDF coords: ({x0:.1f}, {y0:.1f}, {x1:.1f}, {y1:.1f})")

                # Create clip rectangle with some padding
                padding = 5
                clip_rect = fitz.Rect(
                    max(0, x0 - padding),
                    max(0, y0 - padding),
                    min(page_rect.width, x1 + padding),
                    min(page_rect.height, y1 + padding)
                )

                # Skip if rect is too small (less than 30x30 points)
                if clip_rect.width < 30 or clip_rect.height < 30:
                    print(f"    Skipping: rect too small ({clip_rect.width:.1f}x{clip_rect.height:.1f})")
                    continue

                # Skip page headers: figures at very top of page with extreme aspect ratio
                aspect_ratio = clip_rect.width / max(clip_rect.height, 1)
                if y0 < 80 and aspect_ratio > 5:
                    print(f"    Skipping: likely page header (y0={y0:.1f}, aspect_ratio={aspect_ratio:.1f})")
                    continue

                # Render the clipped region at high resolution
                mat = fitz.Matrix(2.0, 2.0)  # 2x zoom for better quality
                pix = page.get_pixmap(matrix=mat, clip=clip_rect)

                # Save the image
                img_filename = f"figure_{page_num}_{idx + 1}.png"
                img_path = self.images_dir / img_filename
                pix.save(str(img_path))

                # Verify the image
                with Image.open(img_path) as img:
                    width, height = img.size
                    if width < 30 or height < 30:
                        print(f"    Skipping: image too small ({width}x{height})")
                        os.remove(img_path)
                        continue

                print(f"    Saved: {img_filename} ({width}x{height})")
                figures.append({
                    "page": page_num,
                    "index": idx + 1,
                    "filename": img_filename,
                    "path": str(img_path),
                    "type": "detected_figure",
                    "dimensions": (width, height),
                    "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
                })

            except Exception as e:
                print(f"Warning: Could not extract figure {idx + 1}: {e}")
                import traceback
                traceback.print_exc()

        doc.close()

        # If Docling didn't detect any figures, fall back to embedded image extraction
        if len(figures) == 0:
            print("Docling detected no figures, falling back to embedded image extraction...")
            return self.extract_figures_pymupdf()

        print(f"Successfully extracted {len(figures)} figures using Docling")
        self.figures = figures
        return figures

    def extract_figures_pymupdf(self) -> List[Dict]:
        """
        Fallback: Extract embedded images from PDF using PyMuPDF.
        Used when Docling figure detection doesn't find figures.
        """
        figures = []
        doc = fitz.open(self.pdf_path)
        self.total_pages = len(doc)

        for page_num in range(len(doc)):
            page = doc[page_num]

            # Extract embedded images
            image_list = page.get_images(full=True)
            for img_index, img_info in enumerate(image_list):
                xref = img_info[0]
                try:
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    image_ext = base_image["ext"]

                    # Filter out very small images (likely decorative)
                    if len(image_bytes) < 1000:
                        continue

                    img_filename = f"page{page_num + 1}_img{img_index + 1}.{image_ext}"
                    img_path = self.images_dir / img_filename

                    with open(img_path, "wb") as img_file:
                        img_file.write(image_bytes)

                    # Check image dimensions
                    with Image.open(img_path) as img:
                        width, height = img.size
                        # Skip very small images
                        if width < 50 or height < 50:
                            os.remove(img_path)
                            continue

                    figures.append({
                        "page": page_num + 1,
                        "index": img_index + 1,
                        "filename": img_filename,
                        "path": str(img_path),
                        "type": "embedded_image",
                        "dimensions": (width, height)
                    })
                except Exception as e:
                    print(f"Warning: Could not extract image from page {page_num + 1}: {e}")

        doc.close()
        self.figures = figures
        return figures

    def convert_with_docling(self) -> Tuple[str, any]:
        """
        Convert PDF to markdown using Docling.
        Returns tuple of (markdown_content, docling_result).
        """
        print("Converting with Docling...")

        # Create converter
        converter = DocumentConverter(
            allowed_formats=[InputFormat.PDF],
        )

        # Convert document
        result = converter.convert(str(self.pdf_path))

        # Export to markdown
        markdown_content = result.document.export_to_markdown()

        # Get page count from docling result
        if hasattr(result.document, 'pages'):
            self.total_pages = len(result.document.pages)
        elif hasattr(result.document, 'num_pages'):
            self.total_pages = result.document.num_pages

        # Store the result for figure extraction
        self.docling_result = result

        return markdown_content, result

    def convert_with_fallback(self) -> str:
        """
        Fallback conversion using PyMuPDF + Tesseract.
        """
        print("Using fallback converter (PyMuPDF + Tesseract)...")
        import pytesseract

        doc = fitz.open(self.pdf_path)
        self.total_pages = len(doc)

        page_contents = []

        for page_num in range(len(doc)):
            page = doc[page_num]
            print(f"Processing page {page_num + 1}/{len(doc)}...")

            # Try native text extraction first
            text = page.get_text("text").strip()

            # If very little text found, use OCR
            if len(text) < 100 and self.use_ocr:
                mat = fitz.Matrix(150/72, 150/72)
                pix = page.get_pixmap(matrix=mat)
                img_data = pix.tobytes("png")
                img = Image.open(BytesIO(img_data))
                text = pytesseract.image_to_string(img, lang='eng')

            page_contents.append(f"## Page {page_num + 1}\n\n{text}")

        doc.close()
        return "\n\n---\n\n".join(page_contents)

    def convert(self) -> Tuple[str, str]:
        """
        Main conversion method.
        Uses Docling for text extraction AND figure detection.
        Falls back to PyMuPDF + Tesseract if Docling fails.

        Returns:
            Tuple of (markdown_text, output_path)
        """
        conversion_method = "Docling"
        docling_result = None

        # Try Docling first for both text conversion and figure detection
        if DOCLING_AVAILABLE:
            try:
                print("Converting with Docling (text + figure detection)...")
                markdown_content, docling_result = self.convert_with_docling()

                # Extract figures using Docling's layout detection
                print("Extracting figures using Docling's layout analysis...")
                self.extract_figures_from_docling(docling_result)

            except Exception as e:
                print(f"Docling conversion failed: {e}")
                print("Falling back to PyMuPDF + Tesseract...")
                markdown_content = self.convert_with_fallback()
                conversion_method = "PyMuPDF + Tesseract OCR"

                # Fall back to PyMuPDF for figure extraction
                print("Extracting figures using PyMuPDF...")
                self.extract_figures_pymupdf()
        else:
            markdown_content = self.convert_with_fallback()
            conversion_method = "PyMuPDF + Tesseract OCR"

            # Use PyMuPDF for figure extraction
            print("Extracting figures using PyMuPDF...")
            self.extract_figures_pymupdf()

        # Count meaningful figures
        meaningful_figures = [f for f in self.figures if f.get('type') in ('detected_figure', 'embedded_image')]
        print(f"Extracted {len(meaningful_figures)} figures")
        print(f"Converting {self.total_pages} pages with {conversion_method}...")

        # Link figures to questions
        self.link_figures_to_questions(markdown_content)

        # Format the markdown
        formatted_text = self.format_markdown(markdown_content)

        # Create header
        header = f"""# {self.pdf_path.stem}

**Source:** {self.pdf_path.name}
**Total Pages:** {self.total_pages}
**Figures Extracted:** {len(meaningful_figures)}
**Conversion Method:** {conversion_method}

---

"""

        # Combine all parts
        final_markdown = header + formatted_text

        # Add figure appendix
        final_markdown += self.create_figure_appendix()

        # Save markdown file
        output_path = self.output_dir / f"{self.pdf_path.stem}.md"
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(final_markdown)

        # Save figure metadata as JSON
        metadata = {
            "source_file": str(self.pdf_path),
            "total_pages": self.total_pages,
            "conversion_method": conversion_method,
            "figures": [
                {k: v for k, v in fig.items() if k != 'path'}
                for fig in self.figures if fig.get('type') in ('detected_figure', 'embedded_image')
            ],
            "question_figure_map": {str(k): v for k, v in self.question_figure_map.items()}
        }

        metadata_path = self.output_dir / f"{self.pdf_path.stem}_metadata.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)

        print(f"\nConversion complete!")
        print(f"Markdown saved to: {output_path}")
        print(f"Metadata saved to: {metadata_path}")
        print(f"Images saved to: {self.images_dir}")

        return final_markdown, str(output_path)

    def link_figures_to_questions(self, markdown_text: str) -> Dict[int, List[str]]:
        """
        Analyze markdown text to link figures with their corresponding questions.
        """
        question_figure_map = {}

        figure_keywords = [
            'figure', 'graph', 'diagram', 'shown', 'below', 'above',
            'image', 'chart', 'table', 'illustration', 'picture',
            'as shown', 'in the figure', 'following figure', 'refer to',
            'based on', 'according to'
        ]

        # Pattern to find question numbers
        question_pattern = r'(?:^|\n)\s*\*?\*?(\d+)\.\*?\*?\s+(.+?)(?=\n\s*\*?\*?\d+\.\*?\*?|$)'

        questions = list(re.finditer(question_pattern, markdown_text, re.DOTALL))

        current_page = 1
        for match in questions:
            q_num = int(match.group(1))
            q_text = match.group(2).lower()

            # Find which page this question is on
            pos = match.start()
            page_matches = list(re.finditer(r'(?:## Page|page\s+)(\d+)', markdown_text[:pos], re.IGNORECASE))
            if page_matches:
                current_page = int(page_matches[-1].group(1))

            # Check if question references a figure
            if any(keyword in q_text for keyword in figure_keywords):
                for fig in self.figures:
                    if fig.get('type') in ('detected_figure', 'embedded_image'):
                        fig_page = fig['page']
                        if abs(fig_page - current_page) <= 2:
                            if q_num not in question_figure_map:
                                question_figure_map[q_num] = []
                            if fig['filename'] not in question_figure_map[q_num]:
                                question_figure_map[q_num].append(fig['filename'])

        self.question_figure_map = question_figure_map
        return question_figure_map

    def format_markdown(self, raw_text: str) -> str:
        """
        Format and clean up the raw text into proper markdown.
        """
        text = raw_text

        # Clean up common artifacts
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'(\n\s*)+\n', '\n\n', text)

        # Format question numbers (bold)
        text = re.sub(r'^(\d+)\.\s+', r'**\1.** ', text, flags=re.MULTILINE)

        # Format answer choices as list items
        text = re.sub(r'^([A-J])\.\s+', r'- **\1.** ', text, flags=re.MULTILINE)
        text = re.sub(r'^([A-J])\s+', r'- **\1.** ', text, flags=re.MULTILINE)

        # Format section headers
        text = re.sub(r'^(PASSAGE\s+[IVX]+)', r'### \1', text, flags=re.MULTILINE)
        text = re.sub(r'^(ENGLISH TEST|MATHEMATICS TEST|READING TEST|SCIENCE TEST)',
                     r'# \1', text, flags=re.MULTILINE)

        return text

    def create_figure_appendix(self) -> str:
        """
        Create an appendix section with all extracted figures.
        """
        if not self.figures:
            return ""

        appendix = "\n\n---\n\n## Extracted Figures\n\n"

        figures_by_page = {}
        for fig in self.figures:
            if fig.get('type') not in ('detected_figure', 'embedded_image'):
                continue
            page = fig['page']
            if page not in figures_by_page:
                figures_by_page[page] = []
            figures_by_page[page].append(fig)

        for page in sorted(figures_by_page.keys()):
            appendix += f"### Page {page}\n\n"
            for fig in figures_by_page[page]:
                appendix += f"![Figure from page {page}](images/{fig['filename']})\n\n"

                for q_num, fig_names in self.question_figure_map.items():
                    if fig['filename'] in fig_names:
                        appendix += f"*Linked to Question {q_num}*\n\n"
                        break

        return appendix


def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(
        description="Convert PDFs to Markdown using Docling"
    )
    parser.add_argument(
        "pdf_path",
        help="Path to the input PDF file"
    )
    parser.add_argument(
        "-o", "--output",
        default="output",
        help="Output directory (default: output)"
    )
    parser.add_argument(
        "-m", "--method",
        choices=["docling", "tesseract"],
        default="docling",
        help="Conversion method (docling recommended)"
    )
    parser.add_argument(
        "--no-ocr",
        action="store_true",
        help="Disable OCR (for non-scanned PDFs)"
    )

    args = parser.parse_args()

    if not os.path.exists(args.pdf_path):
        print(f"Error: File not found: {args.pdf_path}")
        sys.exit(1)

    converter = PDFToMarkdownConverter(
        pdf_path=args.pdf_path,
        output_dir=args.output,
        use_ocr=not args.no_ocr
    )

    markdown_text, output_path = converter.convert()

    return 0


if __name__ == "__main__":
    sys.exit(main())
