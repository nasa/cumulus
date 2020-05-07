declare module 'cksum' {
  import { Writable } from 'stream';
  export function stream(cb: (result: Buffer, length: number) => void): Writable;
}
