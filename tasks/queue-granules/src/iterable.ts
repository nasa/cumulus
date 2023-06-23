/**
 * Group granules by collection and split into batches then split again on provider
 * The purpose of this iterable is to avoid creating all the group and chunk arrays all
 * at once to save heap space for large event inputs. This is done by using a sequence of
 * generators that yield the chunks of granules one at a time.
 *
 * The *[Symbol.iterator] method loops over the collection looking for groups that have not
 * already been yielded. Once the first granule of an unseen group is located, a new iterator is
 * created that will search from that point in the collection of granules looking for other
 * granules that belong to the same group.
 *
 * Finally a generator version of the _.chunk() function breaks the grouped granules into chunks.
 */
class GroupAndChunkIterable<
  TElement, 
  TGroupProps extends { [s: string]: string | undefined | null } = { [s: string]: string | undefined | null },
  TGroupKey extends string = string,
> implements Iterable<TGroupProps & { chunks: Iterable<TElement[]> }> {
  constructor(
    private readonly _source: TElement[], 
    private readonly _predicate: (elm: TElement) => TGroupProps,
    private readonly _chunkSize: number,
  ) { }

  private _groupKey(props: TGroupProps): TGroupKey {
    return Object.values(props).filter(p => Boolean(p)).join('') as TGroupKey;
  }

  /**
   * Lodash's chunk is not a generator so instead this is a version of chunk that builds
   * and yields one chunk at a time, limiting the creation of many arrays all at once.
   */
  *_chunk(iterator: Iterator<TElement>): Generator<TElement[]> {
    let chunk = [];
    let curr = iterator.next();
    while (!curr.done) {
      if (chunk.length >= this._chunkSize) {
        yield chunk;
        chunk = [];
      }
      chunk.push(curr.value);
      curr = iterator.next();
    }
    if (chunk.length > 0) {
      yield chunk;
    }
  }

  /**
   * This generator acts like a filter. It will yield all granules that match the
   * `groupKey` param, starting at the `start` point passed in. The `start` index
   * is an optimization to avoid reiterating through granules that can't possibly
   * be in the same group because _groupedGranules is called the first time a
   * group is seen from the [Symbol.iterator] generator.
   */
  *_filterFrom(targetKey: TGroupKey, start: number): Generator<TElement> {
    for (let i = start; i < this._source.length; i += 1) {
      const element = this._source[i];
      const groupKey = this._groupKey(this._predicate(element));
      if (targetKey === groupKey) {
        yield element;
      }
    }
  }

  /**
   * [Symbol.iterator] implements the `Iterable` protocol. This generator iterates through
   * all the granules finding unique groups. When a new group is found, it yields all the
   * matching granules through `_groupedGranules` and chunked using `_chunk`.
   */
  *[Symbol.iterator](): Generator<TGroupProps & { chunks: Iterable<TElement[]> }> {
    const previouslySeen = new Set();
    for (let i = 0; i < this._source.length; i += 1) {
      const element = this._source[i];
      const groupProps = this._predicate(element);
      const groupKey = this._groupKey(this._predicate(element));
      if (!previouslySeen.has(groupKey)) {
        previouslySeen.add(groupKey);
        yield {
          ... groupProps,
          chunks: this._chunk(this._filterFrom(groupKey, i)),
        };
      }
    }
  }
}

export default GroupAndChunkIterable;