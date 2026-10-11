// OWNER: media + backup module builder. PUBLIC interface — keep exports; replace stubs.
//
// Media library (PLAN §6.7): index files in place (never copy/move them). ffprobe (ffprobe-static,
// asar-unpacked path fix: replace 'app.asar' with 'app.asar.unpacked') for duration/size/codec/fps,
// ffmpeg (ffmpeg-static) for a 320px JPG thumbnail into paths.thumbs (video: frame at 1 s; image:
// scaled). Images without ffprobe data: read dimensions with ffprobe too (works for jpg/png/webp).
// hash = sha1 of size + first/last 1 MB (fast). platformFit/fitNotes = gradeMedia() against every
// FIT_TARGET. Watch folders: fs.watch (recursive) + debounce, add new media files, mark missing.
// Rescan on start and every 10 min. Implements: media.* commands.
import type { MediaAsset } from '@shared/types'

export function getAssets(ids: string[]): MediaAsset[] {
  void ids
  return []
}

export function start(): void {}
export async function stop(): Promise<void> {}
