from __future__ import annotations

import base64
import io
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import traceback
import zipfile


SUPPORTED_EXTENSIONS = {'.cbz', '.cbr', '.cbt', '.cb7', '.pdf'}


def _find_powershell_executable() -> str | None:
    candidates = [
        'powershell',
        'pwsh',
        r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',
        r'C:\Program Files\PowerShell\7\pwsh.exe',
    ]

    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
        if Path(candidate).exists():
            return candidate

    return None


def _browse_with_powershell(starting_path: str) -> str:
    powershell_exe = _find_powershell_executable()
    if not powershell_exe:
        raise RuntimeError('PowerShell executable was not found on this machine.')

    escaped_starting_path = starting_path.replace("'", "''")
    script = f'''
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.InteropServices

# Import Windows API functions to bring dialog to foreground
$script:PInvoke = @{{
    SetForegroundWindow = @{{
        Signature = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'
        Type = Add-Type -MemberDefinition $Signature -Name 'WinApiSetForegroundWindow' -Namespace 'WinApi' -Using System.Text -PassThru
    }}
    SetWindowPos = @{{
        Signature = @'
[DllImport("user32.dll", SetLastError = true)]
public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
'@
        Type = Add-Type -MemberDefinition $Signature -Name 'WinApiSetWindowPos' -Namespace 'WinApi' -PassThru
    }}
}}

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select comic library folder"
$dialog.ShowNewFolderButton = $true
$start = '{escaped_starting_path}'
if (Test-Path -LiteralPath $start) {{
    $dialog.SelectedPath = $start
}}

# Create an invisible form to own the dialog and ensure it appears on top
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.WindowState = 'Minimized'

# Show the dialog with the form as owner
$result = $dialog.ShowDialog($form)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
    Write-Output $dialog.SelectedPath
}}
'''

    command = [
        powershell_exe,
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-STA',
        '-Command',
        script,
    ]

    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
        check=False,
    )

    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or 'PowerShell folder dialog failed.')

    return completed.stdout.strip()


def _find_unrar_executable() -> str | None:
    candidates = ['unrar', 'UnRAR', 'unrar.exe', 'UnRAR.exe', 'rar', 'rar.exe', 'Rar.exe']
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved

    program_files = [
        os.environ.get('ProgramFiles', ''),
        os.environ.get('ProgramW6432', ''),
        os.environ.get('ProgramFiles(x86)', ''),
    ]
    known_locations = [
        Path(base) / 'WinRAR' / 'UnRAR.exe'
        for base in program_files
        if base
    ]
    known_locations += [
        Path(base) / 'WinRAR' / 'Rar.exe'
        for base in program_files
        if base
    ]
    known_locations += [
        Path(base) / 'Unrar' / 'unrar.exe'
        for base in program_files
        if base
    ]

    for location in known_locations:
        if location.exists():
            return str(location)

    return None


def _settings_file() -> Path:
    app_data = Path(os.environ.get('LOCALAPPDATA', str(Path.home())))
    settings_dir = app_data / 'ComicboxTagStudio'
    settings_dir.mkdir(parents=True, exist_ok=True)
    return settings_dir / 'settings.json'


def _load_settings() -> dict[str, str]:
    settings_file = _settings_file()
    if not settings_file.exists():
        return {}

    try:
        import json

        raw = json.loads(settings_file.read_text(encoding='utf-8'))
        if isinstance(raw, dict):
            return {str(k): str(v) for k, v in raw.items()}
    except Exception:
        return {}

    return {}


def _write_settings(payload: dict[str, str]) -> None:
    import json

    _settings_file().write_text(json.dumps(payload, indent=2), encoding='utf-8')


def save_settings(metron_user: str, metron_pass: str, comicvine_key: str, last_root_path: str = '') -> None:
    import json

    payload = {
        'metron_user': metron_user,
        'metron_pass': metron_pass,
        'comicvine_key': comicvine_key,
        'last_root_path': last_root_path,
    }
    _write_settings(payload)


