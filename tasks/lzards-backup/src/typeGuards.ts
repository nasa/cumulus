export function isFulfilledPromise<T>(
  result: PromiseRejectedResult | PromiseFulfilledResult<T>
): result is PromiseFulfilledResult<T> {
  return result.status !== 'rejected';
}
