// File → HTMLImageElement for every format Studio accepts. Browser-native formats pass
// through; HEIC, TIFF and RAW are converted first. Shared by Studio and Astro.
import heic2any from 'heic2any';
import UTIF from 'utif';
import LibRaw from 'libraw-wasm';

export const RAW_EXT = /\.(cr2|cr3|nef|nrw|arw|srf|sr2|dng|orf|rw2|rwl|pef|ptx|raf|3fr|fff|iiq|cap|mef|mos|mrw|raw|rw1|srw|x3f)$/i;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/tiff,image/heic,image/heif,image/webp,.png,.jpg,.jpeg,.webp,.tiff,.tif,.heic,.heif,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.orf,.rw2,.rwl,.pef,.ptx,.raf,.3fr,.fff,.iiq,.mef,.mrw,.raw,.srw,.x3f';

export function isSupportedImage(file: File): boolean {
  return file.type.startsWith('image/') || /\.(heic|heif|tiff?)$/i.test(file.name) || RAW_EXT.test(file.name);
}

export function exportFormatOf(file: File): 'jpeg' | 'png' | 'webp' {
  if (file.type === 'image/jpeg' || /\.(jpg|jpeg)$/i.test(file.name)) return 'jpeg';
  if (file.type === 'image/webp' || /\.webp$/i.test(file.name)) return 'webp';
  return 'png';
}

async function rgbaToPngFile(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, name: string): Promise<File> {
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  cvs.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.subarray(0, w * h * 4)), w, h), 0, 0);
  const blob = await new Promise<Blob>((res, rej) => cvs.toBlob(b => b ? res(b) : rej(new Error('encode failed')), 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}

export async function decodeToImage(file: File, onStatus: (msg: string) => void = () => {}): Promise<HTMLImageElement> {
  let f = file;
  onStatus('Loading image...');

  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/.test(file.type)) {
    onStatus('Converting HEIC image...');
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 1 });
    f = new File([Array.isArray(blob) ? blob[0] : blob], file.name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' });
  } else if (/\.tiff?$/i.test(file.name) || /tiff?/.test(file.type)) {
    onStatus('Converting TIFF image...');
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    UTIF.decodeImage(buf, ifds[0]);
    f = await rgbaToPngFile(UTIF.toRGBA8(ifds[0]), ifds[0].width, ifds[0].height, file.name.replace(/\.tiff?$/i, '.png'));
  } else if (RAW_EXT.test(file.name)) {
    onStatus('Decoding RAW file…');
    const libraw = new LibRaw();
    await libraw.open(new Uint8Array(await file.arrayBuffer()), { useCameraWb: true, outputColor: 1, outputBps: 8, userQual: 3 });
    const meta = await libraw.metadata();
    const rgb  = await libraw.imageData() as Uint8Array;
    const W = meta.width as number, H = meta.height as number;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      rgba[i*4] = rgb[i*3]; rgba[i*4+1] = rgb[i*3+1]; rgba[i*4+2] = rgb[i*3+2]; rgba[i*4+3] = 255;
    }
    f = await rgbaToPngFile(rgba, W, H, file.name.replace(RAW_EXT, '.png'));
  }

  const url = URL.createObjectURL(f);
  try {
    return await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Failed to load image.'));
      img.src = url;
    });
  } finally {
    // Revoke after decode; the element keeps its bitmap.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
