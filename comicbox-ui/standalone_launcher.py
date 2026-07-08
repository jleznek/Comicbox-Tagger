from __future__ import annotations

import sys
import threading
import webbrowser
from pathlib import Path
import socket

import uvicorn


def _backend_dir() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(getattr(sys, '_MEIPASS')) / 'backend'
    return Path(__file__).resolve().parent / 'backend'


def _find_open_port(start: int = 8000, end: int = 8100) -> int:
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if sock.connect_ex(('127.0.0.1', port)) != 0:
                return port
    raise RuntimeError('No open localhost port available in range 8000-8100.')


def _open_browser(url: str) -> None:
    webbrowser.open(url, new=1)


def main() -> None:
    backend_dir = _backend_dir()
    sys.path.insert(0, str(backend_dir))

    from app import app  # noqa: WPS433

    port = _find_open_port()
    url = f'http://127.0.0.1:{port}'
    threading.Timer(1.2, _open_browser, args=(url,)).start()
    uvicorn.run(app, host='127.0.0.1', port=port)


if __name__ == '__main__':
    main()
