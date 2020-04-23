declare module 'cksum' {
  import { Writable } from 'stream';
  // eslint-disable-next-line import/prefer-default-export
  export function stream(cb: (result: Buffer, length: number) => void): Writable;
}
