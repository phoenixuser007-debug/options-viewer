# Technology Stack

## Frontend
- **React 19:** Modern, component-based UI library for a responsive user interface.
- **TypeScript:** Ensuring type safety across the application, especially for financial data models.
- **Vite:** High-performance build tool for fast development and optimized production builds.
- **TailwindCSS 4:** Utility-first CSS framework for rapid and consistent UI styling.
- **Chart.js:** For rendering high-performance financial candlestick charts and data visualizations.
- **pnpm:** Efficient package management for reliable dependency resolution.

## Backend (Tauri)
- **Rust (Tauri 2.x):** Providing a secure, lightweight, and high-performance core for the desktop application.
- **reqwest:** Robust HTTP client for fetching data from financial APIs.
- **tokio-tungstenite:** For low-latency WebSocket communication to receive real-time market updates.
- **tokio:** Multi-threaded async runtime for efficient background task management.
- **serde / serde_json:** Type-safe serialization and deserialization of JSON data between Rust and TypeScript.

## Cross-Cutting
- **Tauri IPC:** Secure communication bridge between the Rust backend and React frontend.
- **Financial APIs:** Logic for interfacing with external data providers (e.g., TradingView or similar).
