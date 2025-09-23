const cors = require('cors');
const express = require('express');
const { consoleLogErrors, errorHandler, mongodbLogErrors } = require('./middleware');
const { devices, docs, healthcheck, query } = require('./routers');

/** Express app */
const api = express();
// Api will only respond to JSON
api.use(cors());
api.use(express.json());

// Lightweight process health (no external deps)
api.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Register routes
api.use("/healthcheck", healthcheck);
api.use("/query", query);
api.use("/devices", devices);

// Register error handlers
api.use(mongodbLogErrors);
api.use(consoleLogErrors);
api.use(errorHandler);

// Register documentation router
api.use("/", docs);

module.exports = api;
