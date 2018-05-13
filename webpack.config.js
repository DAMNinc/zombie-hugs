const path = require('path');

module.exports = {
  mode: 'development',
  entry: {
    'zombie': './src/client/zombie.js'
  },
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: '[name].js'
  },
  externals: {
    jquery: 'jQuery',
    three: 'THREE'
  },
};