# Track Spec: Enhance Option OHLC Chart Modal

## Overview
This track focuses on upgrading the `OHLCModal` component to provide a more professional, data-dense, and interactive charting experience for traders. The improvements align the chart with the project's "Data-Dense Modern" visual identity and add essential interactive features.

## Functional Requirements
- **Expanded Layout:** The modal will be resized to occupy approximately 90% of the screen width and height to maximize charting space.
- **Enhanced Visuals:** 
    - Full alignment with the "Data-Dense Modern" theme.
    - Improved typography and border styling for a cleaner, professional look.
- **Interactive Features:**
    - **Zoom & Pan:** Enable mouse-wheel zooming and click-and-drag panning on the chart.
    - **Advanced Tooltips:** Upgrade tooltips to display:
        - OHLCV (Open, High, Low, Close, Volume) data.
        - Greeks (Delta, Gamma, etc.) for the specific timestamp (where data is available).
        - Price change percentage from the previous candle.

## Technical Details
- **Component:** `src/components/OHLCModal.tsx`
- **Libraries:** Leverage existing `chartjs-plugin-zoom` (already in `package.json`) and `chart.js` capabilities.
- **Styling:** TailwindCSS 4 for modal layout and internal UI elements.

## Acceptance Criteria
- [ ] Chart modal opens to a "maximized" state (approx 90% of viewport).
- [ ] Users can zoom in/out and pan across the historical data.
- [ ] Hovering over a candle shows a detailed tooltip with OHLCV and price change.
- [ ] The visual style (colors, borders, fonts) matches the rest of the application's modern dark theme.

## Out of Scope
- Implementing full-scale technical indicators (RSI, MACD) in this specific track.
- Persistent user settings for chart layout (e.g., saving zoom level).
