// ffprobe / ffmpeg plumbing for the media library. Electron-free so vitest can run it against the
// real binaries. Every child process goes through one small limiter: indexing a folder of 200 videos
// must not spawn 200 ffprobes at once.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { FIT_TARGETS, gradeMedia, type MediaFacts } from '@shared/platforms'
import type { FitLevel } from '@shared/types'

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv'])
export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'])

export function mediaKindOfPath(p: string): 'video' | 'image' | null {
  const e = extname(p).toLowerCase()
  return VIDEO_EXT.has(e) ? 'video' : IMAGE_EXT.has(e) ? 'image' : null
}

/** In a packaged app the binaries live in app.asar.unpacked (electron-builder asarUnpack). */
export const unpacked = (p: string): string => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
export const ffprobePath = (): string => unpacked(ffprobeStatic.path)
export function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('ffmpeg binary not available for this platform')
  return unpacked(ffmpegStatic)
}

// ── concurrency limit ───────────────────────────────────────────────────────
export function limiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: (() => void)[] = []
  const next = () => {
    if (active >= max) return
    const go = queue.shift()
    if (go) {
      active++
      go()
    }
  }
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
}

const procLimit = limiter(3)

function run(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return procLimit(
    () =>
      new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
          if (err) reject(Object.assign(err, { stderr: String(stderr) }))
          else resolve({ stdout: String(stdout), stderr: String(stderr) })
        })
      })
  )
}

// ── ffprobe JSON → facts ────────────────────────────────────────────────────
export interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  tags?: Record<string, string>
  side_data_list?: { side_data_type?: string; rotation?: number | string }[]
  disposition?: { attached_pic?: number }
}
export interface ProbeJson {
  streams?: ProbeStream[]
  format?: { duration?: string; format_name?: string }
}

export interface ProbeFacts {
  kind: 'video' | 'image'
  width: number | null
  height: number | null
  durationMs: number | null
  fps: number | null
  codec: string | null
}

function rate(r: string | undefined): number | null {
  if (!r) return null
  const [n, d] = r.split('/').map(Number)
  if (!n || !Number.isFinite(n)) return null
  const v = d ? n / d : n
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null
}

/** Rotation in degrees from the display matrix side data (new ffprobe) or the rotate tag (old). */
export function rotationOf(s: ProbeStream): number {
  const sd = s.side_data_list?.find((x) => x.rotation !== undefined)
  const raw = sd?.rotation ?? s.tags?.rotate
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/**
 * Facts for one file from ffprobe output. `ext` decides the kind; the streams must agree
 * (a .mp4 without a video stream is not media we can post). Returns null when unusable.
 */
export function factsFromProbe(json: ProbeJson, ext: string): ProbeFacts | null {
  const kind = mediaKindOfPath('x' + ext.toLowerCase())
  if (!kind) return null
  const streams = json.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && !(kind === 'video' && s.disposition?.attached_pic)) ?? streams.find((s) => s.codec_type === 'video')
  if (!v) return null
  let width = v.width ?? null
  let height = v.height ?? null
  if (width && height && Math.abs(rotationOf(v)) % 180 === 90) [width, height] = [height, width]
  if (kind === 'image') return { kind, width, height, durationMs: null, fps: null, codec: v.codec_name ?? null }
  const durS = Number(json.format?.duration ?? v.duration)
  return {
    kind,
    width,
    height,
    durationMs: Number.isFinite(durS) && durS > 0 ? Math.round(durS * 1000) : null,
    fps: rate(v.avg_frame_rate) ?? rate(v.r_frame_rate),
    codec: v.codec_name ?? null
  }
}

/** Fallback for files the bundled (older) ffprobe can't read: parse `ffmpeg -i` stderr. */
export function factsFromFfmpegBanner(stderr: string, ext: string): ProbeFacts | null {
  const kind = mediaKindOfPath('x' + ext.toLowerCase())
  if (!kind) return null
  const m = /Stream #\S+.*?: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr)
  if (!m) return null
  let width = Number(m[2])
  let height = Number(m[3])
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr)
  if (rot && Math.abs(Number(rot[1])) % 180 === 90) [width, height] = [height, width]
  if (kind === 'image') return { kind, width, height, durationMs: null, fps: null, codec: m[1] }
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const fps = /, (\d+(?:\.\d+)?) fps/.exec(stderr)
  return {
    kind,
    width,
    height,
    durationMs: d ? Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 1000) : null,
    fps: fps ? Number(fps[1]) : null,
    codec: m[1]
  }
}

/** Probe a file; null when neither ffprobe nor ffmpeg can make sense of it. */
export async function probeFile(path: string): Promise<ProbeFacts | null> {
  const ext = extname(path)
  try {
    const { stdout } = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], 30_000)
    const f = factsFromProbe(JSON.parse(stdout) as ProbeJson, ext)
    if (f && f.width && f.height) return f
  } catch {
    /* fall through to ffmpeg */
  }
  try {
    await run(ffmpegPath(), ['-hide_banner', '-i', path], 30_000)
  } catch (e) {
    // ffmpeg -i without an output always exits 1; the banner is in stderr
    return factsFromFfmpegBanner(String((e as { stderr?: string }).stderr ?? ''), ext)
  }
  return null
}

/** 320 px wide JPG. Video: frame at min(1 s, duration/2); image: scaled. ffmpeg applies rotation. */
export async function makeThumb(src: string, out: string, facts: ProbeFacts): Promise<boolean> {
  const args = ['-v', 'error', '-y']
  if (facts.kind === 'video') {
    const at = Math.max(0, Math.min(1, (facts.durationMs ?? 0) / 2000))
    args.push('-ss', at.toFixed(3))
  }
  args.push('-i', src, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out)
  try {
    await run(ffmpegPath(), args, 60_000)
    return true
  } catch {
    return false
  }
}

/** Fast content hash: sha1(size + first 1 MB + last 1 MB). */
export async function quickHash(path: string): Promise<{ hash: string; size: number }> {
  const MB = 1024 * 1024
  const { size } = await stat(path)
  const h = createHash('sha1').update(String(size))
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(MB, size))
    await fh.read(head, 0, head.length, 0)
    h.update(head)
    if (size > MB) {
      const tailLen = MB
      const tail = Buffer.alloc(tailLen)
      await fh.read(tail, 0, tailLen, size - tailLen)
      h.update(tail)
    }
  } finally {
    await fh.close()
  }
  return { hash: h.digest('hex'), size }
}

/** platformFit + fitNotes against every FIT_TARGET. */
export function gradeAll(m: MediaFacts): { platformFit: Record<string, FitLevel>; fitNotes: Record<string, string[]> } {
  const platformFit: Record<string, FitLevel> = {}
  const fitNotes: Record<string, string[]> = {}
  for (const t of FIT_TARGETS) {
    const g = gradeMedia(m, t)
    platformFit[t.id] = g.level
    fitNotes[t.id] = g.notes
  }
  return { platformFit, fitNotes }
}
