// MySQL implementation of datastore (parity with postgres.js)
// Tables (InnoDB, utf8mb4):
//  devices(name VARCHAR(191) PK, type VARCHAR(191), floor INT NOT NULL, pos_x DOUBLE NOT NULL, pos_y DOUBLE NOT NULL, pos_z DOUBLE NOT NULL, pinned TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)
//  device_data(id BIGINT AUTO_INCREMENT PK, device_name VARCHAR(191) NOT NULL, timestamp BIGINT NOT NULL, payload JSON NOT NULL, INDEX idx_device_time(device_name, timestamp DESC), FOREIGN KEY(device_name) REFERENCES devices(name) ON DELETE CASCADE)
//  data_sources(id INT AUTO_INCREMENT PK, name VARCHAR(191) UNIQUE, host VARCHAR(191) NOT NULL, port INT NOT NULL, database VARCHAR(191) NOT NULL, schema_name VARCHAR(191), username VARCHAR(191), password VARCHAR(191), ssl TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
//  device_timeseries_mappings(id INT AUTO_INCREMENT PK, device_name VARCHAR(191) NOT NULL, data_source_id INT NOT NULL, table_name VARCHAR(191) NOT NULL, device_id_column VARCHAR(191) NOT NULL, device_identifier_value VARCHAR(191) NOT NULL, timestamp_column VARCHAR(191) NOT NULL, value_columns JSON NOT NULL, primary_value_column VARCHAR(191), range_min DOUBLE, range_max DOUBLE, color_min VARCHAR(32), color_max VARCHAR(32), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(device_name, data_source_id), FOREIGN KEY(device_name) REFERENCES devices(name) ON DELETE CASCADE, FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE)
//  device_rules(id INT AUTO_INCREMENT PK, device_name VARCHAR(191) NOT NULL, source_type ENUM('internal','external') NOT NULL, field VARCHAR(191) NOT NULL, op ENUM('>','>=','<','<=','=','!=','between','outside') NOT NULL, threshold_low DOUBLE NOT NULL, threshold_high DOUBLE NULL, severity VARCHAR(32) NOT NULL DEFAULT 'info', enabled TINYINT(1) NOT NULL DEFAULT 1, description TEXT NULL, last_triggered_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_rules_device(device_name), FOREIGN KEY(device_name) REFERENCES devices(name) ON DELETE CASCADE)

const { MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } = require('../constants');
const { upsertDevice } = require('../devicesFile');
const mysql = require('mysql2/promise');

let pool; let closed=false; let initStarted=false; let readyResolve, readyReject;
const ready = new Promise((res, rej)=>{ readyResolve=res; readyReject=rej; });

async function createPool(){
  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    supportBigNumbers: true,
  });
}

function isTransient(e){
  if(!e) return false;
  if(/connect ECONNREFUSED/i.test(e.message)) return true;
  if(/Connection lost: The server closed the connection/i.test(e.message)) return true;
  if(/ER_SERVER_SHUTDOWN/i.test(e.message)) return true;
  return false;
}

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

const MAX_ATTEMPTS = Number(process.env.MYSQL_MAX_CONNECT_ATTEMPTS)||30;
const INITIAL_DELAY=Number(process.env.MYSQL_INITIAL_DELAY_MS)||300;
const MAX_DELAY=Number(process.env.MYSQL_MAX_DELAY_MS)||5000;

(async function connectLoop(attempt=1, delay=INITIAL_DELAY){
  if(closed) return;
  try {
    await createPool();
    // Simple test query
    await pool.query('SELECT 1');
    if(!initStarted){
      initStarted=true;
      try { await init(); readyResolve(); console.log(`MySQL connected (attempt ${attempt})`); }
      catch(e){ console.error('MySQL init failed', e); readyReject(e); }
    }
  } catch(e){
    if(closed) return;
    if(isTransient(e) && attempt<MAX_ATTEMPTS){
      console.warn(`MySQL connect attempt ${attempt} failed (${e.code||e.message}); retrying in ${delay}ms...`);
      await sleep(delay); return connectLoop(attempt+1, Math.min(Math.round(delay*1.5), MAX_DELAY));
    } else {
      console.error('MySQL connection failed (final)', e); readyReject(e);
    }
  }
})();

