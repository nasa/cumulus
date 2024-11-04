
const path = require('path');
const { IgnorePlugin } = require('webpack');

module.exports = {
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './dist/lambda/index.js',
  output: {
    chunkFormat: false,
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist', 'webpack')
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true
            },
          },
        ],
      },
    ],
  },
  target: 'node',
  externals: [
    /@aws-sdk\//
  ],
  devtool: 'eval-cheap-module-source-map',
  optimization: {
    nodeEnv: false
  },
};
