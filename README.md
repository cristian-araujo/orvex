# Orvex

A fast, lightweight MySQL desktop client built with Tauri 2 and React.

## Features

- **Connection manager** — multiple connections with SSH tunnel support
- **Object browser** — explore databases, tables, views, and columns with context menus
- **SQL editor** — syntax highlighting via Monaco Editor, multi-tab support
- **Data grid** — editable rows, inline filtering, column chips, pagination
- **Table structure** — column definitions, indexes, and foreign keys
- **Export** — SQL, CSV, and JSON export with progress tracking and cancellation
- **Import** — SQL file import with chunked INSERT execution and progress tracking
- **Settings** — persistent preferences for display, query behavior, export defaults, and more

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Tauri 2](https://tauri.app) (Rust + WebView) |
| Frontend | React 19 + TypeScript |
| State | Zustand |
| Editor | Monaco Editor |
| Data grid | AG Grid Community |
| Database | sqlx 0.7 (MySQL) |
| SSH tunnels | russh |

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- A C compiler and system WebView (see [Tauri prerequisites](https://tauri.app/start/prerequisites/))

## Getting Started

```bash
# Install frontend dependencies
npm install

# Run in development mode (hot reload)
npm run tauri dev

# Build for production
npm run tauri build
```

## Platform Support

Orvex targets all major desktop platforms via Tauri's bundle system:

- Linux (AppImage, .deb)
- macOS (.dmg, .app)
- Windows (.msi, .exe)

## License

MIT
