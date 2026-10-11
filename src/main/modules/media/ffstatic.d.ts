// ffprobe-static ships without types.
declare module 'ffprobe-static' {
  const ffprobe: { path: string }
  export default ffprobe
}
