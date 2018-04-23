const path = require('path');
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

let mode = 'development';
let devtool = 'inline-source-map';

if(process.env.PRODUCTION) {
  mode = 'production',
  devtool = false  
}

module.exports = {
  mode,
  entry: './index.js',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist')
  },
  externals: [
    'aws-sdk',
    'electron'
  ],
  devtool,
  target: 'node',
  plugins: [
    new UglifyJsPlugin({
      // disable uglify to fix as a temp fix for https://github.com/mishoo/UglifyJS2/issues/2842
      test: /\.html($|\?)/i
    })
  ]
};