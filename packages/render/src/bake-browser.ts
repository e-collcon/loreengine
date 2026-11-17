/**
 * The browser's half of the vector bake (spec 6.7): rasterizing an SVG with
 * an <img> and a canvas, and encoding a page as PNG. `bake.ts` is the pure
 * half and takes these as `BakeTools`.
 */
import type { AssetRef } from '@loreengine/schema';
import type { BakeTools, Raster } from './bake.ts';

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Draw a raster into a canvas (a texture source, or the input to PNG encoding). */
export function rasterToCanvas(raster: Raster): HTMLCanvasElement {
  const canvas = canvasOf(raster.width, raster.height);
  const image = new ImageData(raster.width, raster.height);
  image.data.set(raster.data);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas;
}

/** Bake tools for a page running in a browser. `putBlob` stores a page and returns its AssetRef. */
export function browserBakeTools(putBlob: (bytes: Uint8Array, mime: string, extra: { width: number; height: number }) => Promise<AssetRef>): BakeTools {
  return {
    async rasterize(svg, width, height) {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image();
        image.decoding = 'async';
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('an SVG source could not be rasterized'));
          image.src = url;
        });
        const canvas = canvasOf(width, height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0, width, height);
        return { width, height, data: ctx.getImageData(0, 0, width, height).data };
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    async encode(page) {
      const blob = await new Promise<Blob | null>((resolve) => rasterToCanvas(page).toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('an atlas page could not be encoded');
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' };
    },
    putBlob,
  };
}