async function init(){
  // Ensure required tables using idempotent CREATEs
  await pool.query(`CREATE TABLE IF NOT EXISTS devices (
    name VARCHAR(191) PRIMARY KEY,
    type VARCHAR(191),
    floor INT NOT NULL,
    pos_x DOUBLE NOT NULL,
    pos_y DOUBLE NOT NULL,
    pos_z DOUBLE NOT NULL,
    pinned TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await pool.query(`CREATE TABLE IF NOT EXISTS device_data (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_name VARCHAR(191) NOT NULL,
    timestamp BIGINT NOT NULL,
    payload JSON NOT NULL,
    INDEX idx_device_time(device_name, timestamp DESC),
    FOREIGN KEY (device_name) REFERENCES devices(name) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await pool.query(`CREATE TABLE IF NOT EXISTS data_sources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(191) UNIQUE NOT NULL,
    host VARCHAR(191) NOT NULL,
    port INT NOT NULL,
    database VARCHAR(191) NOT NULL,
    schema_name VARCHAR(191),
    username VARCHAR(191),
    password VARCHAR(191),
    ssl TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await pool.query(`CREATE TABLE IF NOT EXISTS device_timeseries_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_name VARCHAR(191) NOT NULL,
    data_source_id INT NOT NULL,
    table_name VARCHAR(191) NOT NULL,
    device_id_column VARCHAR(191) NOT NULL,
    device_identifier_value VARCHAR(191) NOT NULL,
    timestamp_column VARCHAR(191) NOT NULL,
    value_columns JSON NOT NULL,
    primary_value_column VARCHAR(191),
    range_min DOUBLE,
    range_max DOUBLE,
    color_min VARCHAR(32),
    color_max VARCHAR(32),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_name, data_source_id),
    FOREIGN KEY (device_name) REFERENCES devices(name) ON DELETE CASCADE,
    FOREIGN KEY (data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await pool.query(`CREATE TABLE IF NOT EXISTS device_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_name VARCHAR(191) NOT NULL,
    source_type ENUM('internal','external') NOT NULL,
    field VARCHAR(191) NOT NULL,
    op ENUM('>','>=','<','<=','=','!=','between','outside') NOT NULL,
    threshold_low DOUBLE NOT NULL,
    threshold_high DOUBLE NULL,
    severity VARCHAR(32) NOT NULL DEFAULT 'info',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    description TEXT NULL,
    last_triggered_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_rules_device(device_name),
    FOREIGN KEY (device_name) REFERENCES devices(name) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  // Seed devices from JSON if empty
  try {
    if(process.env.NODE_ENV!=='test'){
      const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM devices');
      if(rows[0].cnt === 0){
        const seed = require('../data/devices.json');
        if(Array.isArray(seed.devices)){
          for(const d of seed.devices){
            try {
              await pool.query('INSERT IGNORE INTO devices(name,type,floor,pos_x,pos_y,pos_z,pinned) VALUES(?,?,?,?,?,?,?)', [d.name, d.type||null, d.floor, d.position.x, d.position.y, d.position.z, d.pinned?1:0]);
              upsertDevice({ name: d.name, type: d.type, floor: d.floor, position: d.position, pinned: !!d.pinned });
            } catch(_){}
          }
          console.log('[MySQL] Seeded devices from devices.json');
        }
      }
    }
  } catch(e){ console.warn('[MySQL] Device seeding skipped:', e.message); }
}

function mapRow(r){ if(!r) return null; return { name: r.name, type: r.type||undefined, floor: Number(r.floor), position: { x: Number(r.pos_x), y: Number(r.pos_y), z: Number(r.pos_z) }, pinned: !!r.pinned }; }

// Devices
async function listDevices(){ await ready; const [rows] = await pool.query('SELECT * FROM devices ORDER BY name'); return rows.map(mapRow); }
async function getDeviceByName(name){ await ready; const [rows] = await pool.query('SELECT * FROM devices WHERE name=?',[name]); return mapRow(rows[0]); }
async function createDevice(doc){ await ready; await pool.query('INSERT INTO devices(name,type,floor,pos_x,pos_y,pos_z,pinned) VALUES(?,?,?,?,?,?,?)', [doc.name, doc.type||null, doc.floor, doc.position.x, doc.position.y, doc.position.z, doc.pinned?1:0]); return getDeviceByName(doc.name); }
async function updateDevice(name, update){ await ready; const sets=[]; const vals=[]; if(update.type!==undefined){ sets.push('type=?'); vals.push(update.type); } if(update.floor!==undefined){ sets.push('floor=?'); vals.push(update.floor); } if(update.position){ sets.push('pos_x=?','pos_y=?','pos_z=?'); vals.push(update.position.x, update.position.y, update.position.z); } if(update.pinned!==undefined){ sets.push('pinned=?'); vals.push(update.pinned?1:0); } if(!sets.length) return getDeviceByName(name); vals.push(name); await pool.query(`UPDATE devices SET ${sets.join(', ')} WHERE name=?`, vals); return getDeviceByName(name); }

// Device data
async function latestDeviceData(name){ await ready; const [rows] = await pool.query('SELECT payload, timestamp FROM device_data WHERE device_name=? ORDER BY timestamp DESC LIMIT 1',[name]); if(!rows[0]) return null; return { ...rows[0].payload, timestamp: Number(rows[0].timestamp) }; }
async function insertDeviceData(name, data){ await ready; await pool.query('INSERT INTO device_data(device_name,timestamp,payload) VALUES(?,?,?)',[name, data.timestamp, JSON.stringify(data)]); }
async function deviceHistory(name, from, to, limit=10000){ await ready; const [rows] = await pool.query('SELECT payload, timestamp FROM device_data WHERE device_name=? AND timestamp BETWEEN ? AND ? ORDER BY timestamp DESC LIMIT ?',[name, from, to, limit]); return rows.map(r=> ({ ...r.payload, timestamp: Number(r.timestamp) })); }
async function deleteDeviceHistory(name){ await ready; await pool.query('DELETE FROM device_data WHERE device_name=?',[name]); }

// Data sources
async function listDataSources(){ await ready; const [rows] = await pool.query('SELECT id,name,host,port,database,schema_name AS schema, ssl, created_at FROM data_sources ORDER BY id'); return rows; }
async function createDataSource(ds){ await ready; const [res] = await pool.query('INSERT INTO data_sources(name,host,port,database,schema_name,username,password,ssl) VALUES(?,?,?,?,?,?,?,?)',[ds.name, ds.host, ds.port, ds.database, ds.schema||null, ds.username||null, ds.password||null, ds.ssl?1:0]); const id=res.insertId; const [rows]=await pool.query('SELECT id,name,host,port,database,schema_name AS schema,ssl,created_at FROM data_sources WHERE id=?',[id]); return rows[0]; }
async function updateDataSource(id, patch){ await ready; const allow=['name','host','port','database','schema','username','password','ssl']; const sets=[]; const vals=[]; for(const k of allow){ if(patch[k]!==undefined){ const col = k==='schema'?'schema_name':k; sets.push(`${col}=?`); vals.push(patch[k]); } } if(!sets.length){ const [rows]=await pool.query('SELECT id,name,host,port,database,schema_name AS schema,ssl,created_at FROM data_sources WHERE id=?',[id]); return rows[0]||null; } vals.push(id); await pool.query(`UPDATE data_sources SET ${sets.join(', ')} WHERE id=?`, vals); const [rows]=await pool.query('SELECT id,name,host,port,database,schema_name AS schema,ssl,created_at FROM data_sources WHERE id=?',[id]); return rows[0]||null; }
async function deleteDataSource(id){ await ready; const [mapRows]=await pool.query('SELECT 1 FROM device_timeseries_mappings WHERE data_source_id=? LIMIT 1',[id]); if(mapRows.length) return { error: 'Data source in use' }; await pool.query('DELETE FROM data_sources WHERE id=?',[id]); return { ok: true }; }

// Mappings
async function listDeviceMappings(){ await ready; const [rows]=await pool.query('SELECT * FROM device_timeseries_mappings ORDER BY id'); return rows.map(r=> ({ ...r, value_columns: Array.isArray(r.value_columns)? r.value_columns : JSON.parse(r.value_columns||'[]') })); }
async function createDeviceMapping(m){ await ready; const [res]=await pool.query(`INSERT INTO device_timeseries_mappings(device_name,data_source_id,table_name,device_id_column,device_identifier_value,timestamp_column,value_columns,primary_value_column,range_min,range_max,color_min,color_max) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[m.device_name,m.data_source_id,m.table_name,m.device_id_column,m.device_identifier_value,m.timestamp_column, JSON.stringify(m.value_columns), m.primary_value_column||null, m.range_min||null, m.range_max||null, m.color_min||null, m.color_max||null]); const id=res.insertId; const [rows]=await pool.query('SELECT * FROM device_timeseries_mappings WHERE id=?',[id]); const row=rows[0]; row.value_columns=JSON.parse(row.value_columns||'[]'); return row; }
async function updateDeviceMapping(id, patch){ await ready; const allow=['device_name','data_source_id','table_name','device_id_column','device_identifier_value','timestamp_column','value_columns','primary_value_column','range_min','range_max','color_min','color_max']; const sets=[]; const vals=[]; for(const k of allow){ if(patch[k]!==undefined){ let v = patch[k]; if(k==='value_columns') v = JSON.stringify(v); sets.push(`${k==='value_columns'? 'value_columns':k}=?`); vals.push(v); } } if(!sets.length){ const [rows]=await pool.query('SELECT * FROM device_timeseries_mappings WHERE id=?',[id]); const row=rows[0]; if(row) row.value_columns=JSON.parse(row.value_columns||'[]'); return row||null; } vals.push(id); await pool.query(`UPDATE device_timeseries_mappings SET ${sets.join(', ')} WHERE id=?`, vals); const [rows]=await pool.query('SELECT * FROM device_timeseries_mappings WHERE id=?',[id]); const row=rows[0]; if(row) row.value_columns=JSON.parse(row.value_columns||'[]'); return row||null; }
async function deleteDeviceMapping(id){ await ready; await pool.query('DELETE FROM device_timeseries_mappings WHERE id=?',[id]); return { ok: true }; }

// Introspection (limited – reuse same DB; schema_name acts like namespace; we list tables by information_schema for given schema_name or current DB if null)
async function listTablesForDataSource(id){ await ready; const [rows]=await pool.query('SELECT * FROM data_sources WHERE id=?',[id]); if(!rows[0]) return null; const schema = rows[0].schema_name || MYSQL_DATABASE; // fallback current DB
  const [t] = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=? ORDER BY table_name', [schema]); return t.map(r=>r.table_name); }
async function listColumnsForDataSourceTable(id, table){ await ready; const [rows]=await pool.query('SELECT * FROM data_sources WHERE id=?',[id]); if(!rows[0]) return null; const schema = rows[0].schema_name || MYSQL_DATABASE; const [c] = await pool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position',[schema, table]); return c; }

async function verifyDeviceMapping(sample){ await ready; const required=['data_source_id','table_name','device_id_column','device_identifier_value','timestamp_column','value_columns']; for(const r of required){ if(sample[r]===undefined||sample[r]===null) return { error: `Missing ${r}` }; } if(!Array.isArray(sample.value_columns)||!sample.value_columns.length) return { error: 'value_columns must be non-empty array' }; const [rows]=await pool.query('SELECT * FROM data_sources WHERE id=?',[sample.data_source_id]); if(!rows[0]) return { error: 'data_source not found' }; const ds=rows[0]; const schema = ds.schema_name || MYSQL_DATABASE; const cols = sample.value_columns.map(c=> `\`${c}\``).join(', ');
  const sql = `SELECT ${cols}, UNIX_TIMESTAMP(\`${sample.timestamp_column}\`)*1000 AS ts FROM \`${schema}\`.\`${sample.table_name}\` WHERE \`${sample.device_id_column}\` = ? ORDER BY \`${sample.timestamp_column}\` DESC LIMIT 5`;
  try { const [res]=await pool.query(sql,[sample.device_identifier_value]); return { ok: true, rows: res, sql }; } catch(e){ return { error: e.message, sql }; }
}

async function fetchDeviceTimeseries(deviceName, fromTs, toTs, limit=2000){ await ready; const [maps]=await pool.query(`SELECT m.*, ds.schema_name AS ds_schema FROM device_timeseries_mappings m JOIN data_sources ds ON m.data_source_id = ds.id WHERE m.device_name=?`, [deviceName]); if(!maps.length) return { series: [] }; const map = maps[0]; const schema = map.ds_schema || MYSQL_DATABASE; const valueColumns = JSON.parse(map.value_columns||'[]'); const cols = valueColumns.map(c=> `\`${c}\``).join(', '); const sql = `SELECT UNIX_TIMESTAMP(\`${map.timestamp_column}\`)*1000 AS ts, ${cols} FROM \`${schema}\`.\`${map.table_name}\` WHERE \`${map.device_id_column}\` = ? AND \`${map.timestamp_column}\` BETWEEN FROM_UNIXTIME(?/1000) AND FROM_UNIXTIME(?/1000) ORDER BY \`${map.timestamp_column}\` ASC LIMIT ?`; const [rows]=await pool.query(sql,[map.device_identifier_value, fromTs, toTs, limit]); return { mapping: { ...map, value_columns: valueColumns }, series: rows }; }

async function fetchLatestForAllMappings(maxLookbackDays=7){ await ready; const [mappings]=await pool.query(`SELECT m.*, ds.schema_name AS ds_schema FROM device_timeseries_mappings m JOIN data_sources ds ON m.data_source_id = ds.id`); if(!mappings.length) return {}; const groups=new Map(); for(const m of mappings){ const valueColumns = JSON.parse(m.value_columns||'[]'); const key=[m.data_source_id,m.table_name,m.device_id_column,m.timestamp_column,valueColumns.join('|')].join('::'); if(!groups.has(key)) groups.set(key,{ meta: {...m, value_columns:valueColumns}, list: [] }); groups.get(key).list.push({...m, value_columns:valueColumns}); }
  const result={}; for(const g of groups.values()){ const { meta, list } = g; const schema = meta.ds_schema || MYSQL_DATABASE; const ids = list.map(l=> l.device_identifier_value); const cols = meta.value_columns.map(c=> `\`${c}\``).join(', '); const sql = `SELECT * FROM ( SELECT \`${meta.device_id_column}\` AS device_id, UNIX_TIMESTAMP(\`${meta.timestamp_column}\`)*1000 AS ts, ${cols}, ROW_NUMBER() OVER (PARTITION BY \`${meta.device_id_column}\` ORDER BY \`${meta.timestamp_column}\` DESC) rn FROM \`${schema}\`.\`${meta.table_name}\` WHERE \`${meta.timestamp_column}\` > NOW() - INTERVAL ${maxLookbackDays} DAY AND \`${meta.device_id_column}\` IN (${ids.map(()=>'?').join(',')}) ) AS ranked WHERE rn=1`; const [rows]=await pool.query(sql, ids); for(const row of rows){ const mapping = list.find(m=> m.device_identifier_value === row.device_id); if(!mapping) continue; const values={}; for(const c of meta.value_columns) values[c]=row[c]; result[mapping.device_name]={ timestamp:Number(row.ts), values, primary: mapping.primary_value_column? values[mapping.primary_value_column]: undefined, mappingId: mapping.id, range_min: mapping.range_min!=null? Number(mapping.range_min): null, range_max: mapping.range_max!=null? Number(mapping.range_max): null, color_min: mapping.color_min, color_max: mapping.color_max }; } }
  return result; }

// Rules
function validateRulePayload(r, partial=false){ const required=['device_name','source_type','field','op','threshold_low']; if(!partial){ for(const k of required){ if(r[k]===undefined) return `Missing field '${k}'`; } } if(r.source_type && !['internal','external'].includes(r.source_type)) return 'Invalid source_type'; if(r.op && !['>','>=','<','<=','=','!=','between','outside'].includes(r.op)) return 'Invalid op'; if(r.op && (r.op==='between'||r.op==='outside') && (r.threshold_high===undefined && !partial)) return 'threshold_high required for between/outside'; return null; }
async function listRules(){ await ready; const [rows]=await pool.query('SELECT * FROM device_rules ORDER BY id'); return rows; }
async function listRulesForDevice(deviceName){ await ready; const [rows]=await pool.query('SELECT * FROM device_rules WHERE device_name=? AND enabled=1 ORDER BY id',[deviceName]); return rows; }
async function getRule(id){ await ready; const [rows]=await pool.query('SELECT * FROM device_rules WHERE id=?',[id]); return rows[0]||null; }
async function createRule(payload){ await ready; const err=validateRulePayload(payload,false); if(err) return { error: err }; const [res]=await pool.query('INSERT INTO device_rules(device_name,source_type,field,op,threshold_low,threshold_high,severity,enabled,description) VALUES(?,?,?,?,?,?,?,?,?)',[payload.device_name,payload.source_type,payload.field,payload.op,payload.threshold_low,payload.threshold_high||null,payload.severity||'info',payload.enabled!==false?1:0,payload.description||null]); return getRule(res.insertId); }
async function updateRule(id, patch){ await ready; const err=validateRulePayload(patch,true); if(err) return { error: err }; const allow=['device_name','source_type','field','op','threshold_low','threshold_high','severity','enabled','description']; const sets=[]; const vals=[]; for(const k of allow){ if(patch[k]!==undefined){ sets.push(`${k}=?`); if(k==='enabled') vals.push(patch[k]?1:0); else vals.push(patch[k]); } } if(!sets.length) return getRule(id); await pool.query(`UPDATE device_rules SET ${sets.join(', ')}, updated_at=NOW() WHERE id=?`, [...vals, id]); return getRule(id); }
async function deleteRule(id){ await ready; await pool.query('DELETE FROM device_rules WHERE id=?',[id]); return { ok: true }; }

function compare(op,value,low,high){ switch(op){ case '>': return value>low; case '>=': return value>=low; case '<': return value<low; case '<=': return value<=low; case '=': return value===low; case '!=': return value!==low; case 'between': return value>=low && value<=high; case 'outside': return value<low || value>high; default: return false; } }
function extractInternalField(payload, field){ if(!payload) return undefined; const raw=payload[field]; if(raw==null) return undefined; if(typeof raw==='object' && raw.value!==undefined){ const n=Number(raw.value); return Number.isNaN(n)?undefined:n; } const n=Number(raw); return Number.isNaN(n)?undefined:n; }
function extractExternalField(entry, field){ if(!entry) return undefined; const raw = entry.values ? entry.values[field] : undefined; if(raw==null) return undefined; const n=Number(raw); return Number.isNaN(n)?undefined:n; }
async function evaluateRulesForDevice(deviceName){ await ready; const rules=await listRulesForDevice(deviceName); if(!rules.length) return []; const internal=await latestDeviceData(deviceName); let externalAll={}; try { externalAll = await fetchLatestForAllMappings(); } catch(_){} const external = externalAll[deviceName]; const ts=Date.now(); const triggered=[]; for(const r of rules){ let current; if(r.source_type==='internal') current=extractInternalField(internal, r.field); else current=extractExternalField(external, r.field); if(current===undefined) continue; if(compare(r.op,current, Number(r.threshold_low), r.threshold_high!=null? Number(r.threshold_high): undefined)){ triggered.push({ id:r.id, device_name:r.device_name, field:r.field, op:r.op, threshold_low: Number(r.threshold_low), threshold_high: r.threshold_high!=null? Number(r.threshold_high): null, severity:r.severity, value: current, source_type:r.source_type, description:r.description, timestamp: ts }); pool.query('UPDATE device_rules SET last_triggered_at=NOW() WHERE id=?',[r.id]).catch(()=>{}); } }
  return triggered; }

async function migrateLegacyCoordinates(dryRun=false){ await ready; const [rows]=await pool.query('SELECT name,pos_x,pos_z FROM devices'); const candidates=rows.filter(r=> Number(r.pos_x) < 0 && Number(r.pos_z) > 0); if(!candidates.length) return { changed: 0, message: 'No legacy candidates found' }; if(dryRun) return { changed: candidates.length, sample: candidates.slice(0,5) }; for(const r of candidates){ const nx=Number(r.pos_x)+160; const nz=Number(r.pos_z)-120; await pool.query('UPDATE devices SET pos_x=?, pos_z=?, updated_at=NOW() WHERE name=?',[nx, nz, r.name]); } return { changed: candidates.length }; }

async function close(){ try { closed=true; if(pool) await pool.end(); } catch(_){} }

module.exports = {
  engine: 'mysql',
  ready,
  listDevices,
  getDeviceByName,
  createDevice,
  updateDevice,
  latestDeviceData,
  insertDeviceData,
  deviceHistory,
  deleteDeviceHistory,
  listDataSources,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  listDeviceMappings,
  createDeviceMapping,
  updateDeviceMapping,
  deleteDeviceMapping,
  listTablesForDataSource,
  listColumnsForDataSourceTable,
  verifyDeviceMapping,
  fetchDeviceTimeseries,
  fetchLatestForAllMappings,
  listRules,
  listRulesForDevice,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  evaluateRulesForDevice,
  migrateLegacyCoordinates,
  close,
};
