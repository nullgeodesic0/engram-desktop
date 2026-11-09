import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { execCli, isWindows, spawnCli } from '../platform'
import { readyInterpreter, speechModelsDir, transcribeScriptPath } from '../runtime/envManager'
import { SPEECH_LAYER, scrubbedEnv } from '../runtime/runtimePaths'

/**
 * On-device transcription of one recorded oral-exam answer: the speech
 * layer's interpreter runs resources/runtime/engram_transcribe.py
 * (faster-whisper) on an audio file under app userData. The audio never
 * leaves the machine; the only network use is the one-time model download
 * into the runtime's models folder.
 *
 * Doctrine: a subprocess door (D1), pinned. It runs only the managed speech
 * env's interpreter on the script shipped in the app's resources, with the
 * kernel's scrubbed environment. Never engram.py.
 */

/** The Whisper model. small.en: English only, and good enough on physics vocabulary. */
export const SPEECH_MODEL = 'small.en'
/** A cold first run downloads the model, so the limit is generous. */
const TIME_LIMIT_MS = 15 * 60_000

export interface Transcript {
  text: string
  /** The audio's length, in seconds, as the decoder measured it. */
  duration: number
}

export async function speechReady(): Promise<boolean> {
  return (await readyInterpreter(SPEECH_LAYER)) !== null
}

function speechEnv(): NodeJS.ProcessEnv {
  const models = speechModelsDir()
  return {
    ...scrubbedEnv(process.env),
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    HF_HOME: join(models, 'hf'),
    HF_HUB_DISABLE_TELEMETRY: '1',
    HF_HUB_DISABLE_PROGRESS_BARS: '1',
  }
}

/**
 * Transcribes `audioPath`. `prompt` primes the vocabulary (the question as
 * asked), so "Knill–Laflamme" comes back spelled as the exam spells it.
 */
export async function transcribe(audioPath: string, prompt: string): Promise<Transcript> {
  const interpreter = await readyInterpreter(SPEECH_LAYER)
  if (!interpreter) throw new Error('The speech layer is not installed. Install it in Settings → Code runtime.')
  const models = speechModelsDir()
  await mkdir(models, { recursive: true })
  const nonce = randomBytes(16).toString('hex')
  const out = join(dirname(audioPath), `.transcribe-${nonce}.json`)
  const child = spawnCli(interpreter, ['-I', '-B', '-X', 'utf8', transcribeScriptPath()], {
    cwd: dirname(audioPath),
    env: speechEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let tail = ''
  const keep = (chunk: Buffer) => {
    tail = (tail + chunk.toString('utf-8')).slice(-2000)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  child.stdin?.on('error', () => {})
  child.stdin?.end(
    JSON.stringify({
      audio: audioPath,
      model: SPEECH_MODEL,
      models_dir: models,
      prompt: prompt.slice(0, 800),
      out,
      nonce,
    }) + '\n',
  )
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    if (isWindows && child.pid)
      void execCli('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10_000 }).catch(() => {})
    else child.kill('SIGKILL')
  }, TIME_LIMIT_MS)
  await new Promise<void>((res) => {
    child.on('error', () => res())
    child.on('exit', () => res())
  })
  clearTimeout(timer)
  if (timedOut) throw new Error('Transcription ran past 15 minutes and was stopped.')
  let result: Record<string, unknown>
  try {
    result = JSON.parse(await readFile(out, 'utf-8')) as Record<string, unknown>
  } catch {
    throw new Error(`The transcriber stopped without a result.${tail ? ` ${tail.trim().split('\n').pop()}` : ''}`)
  } finally {
    await rm(out, { force: true }).catch(() => {})
  }
  if (result.nonce !== nonce) throw new Error('The transcriber wrote a result for another run.')
  if (typeof result.error === 'string') throw new Error(`Transcription failed: ${result.error}`)
  return {
    text: typeof result.text === 'string' ? result.text : '',
    duration: typeof result.duration === 'number' ? result.duration : 0,
  }
}