def set_last_root_path(last_root_path: str) -> None:
    loaded = _load_settings()
    payload = {
        'metron_user': loaded.get('metron_user', ''),
        'metron_pass': loaded.get('metron_pass', ''),
        'comicvine_key': loaded.get('comicvine_key', ''),
        'last_root_path': last_root_path,
    }
    _write_settings(payload)


def get_saved_settings() -> dict[str, str]:
    loaded = _load_settings()
    return {
        'metron_user': loaded.get('metron_user', ''),
        'metron_pass': loaded.get('metron_pass', ''),
        'comicvine_key': loaded.get('comicvine_key', ''),
        'last_root_path': loaded.get('last_root_path', ''),
    }


def browse_for_folder(initial_path: str) -> str:
    starting_path = initial_path.strip() if initial_path else str(Path.home())

    try:
        selected = _browse_with_powershell(starting_path)
        return selected or ''
    except Exception as exc:
        raise RuntimeError(f'Folder picker failed: {exc}') from exc


def _build_comicbox_env(
    metron_user: str = '',
    metron_pass: str = '',
    comicvine_key: str = '',
) -> dict[str, str]:
    env = os.environ.copy()
    # Force UTF-8 and disable rich's legacy Windows console renderer, which
    # crashes with UnicodeEncodeError when stdout is a pipe on Windows.
    env['PYTHONUTF8'] = '1'
    env['PYTHONIOENCODING'] = 'utf-8'
    env['NO_COLOR'] = '1'
    env['TERM'] = 'dumb'
    env.pop('FORCE_COLOR', None)

    saved = _load_settings()
    runtime_metron_user = metron_user.strip()
    runtime_metron_pass = metron_pass.strip()
    runtime_comicvine_key = comicvine_key.strip()
    def _set_if_missing_or_blank(name: str, value: str) -> None:
        current = env.get(name)
        if current is None or not current.strip():
            env[name] = value

    if runtime_metron_user and runtime_metron_pass:
        env['COMICBOX_METRON_USER'] = runtime_metron_user
        env['COMICBOX_METRON_PASS'] = runtime_metron_pass
    elif saved.get('metron_user') and saved.get('metron_pass'):
        _set_if_missing_or_blank('COMICBOX_METRON_USER', saved['metron_user'])
        _set_if_missing_or_blank('COMICBOX_METRON_PASS', saved['metron_pass'])

    if runtime_comicvine_key:
        env['COMICBOX_COMICVINE_KEY'] = runtime_comicvine_key
    elif saved.get('comicvine_key'):
        _set_if_missing_or_blank('COMICBOX_COMICVINE_KEY', saved['comicvine_key'])

    unrar_path = _find_unrar_executable()
    if unrar_path:
        unrar_dir = str(Path(unrar_path).parent)
        existing_path = env.get('PATH', '')
        path_parts = existing_path.split(os.pathsep) if existing_path else []
        path_parts_lower = {part.lower() for part in path_parts}
        if unrar_dir.lower() not in path_parts_lower:
            env['PATH'] = f'{unrar_dir}{os.pathsep}{existing_path}' if existing_path else unrar_dir

    return env


def get_comicbox_executable() -> str:
    custom_bin = os.environ.get('COMICBOX_BIN')
    if custom_bin:
        return custom_bin

    # Prefer the project-local virtual environment to avoid global package conflicts.
    project_root = Path(__file__).resolve().parents[1]
    local_bin = project_root / '.venv' / 'Scripts' / 'comicbox.exe'
    if local_bin.exists():
        return str(local_bin)

    return 'comicbox'


def _resolve_comicbox_command() -> list[str]:
    configured = get_comicbox_executable().strip()
    if configured:
        if Path(configured).exists() or shutil.which(configured):
            return [configured]

    if getattr(sys, 'frozen', False):
        # In PyInstaller builds, sys.executable points to this launcher EXE.
        # Running it with "-m comicbox.cli" relaunches the app instead of invoking comicbox.
        return ['comicbox']

    python_candidates = [
        Path(sys.executable),
        Path(sys.executable).resolve().parent / 'python.exe',
        Path(sys.executable).resolve().parent / 'python',
    ]
    for candidate in python_candidates:
        if candidate.exists():
            return [str(candidate), '-m', 'comicbox.cli']

    # Last resort for environments where python is only on PATH.
    return ['python', '-m', 'comicbox.cli']


