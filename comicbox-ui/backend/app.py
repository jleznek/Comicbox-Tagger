from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from comicbox_service import (
    apply_online_tagging,
    browse_for_folder,
    discover_comics,
    extract_cover_image,
    get_saved_settings,
    get_setup_status,
    inspect_cbz_metadata,
    preview_online_tagging,
    read_metadata,
    save_settings,
    set_last_root_path,
    validate_yaclib_metadata,
)
from models import (
    ApplyRequest,
    ApplyResponse,
    BrowseFolderRequest,
    BrowseFolderResponse,
    CbzInspectResponse,
    ComicFile,
    CoverImageResponse,
    MetadataRequest,
    MetadataResponse,
    PreviewRequest,
    PreviewResponse,
    SavedSettings,
    ScanRequest,
    SettingsRequest,
    SetupStatus,
    YACLibraryValidationRequest,
    YACLibraryValidationResponse,
)


app = FastAPI(title='Comicbox UI Backend', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/api/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.get('/api/setup', response_model=SetupStatus)
def setup_status() -> SetupStatus:
    return SetupStatus(**get_setup_status())


@app.get('/api/settings', response_model=SavedSettings)
def get_settings() -> SavedSettings:
    return SavedSettings(**get_saved_settings())


@app.post('/api/settings', response_model=SavedSettings)
def set_settings(request: SettingsRequest) -> SavedSettings:
    save_settings(
        metron_user=request.metron_user,
        metron_pass=request.metron_pass,
        comicvine_key=request.comicvine_key,
        last_root_path=request.last_root_path,
    )
    return SavedSettings(**get_saved_settings())


@app.post('/api/browse-folder', response_model=BrowseFolderResponse)
def browse_folder(request: BrowseFolderRequest) -> BrowseFolderResponse:
    selected = browse_for_folder(request.initial_path)
    return BrowseFolderResponse(path=selected)


@app.post('/api/scan', response_model=list[ComicFile])
def scan_library(request: ScanRequest) -> list[ComicFile]:
    try:
        discovered = discover_comics(request.root_path, request.recurse)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    set_last_root_path(request.root_path)
    return [ComicFile(**comic) for comic in discovered]


@app.post('/api/preview', response_model=PreviewResponse)
def preview_file(request: PreviewRequest) -> PreviewResponse:
    result = preview_online_tagging(
        file_path=request.file_path,
        online_source=request.online_source,
        match_mode=request.match_mode,
        metron_user=request.metron_user,
        metron_pass=request.metron_pass,
        comicvine_key=request.comicvine_key,
    )
    return PreviewResponse(**result)


@app.post('/api/apply', response_model=ApplyResponse)
def apply_tags(request: ApplyRequest) -> ApplyResponse:
    result = apply_online_tagging(
        file_path=request.file_path,
        online_source=request.online_source,
        match_mode=request.match_mode,
        write_formats=request.write_formats,
        metron_user=request.metron_user,
        metron_pass=request.metron_pass,
        comicvine_key=request.comicvine_key,
    )
    return ApplyResponse(**result)


@app.post('/api/metadata', response_model=MetadataResponse)
def metadata_view(request: MetadataRequest) -> MetadataResponse:
    result = read_metadata(request.file_path)
    return MetadataResponse(**result)


@app.post('/api/validate-yaclib', response_model=YACLibraryValidationResponse)
def validate_yaclib(request: YACLibraryValidationRequest) -> YACLibraryValidationResponse:
    result = validate_yaclib_metadata(request.ydb_path, request.file_paths)
    return YACLibraryValidationResponse(**result)


@app.post('/api/cover', response_model=CoverImageResponse)
def get_cover(request: MetadataRequest) -> CoverImageResponse:
    result = extract_cover_image(request.file_path)
    return CoverImageResponse(**result)


@app.post('/api/inspect-cbz', response_model=CbzInspectResponse)
def inspect_cbz(request: MetadataRequest) -> CbzInspectResponse:
    result = inspect_cbz_metadata(request.file_path)
    return CbzInspectResponse(**result)


def _dist_dir() -> Path:
    if getattr(sys, 'frozen', False):
        base_dir = Path(getattr(sys, '_MEIPASS'))
    else:
        base_dir = Path(__file__).resolve().parents[1]
    return base_dir / 'dist'


dist_dir = _dist_dir()
if dist_dir.exists():
    app.mount('/', StaticFiles(directory=dist_dir, html=True), name='ui')
