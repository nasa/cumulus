const path = require('path');

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
    'electron',
    {'formidable': 'url'}
  ],
  devtool,
  target: 'node'
};
