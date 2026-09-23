// TIFF → float planes without the 8-bit round trip. UTIF hands back the decoded
// samples as bytes, normalised to little-endian for 16-bit.
import UTIF from 'utif';

export interface TiffPlanes { width: number; height: number; channels: Float32Array[]; bits: number; }

export function decodeTiffPlanes(buf: ArrayBuffer): TiffPlanes {
  const ifds = UTIF.decode(buf);
  const ifd = ifds[0] as any;
  UTIF.decodeImage(buf, ifd);
  const width = ifd.width as number, height = ifd.height as number;
  const bits: number = ifd.t258?.[0] ?? 8;
  const noc: number = ifd.t277?.[0] ?? 1;
  const sampleFormat: number = ifd.t339?.[0] ?? 1;   // 1 uint, 2 int, 3 float
  const bytes = ifd.data as Uint8Array;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = width * height;
  const planes = Math.min(noc, 3);

  const read: (i: number) => number =
    bits === 8 ? i => bytes[i]
    : bits === 16 && sampleFormat === 2 ? i => dv.getInt16(i * 2, true)
    : bits === 16 ? i => dv.getUint16(i * 2, true)
    : bits === 32 && sampleFormat === 3 ? i => dv.getFloat32(i * 4, ifd.isLE)
    : bits === 32 ? i => dv.getUint32(i * 4, ifd.isLE)
    : (() => { throw new Error(`TIFF: unsupported ${bits}-bit samples`); })();

  const channels: Float32Array[] = [];
  for (let c = 0; c < planes; c++) {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = read(i * noc + c);
    channels.push(p);
  }
  return { width, height, channels, bits };
}