def get_setup_status() -> dict[str, object]:
    settings = _load_settings()
    metron_user = os.environ.get('COMICBOX_METRON_USER') or settings.get('metron_user', '')
    metron_pass = os.environ.get('COMICBOX_METRON_PASS') or settings.get('metron_pass', '')
    comicvine_key = os.environ.get('COMICBOX_COMICVINE_KEY') or settings.get('comicvine_key', '')

    metron_configured = bool(
        metron_user and metron_pass
    )
    comicvine_configured = bool(comicvine_key)
    unrar_executable = _find_unrar_executable() or ''
    unrar_available = bool(unrar_executable)

    warnings: list[str] = []
    if not (metron_configured or comicvine_configured):
        warnings.append('No online metadata source is configured. Set Metron or ComicVine credentials before using online tagging.')
    if not unrar_available:
        warnings.append('No RAR extractor was detected (unrar/rar). CBR files may not be readable until UnRAR/WinRAR is installed.')

    return {
        'comicbox_executable': ' '.join(_resolve_comicbox_command()),
        'metron_configured': metron_configured,
        'comicvine_configured': comicvine_configured,
        'any_online_source_configured': metron_configured or comicvine_configured,
        'unrar_available': unrar_available,
        'unrar_executable': unrar_executable,
        'warnings': warnings,
    }


def discover_comics(root_path: str, recurse: bool) -> list[dict[str, int | str]]:
    base = Path(root_path).expanduser().resolve()
    if not base.exists() or not base.is_dir():
        raise ValueError(f'Path not found or not a directory: {base}')

    pattern = '**/*' if recurse else '*'
    comics: list[dict[str, int | str]] = []
    for candidate in sorted(base.glob(pattern)):
        if not candidate.is_file():
            continue
        if candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        comics.append({'path': str(candidate), 'size_bytes': candidate.stat().st_size})

    return comics


def _extract_cli_args(command: list[str]) -> list[str]:
    if not command:
        return []

    if len(command) >= 3 and command[1] == '-m' and command[2].startswith('comicbox'):
        return command[3:]

    stem = Path(command[0]).stem.lower()
    if 'comicbox' in stem:
        return command[1:]

    if stem in {'python', 'python3', 'py'} and '-m' in command:
        module_index = command.index('-m')
        if module_index + 1 < len(command) and command[module_index + 1].startswith('comicbox'):
            return command[module_index + 2:]

    return command[1:]


def _run_comicbox_in_process(command: list[str], env: dict[str, str] | None = None) -> dict[str, int | str | list[str]]:
    from contextlib import redirect_stderr, redirect_stdout
    from io import StringIO
    from unittest.mock import patch

    import comicbox.cli as comicbox_cli

    cli_args = _extract_cli_args(command)
    stdout_buffer = StringIO()
    stderr_buffer = StringIO()
    exit_code = 0

    effective_env = env or os.environ

    with patch.dict(os.environ, effective_env, clear=False):
        with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
            try:
                comicbox_cli.main(['comicbox', *cli_args])
            except SystemExit as exc:
                exit_code = int(exc.code) if isinstance(exc.code, int) else (0 if exc.code is None else 1)
            except Exception:
                exit_code = 1
                traceback.print_exc(file=stderr_buffer)

    return {
        'command': command,
        'exit_code': exit_code,
        'stdout': stdout_buffer.getvalue(),
        'stderr': stderr_buffer.getvalue(),
    }


