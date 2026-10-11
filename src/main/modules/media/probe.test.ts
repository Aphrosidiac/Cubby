import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { factsFromFfmpegBanner, factsFromProbe, ffmpegPath, gradeAll, limiter, makeThumb, probeFile, quickHash, unpacked, type ProbeJson } from './probe'

describe('factsFromProbe (pure)', () => {
  const vid = (extra: object): ProbeJson => ({
    streams: [{ codec_type: 'audio', codec_name: 'aac' }, { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001', ...extra }],
    format: { duration: '12.345' }
  })
  it('reads a landscape video', () => {
    expect(factsFromProbe(vid({}), '.mp4')).toEqual({ kind: 'video', width: 1920, height: 1080, durationMs: 12345, fps: 29.97, codec: 'h264' })
  })
  it('swaps width/height for rotated phone video (side data, new ffprobe)', () => {
    const f = factsFromProbe(vid({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] }), '.MOV')
    expect([f?.width, f?.height]).toEqual([1080, 1920])
  })
  it('swaps for the rotate tag (old ffprobe) and ignores 180', () => {
    expect(factsFromProbe(vid({ tags: { rotate: '270' } }), '.mp4')?.width).toBe(1080)
    expect(factsFromProbe(vid({ tags: { rotate: '180' } }), '.mp4')?.width).toBe(1920)
  })
  it('falls back to r_frame_rate and ignores cover art', () => {
    const j: ProbeJson = {
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, disposition: { attached_pic: 1 } },
        { codec_type: 'video', codec_name: 'hevc', width: 1080, height: 1920, avg_frame_rate: '0/0', r_frame_rate: '25/1' }
      ],
      format: { duration: '4' }
    }
    expect(factsFromProbe(j, '.mov')).toMatchObject({ codec: 'hevc', fps: 25, width: 1080 })
  })
  it('images have no duration/fps; audio-only and unknown types are rejected', () => {
    expect(factsFromProbe({ streams: [{ codec_type: 'video', codec_name: 'png', width: 1080, height: 1350 }], format: { duration: '0.04' } }, '.png')).toEqual({
      kind: 'image', width: 1080, height: 1350, durationMs: null, fps: null, codec: 'png'
    })
    expect(factsFromProbe({ streams: [{ codec_type: 'audio' }] }, '.m4v')).toBeNull()
    expect(factsFromProbe(vid({}), '.txt')).toBeNull()
  })
  it('parses an ffmpeg banner as a fallback', () => {
    const banner = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mov':\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 100 kb/s\n  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1920x1080, 30 fps, 30 tbr\n    Side data:\n      displaymatrix: rotation of -90.00 degrees`
    expect(factsFromFfmpegBanner(banner, '.mov')).toEqual({ kind: 'video', width: 1080, height: 1920, durationMs: 62500, fps: 30, codec: 'hevc' })
  })
  it('fixes asar paths', () => {
    expect(unpacked('C:\\A\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe')).toBe('C:\\A\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe')
    expect(unpacked('/x/node_modules/ffmpeg-static/ffmpeg')).toBe('/x/node_modules/ffmpeg-static/ffmpeg')
  })
  it('grades against every fit target', () => {
    const g = gradeAll({ kind: 'video', width: 1080, height: 1920, durationMs: 4000, codec: 'h264', sizeBytes: 1000 })
    expect(g.platformFit.instagram_reel).toBe('ok')
    expect(g.platformFit.youtube_video).toBe('bad')
    expect(g.platformFit.instagram_image).toBe('bad')
    expect(g.fitNotes.instagram_image).toContain('needs an image')
  })
  it('limits concurrency', async () => {
    const lim = limiter(2)
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 8 }, () =>
        lim(async () => {
          active++
          peak = Math.max(peak, active)
          await new Promise((r) => setTimeout(r, 10))
          active--
        })
      )
    )
    expect(peak).toBe(2)
  })
})

describe('real ffprobe/ffmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cubby-b-media-probe-'))
  const ff = (args: string[]) => execFileSync(ffmpegPath(), ['-v', 'error', '-y', ...args], { cwd: dir })
  beforeAll(() => {
    ff(['-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'reel.mp4'])
    ff(['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'wide.mp4'])
    ff(['-display_rotation', '90', '-i', 'wide.mp4', '-c', 'copy', 'rotated.mp4'])
    ff(['-f', 'lavfi', '-i', 'testsrc=size=1080x1350', '-frames:v', '1', 'post.png'])
    ff(['-f', 'lavfi', '-i', 'testsrc=size=1200x628', '-frames:v', '1', 'link.jpg'])
  }, 60_000)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('probes videos incl. rotation', async () => {
    expect(await probeFile(join(dir, 'reel.mp4'))).toMatchObject({ kind: 'video', width: 1080, height: 1920, fps: 30, codec: 'h264' })
    const reel = await probeFile(join(dir, 'reel.mp4'))
    expect(reel!.durationMs).toBeGreaterThan(3900)
    expect(await probeFile(join(dir, 'wide.mp4'))).toMatchObject({ width: 1920, height: 1080, fps: 25 })
    expect(await probeFile(join(dir, 'rotated.mp4'))).toMatchObject({ width: 1080, height: 1920 })
  }, 30_000)

  it('probes images', async () => {
    expect(await probeFile(join(dir, 'post.png'))).toMatchObject({ kind: 'image', width: 1080, height: 1350, durationMs: null })
    expect(await probeFile(join(dir, 'link.jpg'))).toMatchObject({ kind: 'image', width: 1200, height: 628 })
  })

  it('makes 320px thumbnails (rotation applied)', async () => {
    const f = (await probeFile(join(dir, 'rotated.mp4')))!
    const out = join(dir, 'thumb.jpg')
    expect(await makeThumb(join(dir, 'rotated.mp4'), out, f)).toBe(true)
    expect(statSync(out).size).toBeGreaterThan(1000)
    const t = (await probeFile(out.replace(/\.jpg$/, '.jpg')))!
    expect(t.width).toBe(320)
    expect(t.height).toBeGreaterThan(500) // portrait after rotation (320x568)
    const pf = (await probeFile(join(dir, 'post.png')))!
    expect(await makeThumb(join(dir, 'post.png'), join(dir, 'pthumb.jpg'), pf)).toBe(true)
    expect(existsSync(join(dir, 'pthumb.jpg'))).toBe(true)
  }, 30_000)

  it('quick hash is stable and size-sensitive', async () => {
    const a = await quickHash(join(dir, 'reel.mp4'))
    expect(a.hash).toMatch(/^[0-9a-f]{40}$/)
    expect((await quickHash(join(dir, 'reel.mp4'))).hash).toBe(a.hash)
    expect((await quickHash(join(dir, 'wide.mp4'))).hash).not.toBe(a.hash)
  })
})
