const express = require("express");
const { DEVICE_COLLECTION_PREFIX } = require("../constants");
const client = require("../database");
const { deviceMiddleware, apiKeyAuth } = require("../middleware");
const { upsertDevice } = require('../devicesFile');

const router = express.Router();

function getDeviceCollection(deviceName) {
  return client.db().collection(`${DEVICE_COLLECTION_PREFIX}_${deviceName}`);
}

const listDevices = async (req, res) => {
  const devices = await client
    .db()
    .collection("devices")
    .find({})
    .project({ _id: 0 })
    .toArray();
  res.status(200).json(devices);
};

// Basic payload validation
function validateDevicePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid payload';
  const { name, type, floor, position, pinned } = payload;
  if (!name || typeof name !== 'string') return 'Missing or invalid name';
  if (type && typeof type !== 'string') return 'Invalid type';
  if (floor === undefined || floor === null || Number.isNaN(Number(floor))) return 'Missing or invalid floor';
  if (!position || typeof position !== 'object') return 'Missing position';
  const { x, y, z } = position;
  if ([x, y, z].some((v) => typeof v !== 'number' || Number.isNaN(v))) return 'Invalid position';
  if (pinned !== undefined && typeof pinned !== 'boolean') return 'Invalid pinned flag';
  return undefined;
}

// Create a device (POST /api/devices)
const createDevice = async (req, res, next) => {
  try {
    const err = validateDevicePayload(req.body);
    if (err) return res.status(400).json({ error: err });

    const devicesCol = client.db().collection('devices');
    // Ensure unique name index exists
    try { await devicesCol.createIndex({ name: 1 }, { unique: true, name: 'unique_name' }); } catch (_) {}

    const doc = {
      name: String(req.body.name),
      type: req.body.type ? String(req.body.type) : undefined,
      floor: Number(req.body.floor),
      position: {
        x: Number(req.body.position.x),
        y: Number(req.body.position.y),
        z: Number(req.body.position.z),
      },
      pinned: typeof req.body.pinned === 'boolean' ? req.body.pinned : false,
    };

    await devicesCol.insertOne(doc);
    const created = await devicesCol.findOne({ name: doc.name }, { projection: { _id: 0 } });
    // Sync into devices.json (best-effort)
    upsertDevice(created);
    return res.status(201).json(created);
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: 'Device name already exists' });
    }
    return next(e);
  }
};

const getDevice = async (req, res) => {
  const device = res.locals.device;
  res.status(200).json(device);
};

const getData = async (req, res) => {
  const device = res.locals.device;
  const collection = getDeviceCollection(device.name);
  const data = await collection.findOne(
    {},
    {
      limit: 1,
      sort: { timestamp: -1 },
      projection: { _id: 0 },
    }
  );
  res.status(200).json(data);
};

const getHistoricalData = async (req, res) => {
  const device = res.locals.device;
  const from = Number(req.query.from) || 0;
  const to = Number(req.query.to) || Date.now();

  const filter = { timestamp: { $gte: from, $lte: to } };
  const collection = getDeviceCollection(device.name);
  const history = await collection
    .find(filter, {
      limit: 10000,
      sort: { timestamp: -1 },
      projection: { _id: 0 },
    })
    .toArray();
  res.status(200).json(history);
};

const addData = async (req, res) => {
  const device = res.locals.device;
  const data = req.body || {};
  data.timestamp = Date.now();
  const collection = getDeviceCollection(device.name);
  await collection.insertOne(data);
  if (!(await collection.indexExists("timestamp"))) {
    await collection.createIndex({ timestamp: 1 }, { name: "timestamp" });
  }
  res.status(202).json();
};

const deleteData = async (req, res) => {
  const device = res.locals.device;
  const collection = getDeviceCollection(device.name);
  try { await collection.drop(); } catch (e) {}
  res.status(200).json();
};

// Update device (position/type/floor/pinned)
const updateDevice = async (req, res, next) => {
  try {
    const name = req.params.deviceName;
    const payload = req.body || {};

    const update = {};
    if (payload.type !== undefined) update.type = String(payload.type);
    if (payload.floor !== undefined) update.floor = Number(payload.floor);
    if (payload.position !== undefined) {
      const { x, y, z } = payload.position;
      if ([x, y, z].some((v) => typeof v !== 'number' || Number.isNaN(v))) {
        return res.status(400).json({ error: 'Invalid position' });
      }
      update.position = { x: Number(x), y: Number(y), z: Number(z) };
    }
    if (payload.pinned !== undefined) {
      if (typeof payload.pinned !== 'boolean') return res.status(400).json({ error: 'Invalid pinned flag' });
      update.pinned = payload.pinned;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No fields to update' });

    const devicesCol = client.db().collection('devices');
    const { value } = await devicesCol.findOneAndUpdate(
      { name },
      { $set: update },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
    if (!value) return res.status(404).json({ error: 'Device not found' });
    // Sync to devices.json
    upsertDevice(value);
    return res.status(200).json(value);
  } catch (e) {
    return next(e);
  }
};

// Public listing
router.get("/", listDevices);

// Create device
router.post('/', /* apiKeyAuth, */ createDevice);

// Per-device routes
router.use("/:deviceName", deviceMiddleware);
router.get("/:deviceName", getDevice);

router.get("/:deviceName/data", getData);
router.put("/:deviceName/data", addData);

router.get("/:deviceName/history", getHistoricalData);
router.delete("/:deviceName/history", deleteData);

// Update device details
router.patch('/:deviceName', /* apiKeyAuth, */ updateDevice);

module.exports = router;
