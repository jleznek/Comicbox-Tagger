import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  applyTagging,
  browseFolder,
  getCoverImage,
  getSavedSettings,
  getSetupStatus,
  inspectCbzMetadata,
  previewTagging,
  readMetadata,
  saveSettings,
  scanLibrary,
  validateYACLibMetadata,
} from '../api/comicboxApi'
import type { CbzInspectResponse, ComicFile, SavedSettings, SetupStatus, YACLibraryValidationResponse } from '../types/comicbox'

const WRITE_FORMAT_OPTIONS = [
  { label: 'ComicInfo.xml', value: 'cix' },
  { label: 'MetronInfo.xml', value: 'metron' },
  { label: 'ComicBookInfo', value: 'cbi' },
  { label: 'CoMet', value: 'comet' },
]

type BatchStatus = 'pending' | 'success' | 'failed'

type BatchResult = {
  path: string
  status: BatchStatus
  message: string
}

const UI_STATE_KEY = 'comicbox-ui-state-v1'

function sanitizeTerminalText(raw: string): string {
  if (!raw) {
    return ''
  }

  // Strip ANSI CSI/OSC escape sequences so previews render as readable plain text.
  const withoutAnsi = raw
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B\][^\u0007]*(\u0007|\u001B\\)/g, '')

  return withoutAnsi.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function HomePage() {
  const [rootPath, setRootPath] = useState('')
  const [recurse, setRecurse] = useState(true)
  const [onlineSource, setOnlineSource] = useState('metron')
  const [matchMode, setMatchMode] = useState('careful')
  const [writeFormats, setWriteFormats] = useState<string[]>(['cix'])
  const [scanResults, setScanResults] = useState<ComicFile[]>([])
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [previewText, setPreviewText] = useState('')
  const [commandLog, setCommandLog] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [batchResults, setBatchResults] = useState<BatchResult[]>([])
  const [batchProgressPercent, setBatchProgressPercent] = useState(0)
  const [batchCurrentFile, setBatchCurrentFile] = useState('')
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null)
  const [setupCheckError, setSetupCheckError] = useState('')
  const [copiedCommandKey, setCopiedCommandKey] = useState('')
  const [savedSettings, setSavedSettings] = useState<SavedSettings>({
    metron_user: '',
    metron_pass: '',
    comicvine_key: '',
    last_root_path: '',
  })
  const [settingsSaveMessage, setSettingsSaveMessage] = useState('')
  const [applyInfoMessage, setApplyInfoMessage] = useState('')
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false)
  const [yacLibPath, setYacLibPath] = useState('')
  const [yacLibValidation, setYacLibValidation] = useState<YACLibraryValidationResponse | null>(null)
  const [yacLibValidating, setYacLibValidating] = useState(false)
  const [coverDataUri, setCoverDataUri] = useState<string | null>(null)
  const [loadingCover, setLoadingCover] = useState(false)
  const [cbzInspect, setCbzInspect] = useState<CbzInspectResponse | null>(null)
  const [cbzInspecting, setCbzInspecting] = useState(false)

  const selectedFile = selectedPaths[0] ?? ''

  function handleMetronAuthFailure(outputText: string) {
    const hasAuthFailure = outputText.includes('Invalid username/password.')
      || outputText.includes('401 Client Error')

    if (!hasAuthFailure) {
      return
    }

    setApplyInfoMessage('Metron authentication failed (401 Invalid username/password). Switched online source to ComicVine.')
    setOnlineSource('comicvine')
  }

  const selectedCountLabel = useMemo(
    () => `${scanResults.length} comic file${scanResults.length === 1 ? '' : 's'} found`,
    [scanResults.length],
  )

  const selectedFilesLabel = useMemo(
    () => `${selectedPaths.length} selected`,
    [selectedPaths.length],
  )

  async function loadSetupStatus() {
    try {
      const result = await getSetupStatus()
      setSetupStatus(result)
      setOnlineSource((current) => {
        if (current === 'metron' && !result.metron_configured && result.comicvine_configured) {
          return 'comicvine'
        }
        if (current === 'comicvine' && !result.comicvine_configured && result.metron_configured) {
          return 'metron'
        }
        return current
      })
      setSetupCheckError('')
    } catch {
      setSetupStatus(null)
      setSetupCheckError('Could not load setup diagnostics. Make sure the backend API is running.')
    }
  }

  async function resolveOnlineSourceForRun(): Promise<string | null> {
    const status = await getSetupStatus()
    setSetupStatus(status)

    if (onlineSource === 'metron') {
      if (status.metron_configured) {
        return 'metron'
      }
      if (status.comicvine_configured) {
        setApplyInfoMessage('Metron is not configured; using ComicVine for this run.')
        return 'comicvine'
      }
      setErrorMessage('No online source is configured. Add Metron credentials or a ComicVine API key.')
      return null
    }

    if (onlineSource === 'comicvine') {
      if (status.comicvine_configured) {
        return 'comicvine'
      }
      if (status.metron_configured) {
        setApplyInfoMessage('ComicVine is not configured; using Metron for this run.')
        return 'metron'
      }
      setErrorMessage('No online source is configured. Add Metron credentials or a ComicVine API key.')
      return null
    }

    if (onlineSource === 'all') {
      if (status.metron_configured && status.comicvine_configured) {
        return 'all'
      }
      if (status.metron_configured) {
        setApplyInfoMessage('Only Metron is configured; using Metron for this run.')
        return 'metron'
      }
      if (status.comicvine_configured) {
        setApplyInfoMessage('Only ComicVine is configured; using ComicVine for this run.')
        return 'comicvine'
      }
      setErrorMessage('No online source is configured. Add Metron credentials or a ComicVine API key.')
      return null
    }

    return onlineSource
  }

  useEffect(() => {
    void loadSetupStatus()

    async function loadSavedSettings() {
      try {
        const result = await getSavedSettings()
        setSavedSettings(result)
        if (result.last_root_path) {
          setRootPath(result.last_root_path)
        }
      } catch {
        setSavedSettings({ metron_user: '', metron_pass: '', comicvine_key: '', last_root_path: '' })
      }
    }

    void loadSavedSettings()

    try {
      const serialized = window.sessionStorage.getItem(UI_STATE_KEY)
      if (!serialized) {
        return
      }

      const restored = JSON.parse(serialized) as {
        rootPath?: string
        recurse?: boolean
        onlineSource?: string
        matchMode?: string
        writeFormats?: string[]
        scanResults?: ComicFile[]
        selectedPaths?: string[]
        isSettingsExpanded?: boolean
      }

      if (restored.rootPath) setRootPath(restored.rootPath)
      if (typeof restored.recurse === 'boolean') setRecurse(restored.recurse)
      if (restored.onlineSource) setOnlineSource(restored.onlineSource)
      if (restored.matchMode) setMatchMode(restored.matchMode)
      if (Array.isArray(restored.writeFormats) && restored.writeFormats.length > 0) setWriteFormats(restored.writeFormats)
      if (Array.isArray(restored.scanResults)) setScanResults(restored.scanResults)
      if (Array.isArray(restored.selectedPaths)) setSelectedPaths(restored.selectedPaths)
      if (typeof restored.isSettingsExpanded === 'boolean') setIsSettingsExpanded(restored.isSettingsExpanded)
    } catch {
      // Ignore invalid saved UI state.
    }
  }, [])

  useEffect(() => {
    const validPaths = new Set(scanResults.map((comic) => comic.path))
    setSelectedPaths((previous) => previous.filter((path) => validPaths.has(path)))
  }, [scanResults])

  useEffect(() => {
    const state = {
      rootPath,
      recurse,
      onlineSource,
      matchMode,
      writeFormats,
      scanResults,
      selectedPaths,
      isSettingsExpanded,
    }
    window.sessionStorage.setItem(UI_STATE_KEY, JSON.stringify(state))
  }, [rootPath, recurse, onlineSource, matchMode, writeFormats, scanResults, selectedPaths, isSettingsExpanded])

  useEffect(() => {
    if (!selectedFile) {
      setCoverDataUri(null)
      return
    }

    async function loadCover() {
      setLoadingCover(true)
      try {
        const response = await getCoverImage(selectedFile)
        setCoverDataUri(response.cover_data_uri)
      } catch {
        setCoverDataUri(null)
      } finally {
        setLoadingCover(false)
      }
    }

    void loadCover()
  }, [selectedFile])

  async function onScan(event: FormEvent) {
    event.preventDefault()
    setErrorMessage('')
    setApplyInfoMessage('')
    setIsBusy(true)
    try {
      const files = await scanLibrary(rootPath, recurse)
      setScanResults(files)
      setSelectedPaths(files.slice(0, 1).map((comic) => comic.path))
      setPreviewText('')
      setCommandLog('')
      setBatchResults([])
      setBatchProgressPercent(0)
      setBatchCurrentFile('')
      setSavedSettings((previous) => ({ ...previous, last_root_path: rootPath }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Scan failed.')
    } finally {
      setIsBusy(false)
    }
  }

  async function onPreview() {
    if (!selectedFile) {
      setErrorMessage('Select a comic file first.')
      return
    }
    setErrorMessage('')
    setIsBusy(true)
    try {
      const effectiveOnlineSource = await resolveOnlineSourceForRun()
      if (!effectiveOnlineSource) {
        return
      }

      const persisted = await saveSettings({ ...savedSettings, last_root_path: rootPath })
      setSavedSettings(persisted)

      const response = await previewTagging(selectedFile, effectiveOnlineSource, matchMode, {
        metron_user: savedSettings.metron_user,
        metron_pass: savedSettings.metron_pass,
        comicvine_key: savedSettings.comicvine_key,
      })
      handleMetronAuthFailure(`${response.command_result.stdout}\n${response.command_result.stderr}`)
      setPreviewText(sanitizeTerminalText(response.metadata_preview))
      setCommandLog([
        `$ ${response.command_result.command.join(' ')}`,
        '',
        sanitizeTerminalText(response.command_result.stderr),
      ].filter(Boolean).join('\n'))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Preview failed.')
    } finally {
      setIsBusy(false)
    }
  }

  async function onReadMetadata() {
    if (!selectedFile) {
      setErrorMessage('Select a comic file first.')
      return
    }

    setErrorMessage('')
    setIsBusy(true)
    try {
      const response = await readMetadata(selectedFile)
      setPreviewText(sanitizeTerminalText(response.metadata))
      setCommandLog([
        `$ ${response.command_result.command.join(' ')}`,
        '',
        sanitizeTerminalText(response.command_result.stderr),
      ].filter(Boolean).join('\n'))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Read metadata failed.')
    } finally {
      setIsBusy(false)
    }
  }

  async function onApplySelected() {
    if (!selectedFile) {
      setErrorMessage('Select a comic file first.')
      return
    }
    setErrorMessage('')
    setIsBusy(true)
    try {
      const effectiveOnlineSource = await resolveOnlineSourceForRun()
      if (!effectiveOnlineSource) {
        return
      }

      const persisted = await saveSettings({ ...savedSettings, last_root_path: rootPath })
      setSavedSettings(persisted)

      const response = await applyTagging(selectedFile, effectiveOnlineSource, matchMode, writeFormats, {
        metron_user: savedSettings.metron_user,
        metron_pass: savedSettings.metron_pass,
        comicvine_key: savedSettings.comicvine_key,
      })
      handleMetronAuthFailure(`${response.command_result.stdout}\n${response.command_result.stderr}`)
      setCommandLog([
        `$ ${response.command_result.command.join(' ')}`,
        '',
        sanitizeTerminalText(response.command_result.stdout),
        sanitizeTerminalText(response.command_result.stderr),
      ].filter(Boolean).join('\n'))

      if (response.fallback_used) {
        setApplyInfoMessage('Permission fallback used: tagged via local temp copy, then copied back.')
      }

      setBatchResults((previous) => {
        const currentStatus: BatchResult = {
          path: selectedFile,
          status: response.command_result.exit_code === 0 ? 'success' : 'failed',
          message:
            response.command_result.stderr ||
            response.command_result.stdout ||
            `Exit code ${response.command_result.exit_code}`,
        }

        const withoutSelected = previous.filter((item) => item.path !== selectedFile)
        return [currentStatus, ...withoutSelected]
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Apply failed.')
    } finally {
      setIsBusy(false)
    }
  }

  async function onApplyAllScanned() {
    if (scanResults.length === 0) {
      setErrorMessage('Scan a library first to batch apply tags.')
      return
    }

    setErrorMessage('')
    setIsBusy(true)
    setBatchProgressPercent(0)
    setBatchCurrentFile('')
    setBatchResults(
      scanResults.map((comic) => ({
        path: comic.path,
        status: 'pending',
        message: 'Queued',
      })),
    )

    let successCount = 0

    try {
      const effectiveOnlineSource = await resolveOnlineSourceForRun()
      if (!effectiveOnlineSource) {
        return
      }

      const persisted = await saveSettings({ ...savedSettings, last_root_path: rootPath })
      setSavedSettings(persisted)

      for (let index = 0; index < scanResults.length; index += 1) {
        const filePath = scanResults[index].path
        setBatchCurrentFile(filePath)

        try {
          const response = await applyTagging(filePath, effectiveOnlineSource, matchMode, writeFormats, {
            metron_user: savedSettings.metron_user,
            metron_pass: savedSettings.metron_pass,
            comicvine_key: savedSettings.comicvine_key,
          })
          handleMetronAuthFailure(`${response.command_result.stdout}\n${response.command_result.stderr}`)
          const didSucceed = response.command_result.exit_code === 0
          const hasRateLimit =
            response.command_result.stderr?.includes('Rate limit') ||
            response.command_result.stdout?.includes('Rate limit')

          if (didSucceed && !hasRateLimit) {
            successCount += 1
          }

          const message =
            response.command_result.stderr ||
            response.command_result.stdout ||
            `Exit code ${response.command_result.exit_code}`

          setBatchResults((previous) =>
            previous.map((item) =>
              item.path === filePath
                ? {
                    ...item,
                    status: didSucceed && !hasRateLimit ? 'success' : 'failed',
                    message,
                  }
                : item,
            ),
          )

          setCommandLog([
            `$ ${response.command_result.command.join(' ')}`,
            '',
            sanitizeTerminalText(response.command_result.stdout),
            sanitizeTerminalText(response.command_result.stderr),
          ].filter(Boolean).join('\n'))

          // Exponential backoff for rate limiting: wait longer after each rate-limited request
          if (hasRateLimit && index < scanResults.length - 1) {
            const delayMs = Math.min(1000 * Math.pow(2, index), 30000) // Cap at 30 seconds
            await new Promise((resolve) => window.setTimeout(resolve, delayMs))
          } else if (index < scanResults.length - 1) {
            // Small delay between requests to respect server rate limits
            await new Promise((resolve) => window.setTimeout(resolve, 500))
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Batch apply failed for this file.'

          setBatchResults((previous) =>
            previous.map((item) =>
              item.path === filePath
                ? {
                    ...item,
                    status: 'failed',
                    message,
                  }
                : item,
            ),
          )
        }

        setBatchProgressPercent(Math.round(((index + 1) / scanResults.length) * 100))
      }

      const total = scanResults.length
      const failedCount = total - successCount
      setCommandLog(`Batch finished: ${successCount}/${total} succeeded, ${failedCount} failed.`)

      if (failedCount > 0) {
        setErrorMessage('Batch completed with some failures. Review the batch results below.')
      }
    } finally {
      setBatchCurrentFile('')
      setIsBusy(false)
    }
  }

  function onClearScan() {
    setScanResults([])
    setSelectedPaths([])
    setRootPath('')
    setPreviewText('')
    setCommandLog('')
    setBatchResults([])
    setBatchProgressPercent(0)
    setBatchCurrentFile('')
    setErrorMessage('')
    setApplyInfoMessage('')
    setIsBusy(false)
  }

  async function onRetryFailed() {
    const failedItems = batchResults.filter((result) => result.status === 'failed')
    if (failedItems.length === 0) {
      setErrorMessage('No failed items to retry.')
      return
    }

    setErrorMessage('')
    setIsBusy(true)
    setBatchProgressPercent(0)
    setBatchCurrentFile('')

    let successCount = 0

    try {
      const effectiveOnlineSource = await resolveOnlineSourceForRun()
      if (!effectiveOnlineSource) {
        return
      }

      const persisted = await saveSettings({ ...savedSettings, last_root_path: rootPath })
      setSavedSettings(persisted)

      for (let index = 0; index < failedItems.length; index += 1) {
        const filePath = failedItems[index].path
        setBatchCurrentFile(filePath)

        try {
          const response = await applyTagging(filePath, effectiveOnlineSource, matchMode, writeFormats, {
            metron_user: savedSettings.metron_user,
            metron_pass: savedSettings.metron_pass,
            comicvine_key: savedSettings.comicvine_key,
          })
          handleMetronAuthFailure(`${response.command_result.stdout}\n${response.command_result.stderr}`)
          const didSucceed = response.command_result.exit_code === 0
          const hasRateLimit =
            response.command_result.stderr?.includes('Rate limit') ||
            response.command_result.stdout?.includes('Rate limit')

          if (didSucceed && !hasRateLimit) {
            successCount += 1
          }

          const message =
            response.command_result.stderr ||
            response.command_result.stdout ||
            `Exit code ${response.command_result.exit_code}`

          setBatchResults((previous) =>
            previous.map((item) =>
              item.path === filePath
                ? {
                    ...item,
                    status: didSucceed && !hasRateLimit ? 'success' : 'failed',
                    message,
                  }
                : item,
            ),
          )

          setCommandLog([
            `$ ${response.command_result.command.join(' ')}`,
            '',
            sanitizeTerminalText(response.command_result.stdout),
            sanitizeTerminalText(response.command_result.stderr),
          ].filter(Boolean).join('\n'))

          // Exponential backoff for rate limiting
          if (hasRateLimit && index < failedItems.length - 1) {
            const delayMs = Math.min(1000 * Math.pow(2, index), 30000)
            await new Promise((resolve) => window.setTimeout(resolve, delayMs))
          } else if (index < failedItems.length - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 500))
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Retry failed for this file.'

          setBatchResults((previous) =>
            previous.map((item) =>
              item.path === filePath
                ? {
                    ...item,
                    status: 'failed',
                    message,
                  }
                : item,
            ),
          )
        }

        setBatchProgressPercent(Math.round(((index + 1) / failedItems.length) * 100))
      }

      const total = failedItems.length
      const newFailedCount = total - successCount
      setCommandLog(`Retry finished: ${successCount}/${total} succeeded, ${newFailedCount} failed.`)

      if (newFailedCount === 0) {
        setApplyInfoMessage('All previously failed items have been successfully processed!')
      } else if (newFailedCount > 0) {
        setErrorMessage(`${newFailedCount} item(s) still failing. You can retry again.`)
      }
    } finally {
      setBatchCurrentFile('')
      setIsBusy(false)
    }
  }

  async function onValidateYACLib() {
    if (!yacLibPath) {
      setErrorMessage('Please select your YACLibrary .ydb database file first.')
      return
    }

    if (batchResults.length === 0) {
      setErrorMessage('No batch results to validate. Run a batch tagging first.')
      return
    }

    setErrorMessage('')
    setYacLibValidating(true)
    try {
      const filePaths = batchResults.map((r) => r.path)
      const validation = await validateYACLibMetadata(yacLibPath, filePaths)
      setYacLibValidation(validation)

      if (!validation.database_valid) {
        setErrorMessage(`YACLibrary database validation failed: ${validation.error}`)
      } else if (validation.with_metadata === 0 && validation.total_comics > 0) {
        setApplyInfoMessage(
          `Note: YACLibrary database found but shows no metadata for these files yet. Remember to use Tools → Import Comics Info in YACReaderLibrary to import the metadata from your files.`,
        )
      } else if (validation.with_metadata > 0) {
        setApplyInfoMessage(
          `✓ Found ${validation.with_metadata}/${validation.total_comics} comics with metadata in YACLibrary database!`,
        )
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Validation failed.')
    } finally {
      setYacLibValidating(false)
    }
  }

  function toggleWriteFormat(value: string) {
    setWriteFormats((previous) => {
      if (previous.includes(value)) {
        const filtered = previous.filter((existing) => existing !== value)
        return filtered.length > 0 ? filtered : ['cix']
      }
      return [...previous, value]
    })
  }

  function toggleSelectedPath(path: string) {
    setSelectedPaths((previous) => {
      if (previous.includes(path)) {
        return previous.filter((existing) => existing !== path)
      }
      return [...previous, path]
    })
  }

  function onSelectAllFiles() {
    setSelectedPaths(scanResults.map((comic) => comic.path))
  }

  function onClearSelection() {
    setSelectedPaths([])
  }

  async function copyCommand(command: string, key: string) {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommandKey(key)
      window.setTimeout(() => setCopiedCommandKey(''), 1400)
    } catch {
      setErrorMessage('Copy failed. Select the command text and copy manually.')
    }
  }

  async function onSaveSettings() {
    setSettingsSaveMessage('')
    try {
      const saved = await saveSettings({ ...savedSettings, last_root_path: rootPath })
      setSavedSettings(saved)
      setSettingsSaveMessage('Credentials saved locally for backend use.')
      await loadSetupStatus()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Saving settings failed.')
    }
  }

  async function onBrowseRootPath() {
    setErrorMessage('')
    setIsBusy(true)
    try {
      const response = await browseFolder(rootPath)
      if (!response.path) {
        return
      }

      setRootPath(response.path)
      const saved = await saveSettings({ ...savedSettings, last_root_path: response.path })
      setSavedSettings(saved)
      setSettingsSaveMessage('Last folder saved.')
    } catch (error) {
      const fallbackPath = window.prompt('Browse is unavailable on this system. Enter a folder path:', rootPath)
      if (fallbackPath && fallbackPath.trim()) {
        const trimmedPath = fallbackPath.trim()
        setRootPath(trimmedPath)
        const saved = await saveSettings({ ...savedSettings, last_root_path: trimmedPath })
        setSavedSettings(saved)
        setSettingsSaveMessage('Folder path set manually and saved.')
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Browse folder failed.')
      }
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <main className="page-shell">
      <div className="background-glow background-glow--left" aria-hidden="true" />
      <div className="background-glow background-glow--right" aria-hidden="true" />

      <header className="top-bar">
        <p className="brand">Comicbox Tag Studio</p>
        <a href="https://comicbox.readthedocs.io/" target="_blank" rel="noreferrer" className="top-link">
          Comicbox Docs
        </a>
      </header>

      <section className="hero">
        <p className="eyebrow">GUI Tagging Workflow</p>
        <h1>Scan, preview, and apply accurate metadata to your comics.</h1>
        <p className="hero-copy">
          This app wraps Comicbox so you can run online identification with a visual workflow
          instead of hand-writing CLI commands for every issue.
        </p>

        <form className="scan-form" onSubmit={onScan}>
          <label>
            Library path
            <div className="path-input-row">
              <input
                type="text"
                placeholder="C:\\Comics"
                value={rootPath}
                onChange={(event) => setRootPath(event.target.value)}
                disabled={isBusy}
              />
              <button className="button button--ghost" type="button" onClick={() => void onBrowseRootPath()} disabled={isBusy}>
                Browse...
              </button>
            </div>
          </label>

          <label className="inline-field">
            <input
              type="checkbox"
              checked={recurse}
              onChange={(event) => setRecurse(event.target.checked)}
              disabled={isBusy}
            />
            Recurse subfolders
          </label>

          <div className="button-row">
            <button className="button button--primary" type="submit" disabled={isBusy || !rootPath.trim()}>
              {isBusy ? 'Working...' : 'Scan Library'}
            </button>
            {scanResults.length > 0 && (
              <button className="button button--ghost" type="button" onClick={onClearScan} disabled={isBusy}>
                Clear & Start Over
              </button>
            )}
          </div>
        </form>
      </section>

      {setupStatus && (
        <section className="setup-panel" aria-label="Comicbox setup status">
          <div className="setup-panel__header">
            <h2>Setup Status</h2>
            <p className="panel-subtitle">Detects online credentials and CBR support before you run tagging.</p>
            <button className="button button--ghost" type="button" onClick={() => void loadSetupStatus()}>
              Refresh Checks
            </button>
          </div>

          <div className="setup-grid">
            <article className="setup-card">
              <h3>Online Sources</h3>
              <p>
                Metron: <strong>{setupStatus.metron_configured ? 'Configured' : 'Missing'}</strong>
              </p>
              <p>
                ComicVine: <strong>{setupStatus.comicvine_configured ? 'Configured' : 'Missing'}</strong>
              </p>
              <p>
                Ready for online lookup:{' '}
                <strong>{setupStatus.any_online_source_configured ? 'Yes' : 'No'}</strong>
              </p>
            </article>

            <article className="setup-card">
              <h3>Archive Tooling</h3>
              <p>
                RAR extractor: <strong>{setupStatus.unrar_available ? 'Available' : 'Missing'}</strong>
              </p>
              <p className="setup-path">
                Extractor binary: {setupStatus.unrar_executable || 'Not detected'}
              </p>
              <p className="setup-path">Comicbox binary: {setupStatus.comicbox_executable}</p>
            </article>
          </div>

          {setupStatus.warnings.length > 0 && (
            <div className="setup-warnings">
              {setupStatus.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          <div className="setup-help-grid">
            {!setupStatus.metron_configured && (
              <article className="setup-help-card">
                <h3>Configure Metron</h3>
                <p>Set credentials in the terminal where you run the backend API:</p>
                <div className="setup-code-wrap">
                  <button
                    className="copy-button"
                    type="button"
                    onClick={() =>
                      void copyCommand(
                        '$env:COMICBOX_METRON_USER = "your-username"\n$env:COMICBOX_METRON_PASS = "your-password"',
                        'metron',
                      )
                    }
                  >
                    {copiedCommandKey === 'metron' ? 'Copied' : 'Copy'}
                  </button>
                  <pre className="setup-code">$env:COMICBOX_METRON_USER = "your-username"{`\n`}$env:COMICBOX_METRON_PASS = "your-password"</pre>
                </div>
              </article>
            )}

            {!setupStatus.comicvine_configured && (
              <article className="setup-help-card">
                <h3>Configure ComicVine</h3>
                <p>Set your API key in the backend terminal session:</p>
                <div className="setup-code-wrap">
                  <button
                    className="copy-button"
                    type="button"
                    onClick={() =>
                      void copyCommand(
                        '$env:COMICBOX_COMICVINE_KEY = "your-api-key"',
                        'comicvine',
                      )
                    }
                  >
                    {copiedCommandKey === 'comicvine' ? 'Copied' : 'Copy'}
                  </button>
                  <pre className="setup-code">$env:COMICBOX_COMICVINE_KEY = "your-api-key"</pre>
                </div>
              </article>
            )}

            {!setupStatus.unrar_available && (
              <article className="setup-help-card">
                <h3>Enable CBR Support</h3>
                <p>Install WinRAR/UnRAR and add WinRAR to your PATH for the current shell:</p>
                <div className="setup-code-wrap">
                  <button
                    className="copy-button"
                    type="button"
                    onClick={() =>
                      void copyCommand('winget install RARLab.WinRAR\n$env:Path += ";C:\\Program Files\\WinRAR"\nunrar', 'unrar')
                    }
                  >
                    {copiedCommandKey === 'unrar' ? 'Copied' : 'Copy'}
                  </button>
                  <pre className="setup-code">winget install RARLab.WinRAR{`\n`}$env:Path += ";C:\Program Files\WinRAR"{`\n`}unrar</pre>
                </div>
              </article>
            )}
          </div>

          <article className="settings-card">
            <div className="setup-panel__header">
              <h3>Saved API Credentials</h3>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setIsSettingsExpanded((previous) => !previous)}
              >
                {isSettingsExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {isSettingsExpanded && (
              <>
                <p className="panel-subtitle">Stored in a local ignored settings file for this app backend.</p>

                <label>
                  Metron Username
                  <input
                    type="text"
                    value={savedSettings.metron_user}
                    onChange={(event) =>
                      setSavedSettings((prev) => ({ ...prev, metron_user: event.target.value }))
                    }
                  />
                </label>

                <label>
                  Metron Password
                  <input
                    type="password"
                    value={savedSettings.metron_pass}
                    onChange={(event) =>
                      setSavedSettings((prev) => ({ ...prev, metron_pass: event.target.value }))
                    }
                  />
                </label>

                <label>
                  ComicVine API Key
                  <input
                    type="password"
                    value={savedSettings.comicvine_key}
                    onChange={(event) =>
                      setSavedSettings((prev) => ({ ...prev, comicvine_key: event.target.value }))
                    }
                  />
                </label>

                <button className="button button--primary" type="button" onClick={() => void onSaveSettings()}>
                  Save Credentials
                </button>
              </>
            )}
          </article>

          {settingsSaveMessage && <p className="settings-save-message">{settingsSaveMessage}</p>}
        </section>
      )}

      {setupCheckError && (
        <section className="setup-panel" aria-label="Setup diagnostics unavailable">
          <div className="setup-warnings">
            <p>{setupCheckError}</p>
          </div>
        </section>
      )}

      <section className="panel-grid" aria-label="Tagging controls and results">
        <article className="panel">
          <h2>1) Select File</h2>
          <p className="panel-subtitle">{selectedCountLabel} • {selectedFilesLabel}</p>

          <div className="button-row">
            <button
              className="button button--ghost"
              type="button"
              onClick={onSelectAllFiles}
              disabled={scanResults.length === 0}
            >
              Select All
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={onClearSelection}
              disabled={selectedPaths.length === 0}
            >
              Clear
            </button>
          </div>

          <div className="file-table-wrap">
            <table className="file-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>File Name</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {scanResults.length === 0 && (
                  <tr>
                    <td colSpan={3}>No files loaded</td>
                  </tr>
                )}
                {scanResults.map((comic) => {
                  const fileName = comic.path.split(/[/\\]/).pop() || comic.path
                  const checked = selectedPaths.includes(comic.path)
                  return (
                    <tr key={comic.path} className={checked ? 'file-table__row--selected' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectedPath(comic.path)}
                        />
                      </td>
                      <td>{fileName}</td>
                      <td>{comic.path}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {selectedFile && (
            <div className="cover-preview">
              <h3>Cover Preview</h3>
              {loadingCover && <p>Loading cover image...</p>}
              {!loadingCover && coverDataUri && (
                <img
                  src={coverDataUri}
                  alt="Comic cover"
                  className="cover-preview__image"
                />
              )}
              {!loadingCover && !coverDataUri && <p>No cover image found</p>}
            </div>
          )}

          <label>
            Online source
            <select value={onlineSource} onChange={(event) => setOnlineSource(event.target.value)}>
              <option value="metron">Metron</option>
              <option value="comicvine">ComicVine</option>
              <option value="all">All</option>
            </select>
          </label>

          <label>
            Match mode
            <select value={matchMode} onChange={(event) => setMatchMode(event.target.value)}>
              <option value="ask">ask</option>
              <option value="careful">careful</option>
              <option value="auto">auto</option>
              <option value="eager">eager</option>
            </select>
          </label>
        </article>

        <article className="panel">
          <h2>2) Preview Metadata</h2>
          <p className="panel-subtitle">Dry run online tagging before writing anything.</p>
          <div className="button-row">
            <button className="button button--ghost" type="button" onClick={onPreview} disabled={isBusy || !selectedFile}>
              Preview Tagging
            </button>
            <button className="button button--ghost" type="button" onClick={onReadMetadata} disabled={isBusy || !selectedFile}>
              View Existing Metadata
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={cbzInspecting || !selectedFile || !selectedFile.toLowerCase().endsWith('.cbz')}
              onClick={() => {
                if (!selectedFile) return
                setCbzInspecting(true)
                setCbzInspect(null)
                inspectCbzMetadata(selectedFile)
                  .then((result) => setCbzInspect(result))
                  .catch(() => setCbzInspect({ found: false, xml_content: null, error: 'Request failed' }))
                  .finally(() => setCbzInspecting(false))
              }}
            >
              {cbzInspecting ? 'Checking...' : 'Check Embedded Metadata'}
            </button>
          </div>

          {cbzInspect && (
            <div className={`cbz-inspect-result cbz-inspect-result--${cbzInspect.found ? 'found' : 'missing'}`}>
              {cbzInspect.found
                ? <><strong>✓ ComicInfo.xml found inside the CBZ.</strong> Metadata was written successfully.</>
                : <><strong>✗ No ComicInfo.xml found.</strong> {cbzInspect.error ?? 'Metadata has not been written to this file yet. Run Apply Tags first.'}</>
              }
              {cbzInspect.found && cbzInspect.xml_content && (
                <pre className="cbz-xml-content">{cbzInspect.xml_content}</pre>
              )}
            </div>
          )}

          <pre className="terminal-output">{previewText || 'No preview yet.'}</pre>
        </article>

        <article className="panel">
          <h2>3) Apply Tags</h2>
          <p className="panel-subtitle">Choose output metadata formats and write.</p>

          <div className="format-list">
            {WRITE_FORMAT_OPTIONS.map((option) => (
              <label key={option.value} className="inline-field">
                <input
                  type="checkbox"
                  checked={writeFormats.includes(option.value)}
                  onChange={() => toggleWriteFormat(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>

          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              onClick={onApplySelected}
              disabled={isBusy || !selectedFile}
            >
              Apply Selected
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={onApplyAllScanned}
              disabled={isBusy || scanResults.length === 0}
            >
              Apply All Scanned
            </button>
          </div>

          {applyInfoMessage && <p className="settings-save-message">{applyInfoMessage}</p>}

          {(isBusy || batchProgressPercent > 0) && (
            <div className="progress-shell" aria-live="polite">
              <p className="panel-subtitle">
                Progress: {batchProgressPercent}%{batchCurrentFile ? ` - ${batchCurrentFile}` : ''}
              </p>
              <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={batchProgressPercent}>
                <div className="progress-fill" style={{ width: `${batchProgressPercent}%` }} />
              </div>
            </div>
          )}
        </article>

        {batchResults.length > 0 && (
          <article className="panel panel--full">
            <div className="batch-results-header">
              <h2>Batch Results</h2>
              {batchResults.some((r) => r.status === 'failed') && (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void onRetryFailed()}
                  disabled={isBusy}
                >
                  {isBusy ? 'Retrying...' : 'Retry Failed'}
                </button>
              )}
            </div>
            <div className="batch-table-wrap">
              <table className="batch-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Status</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {batchResults.map((result) => (
                    <tr key={result.path}>
                      <td>{result.path}</td>
                      <td>
                        <span className={`status-pill status-pill--${result.status}`}>{result.status}</span>
                      </td>
                      <td>{result.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <article className="panel panel--nested">
              <h3>Verify in YACLibrary</h3>
              <p className="panel-subtitle">Validate that metadata made it into your YACLibrary database after tagging.</p>

              <div className="yaclib-input-row">
                <input
                  type="text"
                  placeholder="Path to .ydb file (e.g., C:\Users\You\AppData\Local\YACReader\library.ydb)"
                  value={yacLibPath}
                  onChange={(e) => setYacLibPath(e.target.value)}
                  className="yaclib-input"
                />
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => void onValidateYACLib()}
                  disabled={yacLibValidating || !yacLibPath}
                >
                  {yacLibValidating ? 'Validating...' : 'Validate in DB'}
                </button>
              </div>

              {yacLibValidation && (
                <div className="yaclib-results">
                  {yacLibValidation.database_valid ? (
                    <>
                      <p className="yaclib-summary">
                        <strong>Database Status:</strong> ✓ Valid | <strong>Total Comics:</strong> {yacLibValidation.total_comics} |{' '}
                        <strong>With Metadata:</strong> {yacLibValidation.with_metadata} | <strong>Without:</strong> {yacLibValidation.without_metadata}
                      </p>

                      {yacLibValidation.results.length > 0 && (
                        <div className="batch-table-wrap">
                          <table className="batch-table">
                            <thead>
                              <tr>
                                <th>File</th>
                                <th>In DB</th>
                                <th>Has Metadata</th>
                                <th>Series</th>
                                <th>Issue</th>
                              </tr>
                            </thead>
                            <tbody>
                              {yacLibValidation.results.map((result) => (
                                <tr key={result.file_path}>
                                  <td className="cell-file">{result.file_path.split(/[/\\]/).pop()}</td>
                                  <td>{result.in_database ? '✓' : '✗'}</td>
                                  <td>{result.has_metadata ? '✓' : '✗'}</td>
                                  <td>{result.series_name || '—'}</td>
                                  <td>{result.issue_number || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="yaclib-error">Database error: {yacLibValidation.error}</p>
                  )}
                </div>
              )}
            </article>
          </article>
        )}

        <article className="panel panel--full">
          <h2>Command Log</h2>
          <pre className="terminal-output">{commandLog || 'No command has run yet.'}</pre>
        </article>

        {errorMessage && (
          <article className="panel panel--full panel--error">
            <h2>Error</h2>
            <p>{errorMessage}</p>
          </article>
        )}
      </section>
    </main>
  )
}