def run_comicbox(
    command: list[str],
    metron_user: str = '',
    metron_pass: str = '',
    comicvine_key: str = '',
) -> dict[str, int | str | list[str]]:
    env = _build_comicbox_env(
        metron_user=metron_user,
        metron_pass=metron_pass,
        comicvine_key=comicvine_key,
    )
    try:
        # CREATE_NO_WINDOW (0x08000000) prevents the subprocess from inheriting
        # the Windows console, which stops rich from using LegacyWindowsTerm and
        # causing UnicodeEncodeError with cp1252 on stdout pipes.
        creation_flags = 0x08000000 if sys.platform == 'win32' else 0
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            check=False,
            env=env,
            creationflags=creation_flags,
        )
        return {
            'command': command,
            'exit_code': result.returncode,
            'stdout': result.stdout,
            'stderr': result.stderr,
        }
    except FileNotFoundError:
        # Packaged installs may not have a comicbox executable on PATH.
        # Fallback to running comicbox in-process from bundled site-packages.
        return _run_comicbox_in_process(command, env)


def preview_online_tagging(
    file_path: str,
    online_source: str,
    match_mode: str,
    metron_user: str = '',
    metron_pass: str = '',
    comicvine_key: str = '',
) -> dict[str, object]:
    cmd = [
        *_resolve_comicbox_command(),
        '--online',
        online_source,
        '--match',
        match_mode,
        '--prompts',
        'never',
        '-p',
        '--dry-run',
        file_path,
    ]
    result = run_comicbox(
        cmd,
        metron_user=metron_user,
        metron_pass=metron_pass,
        comicvine_key=comicvine_key,
    )
    preview = result['stdout'] if isinstance(result['stdout'], str) else ''
    return {'metadata_preview': preview, 'command_result': result}


def apply_online_tagging(
    file_path: str,
    online_source: str,
    match_mode: str,
    write_formats: list[str],
    metron_user: str = '',
    metron_pass: str = '',
    comicvine_key: str = '',
) -> dict[str, object]:
    # Ensure at least one write format is specified; default to ComicInfo.xml if none provided
    effective_formats = write_formats if write_formats and len(write_formats) > 0 else ['cix']

    cmd = [
        *_resolve_comicbox_command(),
        '--online',
        online_source,
        '--match',
        match_mode,
        '--prompts',
        'never',
    ]

    for format_name in effective_formats:
        cmd.extend(['-w', format_name])

    cmd.append(file_path)
    result = run_comicbox(
        cmd,
        metron_user=metron_user,
        metron_pass=metron_pass,
        comicvine_key=comicvine_key,
    )

    stderr = str(result.get('stderr', ''))
    permission_denied = result.get('exit_code') != 0 and 'PermissionError' in stderr

    if not permission_denied:
        return {'command_result': result, 'fallback_used': False}

    source_path = Path(file_path)
    with tempfile.TemporaryDirectory(prefix='comicbox-ui-') as temp_dir:
        temp_path = Path(temp_dir) / source_path.name
        shutil.copy2(source_path, temp_path)

        fallback_cmd = cmd[:-1] + [str(temp_path)]
        fallback_result = run_comicbox(
            fallback_cmd,
            metron_user=metron_user,
            metron_pass=metron_pass,
            comicvine_key=comicvine_key,
        )

        if fallback_result.get('exit_code') == 0:
            try:
                shutil.copy2(temp_path, source_path)
            except PermissionError as exc:
                fallback_result['exit_code'] = 1
                fallback_result['stderr'] = (
                    str(fallback_result.get('stderr', ''))
                    + f'\nCopy-back failed after successful local write: {exc}'
                )

        merged_stdout = str(fallback_result.get('stdout', ''))
        merged_stderr = str(fallback_result.get('stderr', ''))
        if fallback_result.get('exit_code') == 0:
            merged_stdout = (
                'Permission fallback applied: wrote metadata to a local temp copy and copied it back.\n\n'
                + merged_stdout
            )

        fallback_result['stdout'] = merged_stdout
        fallback_result['stderr'] = merged_stderr
        fallback_result['command'] = fallback_cmd
        return {'command_result': fallback_result, 'fallback_used': True}


