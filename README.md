# AI Dispatch Advisor - Aircraft MEL Compliance

## Overview
Web app for aircraft dispatchers to get instant Minimum Equipment List (MEL) guidance during turnaround. Features responsive design, voice input, color-coded decisions, and PDF report generation.

**Frontend**: Vite + React + TypeScript @ localhost:3000
**Backend**: Express API @ localhost:4000 (MMEL record matching)

## Features
- **Aircraft Selection**: Dropdown for Boeing 737 MAX, Airbus A320, ATR 72 (highlighted in red), Embraer EMB-145
- **Issue Input**: Free text or voice input for MEL issues (e.g., "AC pack inoperative")
- **AI Analysis**: Instant dispatch decision (GO/CONDITIONAL) with required actions, limitations, and MMEL traceability
- **Voice Commands**: Web Speech API for hands-free input (triggers analysis automatically)
- **Color-Coded UI**: Green for approved actions, yellow for conditional, red for issues; bold text for retrieved/decision states
- **Responsive Design**: 3-column layout on desktop, 2 on tablet, 1 on mobile for optimal viewing
- **PDF Report Generation**: Downloadable dispatch reports with color-coded sections using jsPDF
- **Glassmorphism Styling**: Modern UI with backdrop blur, gradients, and shadows for a cinematic look
- **Reset Functionality**: Clear all inputs and results with one button
- **Live API Integration**: Fetches MMEL records from Express backend

## Interesting Implementations
- **Responsive Grid**: CSS media queries adapt layout dynamically without JavaScript
- **PDF Coloring Logic**: Conditional text colors in generated PDFs (green for retrieved issues, yellow for manual)
- **Voice Auto-Analysis**: Speech recognition triggers analysis if keywords like "analyze" are spoken
- **State Management**: Tracks input source (voice vs. manual) for UI styling differences
- **Cinematic Aesthetics**: Enhanced with stronger blur, glow effects, and dark blue gradients for professional feel

## Setup
```
yarn install
yarn dev
```
- Vite: localhost:3000
- API: localhost:4000/health

## Usage
1. Dropdown aircraft
2. Type issue
3. Analyze → Results

## Issues Fixed
- TS project reference errors (tsconfig monorepo setup)
- Vite bundling (esbuild tsconfig parse)
- Expo Babel conflicts (switched pure Vite React web)
- API proxy + CORS

Note: Original 562 diagnostics from strict TS + missing types (fixed by configs/installs)

## Deployment
The app can be deployed for free on platforms. Build with `npm run build` in `apps/mobile`, then upload the `dist` folder or connect the GitHub repo for auto-deployment.

