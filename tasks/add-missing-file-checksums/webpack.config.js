const path = require('path');

module.exports = {
  mode: 'production',
  entry: './dist/src/index.js',
  output: {
    libraryTarget: 'commonjs2',
    path: path.resolve(__dirname, 'dist', 'webpack'),
    filename: 'index.js'
  },
  externals: ['aws-sdk'],
  target: 'node',
  devtool: 'eval-cheap-module-source-map',
  optimization: {
    nodeEnv: false
  }
};
