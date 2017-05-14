'use strict';

const winston = require('winston');

const logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      level: 'silly',
      colorize: true,
      prettyPrint: true
    })
  ]
});

module.exports = logger;
