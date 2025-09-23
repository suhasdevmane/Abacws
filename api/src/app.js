const express = require("express");
const api = require("./api");
const { PORT, URL_PREFIX } = require('./api/constants');

const app = express();

// Simple process health endpoint (does not depend on DB)
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(URL_PREFIX, api);

// Start api
app.listen(PORT, () => {
  console.log(`API is listening on '${PORT}'...`);
});
