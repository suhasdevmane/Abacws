const client = require('../database');

// Resolve :deviceName param to a device document and stash on res.locals
async function deviceMiddleware(req, res, next) {
  try {
    const deviceName = req.params.deviceName;
    if (!deviceName) return res.status(400).json({ error: 'Missing deviceName' });

    const device = await client
      .db()
      .collection('devices')
      .findOne({ name: deviceName }, { projection: { _id: 0 } });

    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.locals.device = device;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { deviceMiddleware };