def read_metadata(file_path: str) -> dict[str, object]:
    # Prefer ComicInfo first because YACReader/YACLibrary commonly stores tags there.
    primary_cmd = [*_resolve_comicbox_command(), '--read', 'cix', '-p', file_path]
    primary_result = run_comicbox(primary_cmd)
    primary_metadata = str(primary_result.get('stdout', '')).strip()

    if primary_metadata:
        return {'metadata': primary_metadata, 'command_result': primary_result}

    # Fall back to reading all formats so we still surface metadata from other tag sources.
    fallback_cmd = [*_resolve_comicbox_command(), '-p', file_path]
    fallback_result = run_comicbox(fallback_cmd)
    fallback_metadata = str(fallback_result.get('stdout', '')).strip()

    if fallback_metadata:
        return {'metadata': fallback_metadata, 'command_result': fallback_result}

    if int(fallback_result.get('exit_code', 0)) != 0:
        stderr = str(fallback_result.get('stderr', '')).strip()
        if stderr:
            return {'metadata': f'Failed to read metadata:\n{stderr}', 'command_result': fallback_result}

    return {
        'metadata': 'No embedded metadata found. If this file should contain YAC/ComicInfo tags, verify it has a ComicInfo.xml entry.',
        'command_result': fallback_result,
    }


def validate_yaclib_metadata(ydb_path: str, file_paths: list[str]) -> dict[str, object]:
    """
    Query YACLibrary's SQLite database to validate that metadata was successfully
    imported for the given comic files.
    
    Args:
        ydb_path: Full path to YACLibrary's .ydb SQLite database file
        file_paths: List of comic file paths to check in the database
    
    Returns:
        Dictionary with validation results including metadata status for each file
    """
    try:
        ydb_file = Path(ydb_path)
        if not ydb_file.exists():
            return {
                'database_valid': False,
                'total_comics': len(file_paths),
                'with_metadata': 0,
                'without_metadata': len(file_paths),
                'results': [],
                'error': f'YACLibrary database not found: {ydb_path}',
            }

        conn = sqlite3.connect(str(ydb_file))
        cursor = conn.cursor()

        # Verify the expected tables exist
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = {row[0] for row in cursor.fetchall()}
        except Exception as e:
            return {
                'database_valid': False,
                'total_comics': len(file_paths),
                'with_metadata': 0,
                'without_metadata': len(file_paths),
                'results': [],
                'error': f'Failed to query database tables: {e}',
            }

        if 'comic' not in tables or 'comic_info' not in tables:
            return {
                'database_valid': False,
                'total_comics': len(file_paths),
                'with_metadata': 0,
                'without_metadata': len(file_paths),
                'results': [],
                'error': f'Unexpected database format. Found tables: {sorted(tables)}. Expected YACReaderLibrary database with comic and comic_info tables.',
            }

        results = []
        with_metadata = 0

        for file_path in file_paths:
            try:
                file_name = Path(file_path).name
                in_database = False
                has_metadata = False
                series_name = None
                issue_number = None
                title = None

                # YACReaderLibrary schema:
                #   comic(id, parentId, comicInfoId, fileName, path)
                #   comic_info(id, series, number, title, writer, ...)
                # Join: comic.comicInfoId = comic_info.id
                # path in DB is relative (e.g. /V/V 001 (1985).cbz)
                try:
                    cursor.execute(
                        '''
                        SELECT ci.series, ci.number, ci.title
                        FROM comic c
                        JOIN comic_info ci ON c.comicInfoId = ci.id
                        WHERE c.fileName = ?
                        ''',
                        (file_name,),
                    )
                    row = cursor.fetchone()
                    if row is not None:
                        in_database = True
                        if row[0]:  # series is non-null/non-empty → metadata was imported
                            has_metadata = True
                            series_name = row[0]
                            issue_number = str(row[1]) if row[1] is not None else None
                            title = row[2]
                except Exception:
                    pass

                results.append({
                    'file_path': file_path,
                    'in_database': in_database,
                    'has_metadata': has_metadata,
                    'series_name': series_name,
                    'issue_number': issue_number,
                    'title': title,
                    'metadata_source': 'YACLibrary Database',
                    'error': None,
                })

                if has_metadata:
                    with_metadata += 1

            except Exception as e:
                results.append({
                    'file_path': file_path,
                    'in_database': False,
                    'has_metadata': False,
                    'series_name': None,
                    'issue_number': None,
                    'title': None,
                    'metadata_source': 'YACLibrary Database',
                    'error': str(e),
                })

        conn.close()

        return {
            'database_valid': True,
            'total_comics': len(file_paths),
            'with_metadata': with_metadata,
            'without_metadata': len(file_paths) - with_metadata,
            'results': results,
            'error': None,
        }

    except sqlite3.DatabaseError as e:
        return {
            'database_valid': False,
            'total_comics': len(file_paths),
            'with_metadata': 0,
            'without_metadata': len(file_paths),
            'results': [],
            'error': f'Invalid YACLibrary database: {e}',
        }
    except Exception as e:
        return {
            'database_valid': False,
            'total_comics': len(file_paths),
            'with_metadata': 0,
            'without_metadata': len(file_paths),
            'results': [],
            'error': f'Error validating YACLibrary database: {e}',
        }


