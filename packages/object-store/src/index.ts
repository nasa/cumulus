import { S3ObjectStore } from '@cumulus/aws-client';

// Code modified from https://github.com/nasa/harmony/blob/main/app/util/object-store.ts

/**
 * Returns a class to interact with the object store appropriate for
 * the provided protocol, or null if no such store exists.
 *
 * @param {string} protocol - the protocol used in object store URLs.  This may be a full URL, in
 *   which case the protocol will be read from the front of the URL.
 * @returns {S3ObjectStore} an object store for interacting with the given protocol
 */
export function objectStoreForProtocol(protocol?: string): S3ObjectStore | undefined {
  if (!protocol) {
    return undefined;
  }
  // Make sure the protocol is lowercase and does not end in a colon (as URL parsing produces)
  const normalizedProtocol = protocol.toLowerCase().split(':')[0];
  if (normalizedProtocol === 's3') {
    return new S3ObjectStore();
  }
  return undefined;
}

/**
 * Returns the default object store. Allows requesting an object store without first
 * knowing a protocol.
 *
 * @returns {S3ObjectStore} the default object store
 */
export function defaultObjectStore(): S3ObjectStore {
  return new S3ObjectStore();
}
