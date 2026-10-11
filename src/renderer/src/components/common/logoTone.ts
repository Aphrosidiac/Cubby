// Is a logo light-on-transparent (a white mark meant for dark backgrounds)? Then it needs an Ink plate,
// or it vanishes on the white logo plate. Measured once per image on a tiny canvas; reactive, so a
// plate flips as soon as the answer is in.
import { reactive } from 'vue';

const tones = reactive(new Map<string, boolean>());
const pending = new Set<string>();

function measure(url: string) {
  pending.add(url);
  const img = new Image();
  img.onload = () => {
    try {
      const n = 32;
      const c = document.createElement('canvas');
      c.width = n; c.height = n;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, n, n);
      const d = g.getImageData(0, 0, n, n).data;
      // an opaque background (corners filled) brings its own contrast: keep the light plate
      const corner = (x: number, y: number) => d[(y * n + x) * 4 + 3];
      if ([corner(0, 0), corner(n - 1, 0), corner(0, n - 1), corner(n - 1, n - 1)].every(a => a > 200)) { tones.set(url, false); return; }
      let sum = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        if (a < 0.3) continue;
        sum += a * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        w += a;
      }
      tones.set(url, w > 0 && sum / w > 0.78);
    } catch {
      tones.set(url, false);
    }
  };
  img.onerror = () => tones.set(url, false);
  img.src = url;
}

/** true = light logo (give it a dark plate); false = dark or opaque logo; undefined while measuring. */
export function lightLogo(url: string | null | undefined): boolean | undefined {
  if (!url) return undefined;
  if (!tones.has(url) && !pending.has(url)) measure(url);
  return tones.get(url);
}
