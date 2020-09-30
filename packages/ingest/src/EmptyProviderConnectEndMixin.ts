type Constructor = new (...args: any[]) => {};

export default function EmptyProviderConnectEndMixin<TBase extends Constructor>(Base: TBase) {
  return class EmptyProviderConnectEnd extends Base {
    /* eslint-disable @typescript-eslint/no-empty-function */
    async connect() {}
    async end() {}
    /* eslint-enable @typescript-eslint/no-empty-function */
  };
}
