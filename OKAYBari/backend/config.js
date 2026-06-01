const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(rootDir, 'data');

module.exports = {
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir,
  dbPath: path.join(dataDir, 'db.json'),
  secretPath: path.join(dataDir, '.jwt-secret'),
  firstAdminPath: path.join(dataDir, 'first-admin.txt'),
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 5600),
  tokenTtlSeconds: Number(process.env.TOKEN_TTL_SECONDS || 60 * 60 * 8),
  defaultAdminEmail: process.env.OKAY_ADMIN_EMAIL || 'admin@okaybari.it',
  defaultAdminPassword: process.env.OKAY_ADMIN_PASSWORD || '',
};
