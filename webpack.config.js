var path = require('path');

module.exports = {
  entry: {
    'zombie': './src/client/zombie.js'
  },
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: '[name].js'
  },
  resolve: {
    extensions: ['.js']
  },
};