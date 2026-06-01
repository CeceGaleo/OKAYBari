const fs = require('node:fs/promises');
const path = require('node:path');

function emptyDb() {
  const now = new Date().toISOString();
  return {
    meta: {
      version: 1,
      created_at: now,
      updated_at: now,
    },
    users: [],
    reservations: [],
    logs: [],
  };
}

function normalizeDb(data) {
  const db = data && typeof data === 'object' ? data : emptyDb();
  db.meta = db.meta && typeof db.meta === 'object' ? db.meta : emptyDb().meta;
  db.users = Array.isArray(db.users) ? db.users : [];
  db.reservations = Array.isArray(db.reservations) ? db.reservations : [];
  db.logs = Array.isArray(db.logs) ? db.logs : [];
  return db;
}

class JsonStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.queue = Promise.resolve();
  }

  async ensure() {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    try {
      await fs.access(this.dbPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.write(emptyDb());
    }
  }

  async read() {
    await this.ensure();
    const raw = await fs.readFile(this.dbPath, 'utf8');
    return normalizeDb(JSON.parse(raw));
  }

  async write(data) {
    const db = normalizeDb(data);
    db.meta.updated_at = new Date().toISOString();

    const tmpPath = `${this.dbPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, this.dbPath);
  }

  update(mutator) {
    const run = this.queue.then(async () => {
      const db = await this.read();
      const result = await mutator(db);
      await this.write(db);
      return result;
    });

    this.queue = run.catch(() => {});
    return run;
  }
}

module.exports = {
  JsonStore,
};
