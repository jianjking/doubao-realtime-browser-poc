'use strict';

const express = require('express');

const healthRouter = express.Router();

healthRouter.get('/health', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: 'business-backend',
  });
});

module.exports = {
  healthRouter,
};
