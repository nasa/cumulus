const path = require('path');
const { IgnorePlugin } = require('webpack');

const ignoredPackages = [ ];

module.exports = {
  plugins: [
    new IgnorePlugin({
      resourceRegExp: new RegExp(`^(${ignoredPackages.join('|')})$`)
    }),
  ],
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './src/index.js',
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
  devtool: 'inline-source-map',
  optimization: {
    nodeEnv: false
  }
};
