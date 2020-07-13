import fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);

export const readTextFile = (filename: string) =>
  readFile(filename, 'utf8');

export const readJsonFile = (filename: string): Promise<unknown> =>
  readTextFile(filename).then(JSON.parse);
