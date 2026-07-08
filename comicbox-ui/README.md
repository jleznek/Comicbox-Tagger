# Comicbox Tag Studio

GUI app for tagging comic archives with [Comicbox](https://comicbox.readthedocs.io/).

It provides a visual workflow:
- scan a library folder
- select a comic file
- preview online tagging in dry-run mode
- apply metadata writes to selected formats

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: FastAPI (Python)
- Tagging engine: Comicbox CLI

## Prerequisites

1. Python 3.10+
2. Node.js 20+
3. Comicbox installed in the Python environment used by the backend:

```bash
pip install comicbox
```

If your collection includes CBR files, install `unrar` and ensure it is on PATH.

## Setup

Install frontend dependencies:

```bash
npm install
```

Install backend dependencies:

```bash
python -m pip install -r backend/requirements.txt
```

## Run Locally

Start backend API (terminal 1):

```bash
npm run dev:api
```

Start frontend UI (terminal 2):

```bash
npm run dev:ui
```

Then open the URL shown by Vite (typically `http://localhost:5173`).

## Scripts

- `npm run build:exe` builds a standalone Windows executable bundle in `release/ComicboxTagStudio/`.
- `npm run comicbox -- ...` runs Comicbox through the project venv with UTF-8-safe console settings.
- `npm run dev` or `npm run dev:ui` starts the React UI.
- `npm run dev:api` starts the FastAPI backend.
- `npm run build` builds the frontend for production.
- `npm run lint` runs ESLint.
- `npm run format` formats files with Prettier.
- `npm run format:check` checks formatting.

## Safe Manual Comicbox Usage

Use the wrapper script instead of calling a global `comicbox` install directly:

```bash
npm run comicbox -- --online all --match careful --prompts never -p --dry-run "\\mycloud-12\public\comics - Copy\Science Fiction\V\V 001 (1985).cbr"
```

This uses the project-local virtual environment and forces UTF-8 console output on Windows.

## Build Standalone EXE (Windows)

Build the desktop bundle:

```bash
npm run build:exe
```

Output:

```text
release/ComicboxTagStudio/ComicboxTagStudio.exe
```

Launch the executable directly. It starts the local server on `http://127.0.0.1:8000` and opens your browser automatically.

## Build Windows Installer (for another machine)

1. Install Inno Setup (one-time) so `iscc` is on PATH.
2. Build the setup package:

```bash
npm run build:installer
```

Installer output:

```text
release/installer/ComicboxTagStudio-Setup.exe
```

What the installer includes:
- Full standalone app runtime (`ComicboxTagStudio.exe` and dependencies)
- Start Menu shortcut
- Optional desktop shortcut
- Optional `unrar` install step via winget (recommended for CBR support)

Credential persistence note:
- Saved API credentials are stored per-user at `%LOCALAPPDATA%\\ComicboxTagStudio\\settings.json`.

## Project Structure

```text
backend/
  app.py
  comicbox_service.py
  models.py
  requirements.txt
src/
  api/
  pages/
  styles/
  types/
```

## Notes

- Preview uses Comicbox dry-run mode to avoid modifying files.
- Apply writes metadata using selected output format flags (`-w ...`).
- Online source credentials can be supplied via Comicbox config or environment variables (`COMICBOX_*`).
