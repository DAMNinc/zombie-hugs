'use strict';

var winston = require('winston');

var logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      level: 'silly',
      colorize: true,
      prettyPrint: true
    })
  ]
});

module.exports = logger;
