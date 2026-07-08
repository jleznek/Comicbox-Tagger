from __future__ import annotations

from pydantic import BaseModel, Field


class ScanRequest(BaseModel):
    root_path: str
    recurse: bool = True


class PreviewRequest(BaseModel):
    file_path: str
    online_source: str = Field(default='metron')
    match_mode: str = Field(default='careful')
    metron_user: str = ''
    metron_pass: str = ''
    comicvine_key: str = ''


class ApplyRequest(BaseModel):
    file_path: str
    online_source: str = Field(default='metron')
    match_mode: str = Field(default='careful')
    write_formats: list[str] = Field(default_factory=lambda: ['cix'])
    metron_user: str = ''
    metron_pass: str = ''
    comicvine_key: str = ''


class MetadataRequest(BaseModel):
    file_path: str


class SettingsRequest(BaseModel):
    metron_user: str = ''
    metron_pass: str = ''
    comicvine_key: str = ''
    last_root_path: str = ''


class BrowseFolderRequest(BaseModel):
    initial_path: str = ''


class ComicFile(BaseModel):
    path: str
    size_bytes: int


class SetupStatus(BaseModel):
    comicbox_executable: str
    metron_configured: bool
    comicvine_configured: bool
    any_online_source_configured: bool
    unrar_available: bool
    unrar_executable: str = ''
    warnings: list[str]


class SavedSettings(BaseModel):
    metron_user: str
    metron_pass: str
    comicvine_key: str
    last_root_path: str


class BrowseFolderResponse(BaseModel):
    path: str


class CommandResult(BaseModel):
    command: list[str]
    exit_code: int
    stdout: str
    stderr: str


class PreviewResponse(BaseModel):
    metadata_preview: str
    command_result: CommandResult


class ApplyResponse(BaseModel):
    command_result: CommandResult
    fallback_used: bool = False


class MetadataResponse(BaseModel):
    metadata: str
    command_result: CommandResult


class YACLibraryValidationRequest(BaseModel):
    ydb_path: str
    file_paths: list[str]


class YACLibraryComicMetadata(BaseModel):
    file_path: str
    in_database: bool
    has_metadata: bool
    series_name: str | None = None
    issue_number: str | None = None
    title: str | None = None
    metadata_source: str = 'ComicInfo.xml'
    error: str | None = None


class YACLibraryValidationResponse(BaseModel):
    database_valid: bool
    total_comics: int
    with_metadata: int
    without_metadata: int
    results: list[YACLibraryComicMetadata]
    error: str | None = None


class CoverImageResponse(BaseModel):
    cover_data_uri: str | None = None
    error: str | None = None


class CbzInspectResponse(BaseModel):
    found: bool
    xml_content: str | None = None
    error: str | None = None
