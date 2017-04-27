'use strict';

module.exports = {
  target: 'node',
  devtool: 'eval',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            cacheDirectory: true
          }
        }
      }, {
        test: /\.html$/,
        use: [
          {
            loader: 'html-loader',
            options: {
              interpolate: true
            }
          }
        ]
      }, {
        test: /\.md$/,
        use: [
          {
            loader: 'html-loader'
          }, {
            loader: 'markdown-loader',
            options: {
              /* your options here */
            }
          }
        ]
      }
    ]
  }
};
