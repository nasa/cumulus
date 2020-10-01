// Type definitions for jsftp 2.1
// Project: https://github.com/sergi/jsftp
// Definitions by: Konrad Księski <https://github.com/xyleen>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="node" />

declare module 'jsftp' {
  import { Socket } from 'net';
  import { EventEmitter } from 'events';

  export interface JsftpOpts {
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    createSocket?: ({ port, host }: { port: number, host: string }, firstAction: () => {}) => Socket;
    useList?: boolean;
  }

  export interface UnixLsEntry {
    name: string,
    type: 0 | 1 | 2 | 3,
    time: number,
    size: string,
    owner: string,
    group: string,
    target?: string,
    userPermissions: {
      read: boolean,
      write: boolean,
      exec: boolean
    },
    groupPermissions: {
      read: boolean,
      write: boolean,
      exec: boolean
    },
    otherPermissions: {
      read: boolean,
      write: boolean,
      exec: boolean
    }
  }

  export interface MsDosLsEntry {
    name: string,
    type: 0 | 1,
    time: number,
    size: 0 | string
  }

  export type ErrorCallback = (err: Error) => void;
  export type RawCallback = (err: Error, data: { code: number, text: string }) => void;
  export type ListCallback = (err: Error, dirContents: string) => void;
  export type GetCallback = (err: Error, socket: Socket) => void;
  export type LsCallback = (err: Error, res: Array<MsDosLsEntry | UnixLsEntry>) => void;

  export default class Ftp extends EventEmitter {
    constructor(opts: JsftpOpts);

    ls(filePath: string, callback: LsCallback): void;

    list(filePath: string, callback: ListCallback): void;

    get(remotePath: string, callback: GetCallback): void;
    get(remotePath: string, localPath: string, callback: ErrorCallback): void;

    put(source: string | Buffer | NodeJS.ReadableStream, remotePath: string, callback: ErrorCallback): void;

    rename(from: string, to: string, callback: ErrorCallback): void;

    // Ftp.raw(command, params, callback)
    raw(command: string, callback: RawCallback): void;
    raw(command: string, arg1: any, callback: RawCallback): void;
    raw(command: string, arg1: any, arg2: any, callback: RawCallback): void;
    raw(command: string, arg1: any, arg2: any, arg3: any, callback: RawCallback): void;
    raw(command: string, arg1: any, arg2: any, arg3: any, arg4: any, callback: RawCallback): void;

    keepAlive(timeInMs?: number): void;

    destroy(): void;
  }
}
