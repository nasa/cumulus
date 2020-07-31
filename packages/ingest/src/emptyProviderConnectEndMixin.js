'use strict';

exports.emptyProviderConnectEndMixin = {
  connect: () => Promise.resolve(),
  end: () => Promise.resolve()
};
