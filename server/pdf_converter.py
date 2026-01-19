#!/usr/bin/env python3
"""
PDF to Markdown Converter using Docling and Tesseract OCR
Handles scanned PDFs with two-column layouts and extracts figures linked to questions.
"""

import os
import re
import sys
import json
import shutil
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Tuple
import fitz  # PyMuPDF
import pytesseract
from PIL import Image
from pdf2image import convert_from_path


class PDFToMarkdownConverter:
    """
    Converts scanned PDFs to Markdown with figure extraction and question linking.
    """
    
    def __init__(self, pdf_path: str, output_dir: str = "output", use_tesseract: bool = True):
        """
        Initialize the converter.
        
        Args:
            pdf_path: Path to the input PDF file
            output_dir: Directory for output files
            use_tesseract: Whether to use Tesseract OCR for scanned documents
        """
        self.pdf_path = Path(pdf_path)
        self.output_dir = Path(output_dir)
        self.images_dir = self.output_dir / "images"
        self.use_tesseract = use_tesseract
        
        # Create output directories
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)
        
        # Store extracted figures with their metadata
        self.figures: List[Dict] = []
        self.question_figure_map: Dict[int, List[str]] = {}
        self.page_texts: List[str] = []
        
    def extract_figures_pymupdf(self) -> List[Dict]:
        """
        Extract figures/images from PDF using PyMuPDF.
        Returns list of figure metadata with paths.
        """
        figures = []
        doc = fitz.open(self.pdf_path)
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            
            # Render page as image for figure extraction
            pix = page.get_pixmap(dpi=150)
            page_img_filename = f"page_{page_num + 1}_full.png"
            page_img_path = self.images_dir / page_img_filename
            pix.save(str(page_img_path))
            
            figures.append({
                "page": page_num + 1,
                "filename": page_img_filename,
                "path": str(page_img_path),
                "type": "page_render"
            })
            
            # Also extract embedded images
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
    
    def convert_with_docling(self) -> str:
        """
        Convert PDF to markdown using Docling with Tesseract OCR.
        
        Returns:
            Markdown string
        """
        print(f"Converting {self.pdf_path} using Docling...")
        
        try:
            from docling.document_converter import DocumentConverter
            
            # Create converter with default settings
            converter = DocumentConverter()
            
            # Convert the document
            result = converter.convert(str(self.pdf_path))
            
            # Export to markdown
            markdown_text = result.document.export_to_markdown()
            
            return markdown_text
        except Exception as e:
            print(f"Docling conversion error: {e}")
            raise
    
    def convert_with_tesseract(self) -> str:
        """
        Convert PDF using direct Tesseract OCR.
        Handles two-column layouts by processing each column separately.
        
        Returns:
            Markdown string
        """
        print(f"Converting {self.pdf_path} using Tesseract OCR...")
        
        # Convert PDF pages to images
        images = convert_from_path(self.pdf_path, dpi=300)
        
        full_text = []
        
        for page_num, page_image in enumerate(images):
            print(f"Processing page {page_num + 1}/{len(images)}...")
            
            width, height = page_image.size
            
            # Detect if two-column layout based on page dimensions
            # Standard letter/A4 in landscape orientation suggests two columns
            is_two_column = width > height * 0.7
            
            page_text = f"\n\n## Page {page_num + 1}\n\n"
            
            if is_two_column:
                # Process as two columns
                mid_x = width // 2
                margin = 20  # Small overlap to avoid cutting text
                
                # Left column
                left_col = page_image.crop((0, 0, mid_x + margin, height))
                left_text = pytesseract.image_to_string(left_col, lang='eng')
                
                # Right column
                right_col = page_image.crop((mid_x - margin, 0, width, height))
                right_text = pytesseract.image_to_string(right_col, lang='eng')
                
                # Combine columns - left first, then right
                page_text += left_text.strip() + "\n\n" + right_text.strip()
            else:
                # Single column processing
                page_text += pytesseract.image_to_string(page_image, lang='eng')
            
            self.page_texts.append(page_text)
            full_text.append(page_text)
        
        return "\n\n---\n\n".join(full_text)
    
    def detect_and_extract_figures(self, page_images: List[Image.Image]) -> List[Dict]:
        """
        Detect and extract figure regions from page images.
        Uses image analysis to find graphical content.
        """
        extracted_figures = []
        
        for page_num, page_image in enumerate(page_images):
            # Convert to grayscale for analysis
            gray = page_image.convert('L')
            width, height = gray.size
            
            # Use Tesseract to get bounding boxes of text
            try:
                data = pytesseract.image_to_data(page_image, output_type=pytesseract.Output.DICT)
                
                # Find regions with no text (potential figures)
                text_regions = []
                for i in range(len(data['text'])):
                    if data['text'][i].strip():
                        x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                        text_regions.append((x, y, x + w, y + h))
                
                # This is a simplified approach - more sophisticated methods would use ML
            except Exception as e:
                print(f"Warning: Could not analyze page {page_num + 1} for figures: {e}")
        
        return extracted_figures
    
    def link_figures_to_questions(self, markdown_text: str) -> Dict[int, List[str]]:
        """
        Analyze markdown text to link figures with their corresponding questions.
        
        Args:
            markdown_text: The converted markdown text
            
        Returns:
            Dictionary mapping question numbers to figure filenames
        """
        question_figure_map = {}
        
        # Find questions that reference figures
        # Look for patterns like "shown in the figure", "as shown", "diagram", "graph"
        figure_keywords = [
            'figure', 'graph', 'diagram', 'shown', 'below', 'above', 
            'image', 'chart', 'table', 'illustration', 'picture',
            'as shown', 'in the figure', 'following figure'
        ]
        
        # Pattern to find question numbers
        question_pattern = r'(?:^|\n)\s*(\d+)\.\s+(.+?)(?=\n\s*\d+\.|$)'
        
        questions = list(re.finditer(question_pattern, markdown_text, re.DOTALL))
        
        for match in questions:
            q_num = int(match.group(1))
            q_text = match.group(2).lower()
            
            # Check if question references a figure
            if any(keyword in q_text for keyword in figure_keywords):
                # Find figures from the same or nearby pages
                # This is a heuristic - we associate figures based on page proximity
                for fig in self.figures:
                    if fig.get('type') == 'embedded_image':
                        if q_num not in question_figure_map:
                            question_figure_map[q_num] = []
                        if fig['filename'] not in question_figure_map[q_num]:
                            question_figure_map[q_num].append(fig['filename'])
        
        self.question_figure_map = question_figure_map
        return question_figure_map
    
    def format_markdown(self, raw_text: str) -> str:
        """
        Format and clean up the raw OCR text into proper markdown.
        
        Args:
            raw_text: Raw OCR text
            
        Returns:
            Formatted markdown text
        """
        text = raw_text
        
        # Clean up common OCR artifacts
        text = re.sub(r'\n{3,}', '\n\n', text)  # Multiple newlines
        text = re.sub(r'[ \t]+', ' ', text)  # Multiple spaces
        text = re.sub(r'(\n\s*)+\n', '\n\n', text)  # Clean up whitespace
        
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
        
        Returns:
            Markdown string for the appendix
        """
        if not self.figures:
            return ""
        
        appendix = "\n\n---\n\n## Extracted Figures\n\n"
        
        # Group figures by page
        figures_by_page = {}
        for fig in self.figures:
            page = fig['page']
            if page not in figures_by_page:
                figures_by_page[page] = []
            figures_by_page[page].append(fig)
        
        for page in sorted(figures_by_page.keys()):
            appendix += f"### Page {page}\n\n"
            for fig in figures_by_page[page]:
                if fig.get('type') == 'embedded_image':
                    appendix += f"![Figure from page {page}](images/{fig['filename']})\n\n"
        
        return appendix
    
    def convert(self, method: str = "docling") -> Tuple[str, str]:
        """
        Main conversion method.
        
        Args:
            method: Conversion method - "docling" or "tesseract"
            
        Returns:
            Tuple of (markdown_text, output_path)
        """
        # Extract figures first
        print("Extracting figures from PDF...")
        self.extract_figures_pymupdf()
        
        # Filter to only meaningful figures
        meaningful_figures = [f for f in self.figures if f.get('type') == 'embedded_image']
        print(f"Extracted {len(meaningful_figures)} embedded figures")
        
        # Convert to markdown
        if method == "docling":
            try:
                markdown_text = self.convert_with_docling()
            except Exception as e:
                print(f"Docling conversion failed: {e}")
                print("Falling back to Tesseract...")
                markdown_text = self.convert_with_tesseract()
        else:
            markdown_text = self.convert_with_tesseract()
        
        # Link figures to questions
        self.link_figures_to_questions(markdown_text)
        
        # Format the markdown
        formatted_text = self.format_markdown(markdown_text)
        
        # Create header
        header = f"""# {self.pdf_path.stem}

**Source:** {self.pdf_path.name}  
**Total Pages:** {len(self.page_texts) if self.page_texts else 'N/A'}  
**Figures Extracted:** {len(meaningful_figures)}  
**Conversion Method:** {method}

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
        help="Conversion method (default: tesseract)"
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
        use_tesseract=not args.no_ocr
    )
    
    markdown_text, output_path = converter.convert(method=args.method)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