def inspect_cbz_metadata(file_path: str) -> dict[str, object]:
    """
    Directly inspect a CBZ file for an embedded ComicInfo.xml.
    Returns the raw XML content if found, so users can verify comicbox wrote the metadata.
    """
    try:
        file_obj = Path(file_path)
        if not file_obj.exists():
            return {'found': False, 'xml_content': None, 'error': f'File not found: {file_path}'}

        if file_obj.suffix.lower() != '.cbz':
            return {'found': False, 'xml_content': None, 'error': 'Only CBZ files are supported for direct inspection'}

        with zipfile.ZipFile(file_path, 'r') as zf:
            names = zf.namelist()
            # Look for ComicInfo.xml (case-insensitive)
            xml_entry = next(
                (n for n in names if n.lower() == 'comicinfo.xml' or n.lower().endswith('/comicinfo.xml')),
                None,
            )
            if not xml_entry:
                return {
                    'found': False,
                    'xml_content': None,
                    'error': 'No ComicInfo.xml found inside this CBZ. Metadata has not been written to this file yet.',
                }
            xml_bytes = zf.read(xml_entry)
            xml_text = xml_bytes.decode('utf-8', errors='replace')
            return {'found': True, 'xml_content': xml_text, 'error': None}
    except Exception as e:
        return {'found': False, 'xml_content': None, 'error': str(e)}


