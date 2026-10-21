declare module 'bmp-js' {
  export interface BmpData {
    width: number;
    height: number;
    data: Buffer;
  }
  export function decode(buffer: Buffer, toRGBA?: boolean): BmpData;
  export function encode(bmpData: BmpData, quality?: number): { data: Buffer; width: number; height: number };
}
