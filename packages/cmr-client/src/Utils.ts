import { parseStringPromise } from 'xml2js';

export function parseXMLString(xmlString: string): Promise<unknown> {
  return parseStringPromise(
    xmlString,
    {
      ignoreAttrs: true,
      mergeAttrs: true,
      explicitArray: false,
    }
  );
}
