'use strict';

exports.promisify = (fn) => (...args) =>
  new Promise((resolve, reject) => {
    fn(...args, (err, obj) => {
      if (err) reject(err);
      resolve(obj);
    });
  });