def extract_cover_image(file_path: str) -> dict[str, object]:
    """
    Extract the cover image from a comic book archive and return as base64 data URI.
    
    Supports:
    - CBZ (ZIP archives) - uses zipfile
    - CBR (RAR archives) - requires unrar tool
    
    Returns:
        Dictionary with 'cover_data_uri' (base64 data URI) or 'error' if extraction fails
    """
    try:
        file_obj = Path(file_path)
        if not file_obj.exists():
            return {'cover_data_uri': None, 'error': f'File not found: {file_path}'}

        suffix = file_obj.suffix.lower()

        # Handle CBZ files (ZIP archives)
        if suffix == '.cbz':
            try:
                with zipfile.ZipFile(file_path, 'r') as archive:
                    # List all files sorted by name
                    file_list = sorted(archive.namelist())

                    # Find first image file (skip directories and hidden files)
                    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
                    cover_file = None

                    # Prefer common cover names first
                    for filename in file_list:
                        name_lower = filename.lower()
                        # Skip directories and common metadata files
                        if name_lower.endswith('/') or name_lower.startswith('__'):
                            continue
                        # Look for common cover names
                        if 'cover' in name_lower and any(name_lower.endswith(ext) for ext in image_extensions):
                            cover_file = filename
                            break

                    # If no explicit cover, take first image
                    if not cover_file:
                        for filename in file_list:
                            name_lower = filename.lower()
                            if name_lower.endswith('/') or name_lower.startswith('__'):
                                continue
                            if any(name_lower.endswith(ext) for ext in image_extensions):
                                cover_file = filename
                                break

                    if not cover_file:
                        return {'cover_data_uri': None, 'error': 'No image files found in archive'}

                    # Extract image data
                    image_data = archive.read(cover_file)
                    
                    # Resize image if necessary (limit to 1024x1024 to avoid large data URIs)
                    try:
                        from PIL import Image
                        img = Image.open(io.BytesIO(image_data))
                        
                        # Resize if larger than 1024px on any side, maintaining aspect ratio
                        max_size = 1024
                        if img.width > max_size or img.height > max_size:
                            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                        
                        # Convert to PNG for consistency
                        png_buffer = io.BytesIO()
                        img.save(png_buffer, format='PNG')
                        image_data = png_buffer.getvalue()
                        media_type = 'image/png'
                    except ImportError:
                        # Pillow not available, use raw image
                        _, ext = Path(cover_file).name.rsplit('.', 1) if '.' in Path(cover_file).name else ('', '')
                        media_type = f'image/{ext.lower()}' if ext else 'image/jpeg'
                    except Exception as e:
                        # If image processing fails, try to use original
                        _, ext = Path(cover_file).name.rsplit('.', 1) if '.' in Path(cover_file).name else ('', '')
                        media_type = f'image/{ext.lower()}' if ext else 'image/jpeg'

                    # Encode as base64 data URI
                    b64_encoded = base64.b64encode(image_data).decode('ascii')
                    data_uri = f'data:{media_type};base64,{b64_encoded}'

                    return {'cover_data_uri': data_uri, 'error': None}

            except zipfile.BadZipFile:
                return {'cover_data_uri': None, 'error': 'Invalid ZIP archive (CBZ file may be corrupted)'}
            except Exception as e:
                return {'cover_data_uri': None, 'error': f'Failed to extract from CBZ: {e}'}

        # Handle CBR files (RAR archives) - requires unrar tool
        elif suffix == '.cbr':
            try:
                unrar_path = _find_unrar_executable()
                if not unrar_path:
                    return {
                        'cover_data_uri': None,
                        'error': 'CBR support requires UnRAR tool. Install WinRAR or UnRAR.',
                    }

                # Extract to temporary directory
                with tempfile.TemporaryDirectory(prefix='comicbox-cover-') as temp_dir:
                    try:
                        subprocess.run(
                            [unrar_path, 'x', file_path, temp_dir],
                            capture_output=True,
                            check=True,
                            timeout=10,
                        )
                    except subprocess.CalledProcessError as e:
                        return {'cover_data_uri': None, 'error': f'UnRAR extraction failed: {e.stderr}'}

                    # Find first image file
                    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
                    temp_path = Path(temp_dir)
                    image_files = sorted(
                        [f for f in temp_path.rglob('*') if f.is_file() and f.suffix.lower() in image_extensions]
                    )

                    if not image_files:
                        return {'cover_data_uri': None, 'error': 'No image files found in RAR archive'}

                    cover_path = image_files[0]
                    image_data = cover_path.read_bytes()

                    # Resize if necessary
                    try:
                        from PIL import Image
                        img = Image.open(io.BytesIO(image_data))
                        max_size = 1024
                        if img.width > max_size or img.height > max_size:
                            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

                        png_buffer = io.BytesIO()
                        img.save(png_buffer, format='PNG')
                        image_data = png_buffer.getvalue()
                        media_type = 'image/png'
                    except ImportError:
                        media_type = f'image/{cover_path.suffix.lower().lstrip(".")}'
                    except Exception:
                        media_type = f'image/{cover_path.suffix.lower().lstrip(".")}'

                    b64_encoded = base64.b64encode(image_data).decode('ascii')
                    data_uri = f'data:{media_type};base64,{b64_encoded}'

                    return {'cover_data_uri': data_uri, 'error': None}

            except subprocess.TimeoutExpired:
                return {'cover_data_uri': None, 'error': 'RAR extraction timed out'}
            except Exception as e:
                return {'cover_data_uri': None, 'error': f'Failed to extract from CBR: {e}'}

        else:
            return {'cover_data_uri': None, 'error': f'Unsupported format: {suffix}'}

    except Exception as e:
        return {'cover_data_uri': None, 'error': f'Unexpected error extracting cover: {e}'}
