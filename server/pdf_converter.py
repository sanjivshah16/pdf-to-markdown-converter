#!/usr/bin/env python3
"""
PDF to Markdown Converter using PyMuPDF with Tesseract OCR fallback.
Optimized for speed - uses native text extraction first, OCR only when needed.
Handles scanned PDFs with two-column layouts and extracts figures linked to questions.
"""

import os
import re
import sys
import json
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Tuple
import fitz  # PyMuPDF
import pytesseract
from PIL import Image
from io import BytesIO


class PDFToMarkdownConverter:
    """
    Converts PDFs to Markdown with figure extraction and question linking.
    Uses PyMuPDF for fast native text extraction, Tesseract for scanned pages.
    """
    
    def __init__(self, pdf_path: str, output_dir: str = "output"):
        """
        Initialize the converter.
        
        Args:
            pdf_path: Path to the input PDF file
            output_dir: Directory for output files
        """
        self.pdf_path = Path(pdf_path)
        self.output_dir = Path(output_dir)
        self.images_dir = self.output_dir / "images"
        
        # Create output directories
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)
        
        # Store extracted figures with their metadata
        self.figures: List[Dict] = []
        self.question_figure_map: Dict[int, List[str]] = {}
        self.page_texts: List[str] = []
        self.total_pages: int = 0
        
    def extract_figures_pymupdf(self) -> List[Dict]:
        """
        Extract figures/images from PDF using PyMuPDF.
        Returns list of figure metadata with paths.
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
    
    def convert_page_with_ocr(self, page: fitz.Page, page_num: int) -> str:
        """
        Convert a single page using OCR.
        
        Args:
            page: PyMuPDF page object
            page_num: Page number (0-indexed)
            
        Returns:
            Extracted text from the page
        """
        # Render page to image at 150 DPI (good balance of speed vs quality)
        mat = fitz.Matrix(150/72, 150/72)  # 150 DPI
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to PIL Image
        img_data = pix.tobytes("png")
        img = Image.open(BytesIO(img_data))
        
        width, height = img.size
        
        # Detect if two-column layout
        is_two_column = width > height * 0.7
        
        try:
            if is_two_column:
                # Process as two columns
                mid_x = width // 2
                margin = 15
                
                # Left column
                left_col = img.crop((0, 0, mid_x + margin, height))
                left_text = pytesseract.image_to_string(left_col, lang='eng')
                
                # Right column
                right_col = img.crop((mid_x - margin, 0, width, height))
                right_text = pytesseract.image_to_string(right_col, lang='eng')
                
                return left_text.strip() + "\n\n" + right_text.strip()
            else:
                return pytesseract.image_to_string(img, lang='eng')
        except Exception as e:
            return f"[OCR Error: {str(e)}]"
    
    def convert(self) -> Tuple[str, str]:
        """
        Main conversion method.
        Uses native text extraction first, falls back to OCR for scanned pages.
        
        Returns:
            Tuple of (markdown_text, output_path)
        """
        # Extract figures first
        print("Extracting figures from PDF...")
        self.extract_figures_pymupdf()
        
        meaningful_figures = [f for f in self.figures if f.get('type') == 'embedded_image']
        print(f"Extracted {len(meaningful_figures)} embedded figures")
        
        # Open document for text extraction
        doc = fitz.open(self.pdf_path)
        self.total_pages = len(doc)
        
        print(f"Converting {self.total_pages} pages...")
        
        page_contents = []
        ocr_pages = 0
        native_pages = 0
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            print(f"Processing page {page_num + 1}/{len(doc)}...")
            
            # Try native text extraction first
            text = page.get_text("text").strip()
            
            # If very little text found, use OCR
            if len(text) < 100:
                text = self.convert_page_with_ocr(page, page_num)
                ocr_pages += 1
            else:
                native_pages += 1
            
            page_text = f"\n\n## Page {page_num + 1}\n\n{text}"
            page_contents.append(page_text)
            self.page_texts.append(page_text)
        
        doc.close()
        
        print(f"Extraction complete: {native_pages} native, {ocr_pages} OCR")
        
        # Combine all pages
        raw_markdown = "\n\n---\n\n".join(page_contents)
        
        # Link figures to questions
        self.link_figures_to_questions(raw_markdown)
        
        # Format the markdown
        formatted_text = self.format_markdown(raw_markdown)
        
        # Create header
        header = f"""# {self.pdf_path.stem}

**Source:** {self.pdf_path.name}  
**Total Pages:** {self.total_pages}  
**Figures Extracted:** {len(meaningful_figures)}  
**Conversion Method:** PyMuPDF + Tesseract OCR

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
            "figures": [
                {k: v for k, v in fig.items() if k != 'path'} 
                for fig in self.figures if fig.get('type') == 'embedded_image'
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
            page_matches = list(re.finditer(r'## Page (\d+)', markdown_text[:pos]))
            if page_matches:
                current_page = int(page_matches[-1].group(1))
            
            # Check if question references a figure
            if any(keyword in q_text for keyword in figure_keywords):
                for fig in self.figures:
                    if fig.get('type') == 'embedded_image':
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
            if fig.get('type') != 'embedded_image':
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
        description="Convert scanned PDFs to Markdown with figure extraction"
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
        default="tesseract",
        help="Conversion method (ignored, uses hybrid approach)"
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
        output_dir=args.output
    )
    
    markdown_text, output_path = converter.convert()
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
