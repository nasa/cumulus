const path = require('path');

// let mode = 'development';
// let devtool = 'inline-source-map';

// if(process.env.PRODUCTION) {
//   mode = 'production';
//   devtool = 'source-map';
// }

module.exports = {
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './index.js',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist')
  },
  module: {
    rules: [{
      test: /\.js$/,
      loader: 'babel-loader',
      include: __dirname,
      exclude: /node_modules/,
      options: {
        plugins: [
          'source-map-support',
        ],
      },
    }],
  },
  externals: [
    'aws-sdk',
    'electron',
    {'formidable': 'url'}
  ],
  devtool: 'inline-source-map',
  target: 'node'
};
