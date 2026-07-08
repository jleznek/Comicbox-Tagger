export type ComicFile = {
  path: string
  size_bytes: number
}

export type SetupStatus = {
  comicbox_executable: string
  metron_configured: boolean
  comicvine_configured: boolean
  any_online_source_configured: boolean
  unrar_available: boolean
  unrar_executable: string
  warnings: string[]
}

export type SavedSettings = {
  metron_user: string
  metron_pass: string
  comicvine_key: string
  last_root_path: string
}

export type BrowseFolderResponse = {
  path: string
}

export type CommandResult = {
  command: string[]
  exit_code: number
  stdout: string
  stderr: string
}

export type PreviewResponse = {
  metadata_preview: string
  command_result: CommandResult
}

export type ApplyResponse = {
  command_result: CommandResult
  fallback_used: boolean
}

export type MetadataResponse = {
  metadata: string
  command_result: CommandResult
}

export type YACLibraryComicMetadata = {
  file_path: string
  in_database: boolean
  has_metadata: boolean
  series_name: string | null
  issue_number: string | null
  title: string | null
  metadata_source: string
  error: string | null
}

export type YACLibraryValidationResponse = {
  database_valid: boolean
  total_comics: number
  with_metadata: number
  without_metadata: number
  results: YACLibraryComicMetadata[]
  error: string | null
}

export type CoverImageResponse = {
  cover_data_uri: string | null
  error: string | null
}

export type CbzInspectResponse = {
  found: boolean
  xml_content: string | null
  error: string | null
}
