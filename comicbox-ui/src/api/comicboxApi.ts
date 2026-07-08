import type {
  ApplyResponse,
  BrowseFolderResponse,
  CbzInspectResponse,
  ComicFile,
  CoverImageResponse,
  MetadataResponse,
  PreviewResponse,
  SavedSettings,
  SetupStatus,
  YACLibraryValidationResponse,
} from '../types/comicbox'

const API_BASE = '/api'

export type RuntimeCredentialOverrides = {
  metron_user?: string
  metron_pass?: string
  comicvine_key?: string
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

export async function scanLibrary(rootPath: string, recurse: boolean): Promise<ComicFile[]> {
  const response = await fetch(`${API_BASE}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root_path: rootPath, recurse }),
  })
  return parseJson<ComicFile[]>(response)
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const response = await fetch(`${API_BASE}/setup`)
  return parseJson<SetupStatus>(response)
}

export async function getSavedSettings(): Promise<SavedSettings> {
  const response = await fetch(`${API_BASE}/settings`)
  return parseJson<SavedSettings>(response)
}

export async function saveSettings(settings: SavedSettings): Promise<SavedSettings> {
  const response = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  return parseJson<SavedSettings>(response)
}

export async function browseFolder(initialPath: string): Promise<BrowseFolderResponse> {
  const response = await fetch(`${API_BASE}/browse-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initial_path: initialPath }),
  })
  return parseJson<BrowseFolderResponse>(response)
}

export async function previewTagging(
  filePath: string,
  onlineSource: string,
  matchMode: string,
  credentials: RuntimeCredentialOverrides = {},
): Promise<PreviewResponse> {
  const response = await fetch(`${API_BASE}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_path: filePath,
      online_source: onlineSource,
      match_mode: matchMode,
      metron_user: credentials.metron_user ?? '',
      metron_pass: credentials.metron_pass ?? '',
      comicvine_key: credentials.comicvine_key ?? '',
    }),
  })
  return parseJson<PreviewResponse>(response)
}

export async function applyTagging(
  filePath: string,
  onlineSource: string,
  matchMode: string,
  writeFormats: string[],
  credentials: RuntimeCredentialOverrides = {},
): Promise<ApplyResponse> {
  const response = await fetch(`${API_BASE}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_path: filePath,
      online_source: onlineSource,
      match_mode: matchMode,
      write_formats: writeFormats,
      metron_user: credentials.metron_user ?? '',
      metron_pass: credentials.metron_pass ?? '',
      comicvine_key: credentials.comicvine_key ?? '',
    }),
  })
  return parseJson<ApplyResponse>(response)
}

export async function readMetadata(filePath: string): Promise<MetadataResponse> {
  const response = await fetch(`${API_BASE}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: filePath }),
  })
  return parseJson<MetadataResponse>(response)
}

export async function validateYACLibMetadata(
  ydbPath: string,
  filePaths: string[],
): Promise<YACLibraryValidationResponse> {
  const response = await fetch(`${API_BASE}/validate-yaclib`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ydb_path: ydbPath, file_paths: filePaths }),
  })
  return parseJson<YACLibraryValidationResponse>(response)
}

export async function getCoverImage(filePath: string): Promise<CoverImageResponse> {
  const response = await fetch(`${API_BASE}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: filePath }),
  })
  return parseJson<CoverImageResponse>(response)
}

export async function inspectCbzMetadata(filePath: string): Promise<CbzInspectResponse> {
  const response = await fetch(`${API_BASE}/inspect-cbz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: filePath }),
  })
  return parseJson<CbzInspectResponse>(response)
}
