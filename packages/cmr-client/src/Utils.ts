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

export function redactAuthorization(headers: Record<string, any>): Record<string, any> {
  const redactedHeaders = { ...headers };
  if ('Authorization' in redactedHeaders) {
    redactedHeaders['Authorization'] = 'REDACTED';
  }
  return redactedHeaders;
}
