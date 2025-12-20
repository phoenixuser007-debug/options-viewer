# options-viewer-tauri

## Project Overview

**options-viewer-tauri** is a desktop application built with [Tauri](https://tauri.app/) (Rust + React) for viewing options chain data, specifically tailored for NIFTY/NSE indices. It provides real-time price updates, options chain visualization with Greeks (Delta, Gamma, Theta, Vega, Rho), and OHLC charts for individual options.

### Tech Stack

*   **Frontend:**
    *   **Framework:** React 19 + TypeScript
    *   **Build Tool:** Vite
    *   **Styling:** TailwindCSS 4
    *   **Charts:** Chart.js (with `chartjs-chart-financial` for candlesticks)
    *   **State/Logic:** Custom hooks wrapping Tauri commands
*   **Backend (Tauri):**
    *   **Language:** Rust
    *   **HTTP Client:** `reqwest`
    *   **Async Runtime:** `tokio`
    *   **Serialization:** `serde` / `serde_json`

## Architecture

The application follows the standard Tauri architecture where the Rust backend handles data fetching and business logic, while the React frontend handles presentation and user interaction.

### Backend (`src-tauri`)

The Rust core is organized into modules:
*   `lib.rs`: The entry point. Sets up the Tauri application and registers commands.
*   `commands/`: Contains the logic for exposed commands.
    *   `options.rs`: Fetches the options chain.
    *   `price.rs`: Fetches the current spot price of the underlying asset.
    *   `expirations.rs`: Fetches available expiration dates.
    *   `ohlc.rs`: Fetches historical data (Open-High-Low-Close) for charting.
    *   `search.rs`: Handles symbol search functionality.
*   `tradingview/`: Likely contains logic for interfacing with TradingView's private API or WebSocket data.

### Frontend (`src`)

The React frontend is structured as follows:
*   `types/index.ts`: TypeScript interfaces defining the data models (shared with backend).
*   `hooks/useTauriCommands.ts`: A centralized abstraction layer for invoking Tauri commands. Components should use these functions instead of calling `invoke` directly.
*   `components/`: Reusable UI components (e.g., `OptionsTable`, `ExpirySelector`, `OHLCModal`).

## Building and Running

### Prerequisites
*   Node.js & pnpm
*   Rust & Cargo

### Commands

Run these commands from the `options-viewer-tauri` directory:

*   **Install Dependencies:**
    ```bash
    pnpm install
    ```

*   **Development (Tauri + Vite):**
    ```bash
    pnpm tauri dev
    ```

*   **Frontend Only (Browser):**
    ```bash
    pnpm dev
    ```

*   **Build Production App:**
    ```bash
    pnpm tauri build
    ```

*   **Linting:**
    ```bash
    pnpm lint
    ```

## Development Conventions

1.  **Tauri Commands:** New backend functionality should be implemented as a function in a relevant module under `commands/`, registered in `lib.rs`, and exposed via a wrapper in `src/hooks/useTauriCommands.ts`.
2.  **Type Safety:** Ensure that Rust structs returned by commands have corresponding TypeScript interfaces in `src/types/index.ts`.
3.  **Styling:** Use TailwindCSS utility classes for styling components.
4.  **Charts:** Use `chart.js` components for any data visualization.
