// The MIT License (MIT)
// Copyright (c) 2017 Scott Corgan
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions: The above copyright
// notice and this permission notice shall be included in all copies or
// substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
// WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
// TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
// FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
// THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// This module was ported/refactored from the original express-boom project as it is
// no longer being maintained: https://github.com/scottcorgan/express-boom

const boom = require('@hapi/boom');
const helperMethods = ['wrap', 'create'];

module.exports = () => (req, res, next) => {
  if (res.boom) throw new Error('boom already exists on response object');

  res.boom = {};

  Object.getOwnPropertyNames(boom).forEach((key) => {
    // eslint-disable-next-line lodash/prefer-lodash-typecheck
    if (typeof boom[key] !== 'function') return;

    if (helperMethods.includes(key)) {
      res.boom[key] = (...args) => boom[key](...args);
    } else {
      res.boom[key] = (...args) => {
        const boomed = boom[key](...args);

        const boomedPayloadAndAdditionalResponse = Object.assign(
          boomed.output.payload,
          args[1]
        );

        return res
          .status(boomed.output.statusCode)
          .send(boomedPayloadAndAdditionalResponse);
      };
    }
  });

  next();
};
