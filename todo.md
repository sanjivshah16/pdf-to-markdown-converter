# Project TODO

- [x] Neo-Brutalist design system with Space Grotesk typography
- [x] PDF upload interface with drag-and-drop
- [x] Backend API for PDF processing with Tesseract OCR
- [x] Figure extraction and linking to questions
- [x] Markdown preview and download
- [x] Conversion history (database storage)
- [x] S3 storage for uploaded PDFs and extracted images
- [x] Progress tracking during conversion

## Phase 2 - Enhancements

- [x] Integrate real OCR processing with Python script
- [x] Copy Python conversion script to web app
- [x] Create backend endpoint to execute Python OCR
- [x] Add database schema for conversion history
- [x] Store conversion results with user association
- [x] Implement figure-question linking logic
- [x] Detect figures and link to nearest questions
- [x] Build conversion history page UI
- [x] Add history navigation and download past results
- [x] Write tests for all new features
- [x] Update color scheme from lime green to Bubblegum Pink (#EF798A)
- [x] Add live rendered markdown preview (not just raw text)

## Bug Fixes

- [x] Fix real OCR processing - now uses PyMuPDF + Tesseract hybrid approach
