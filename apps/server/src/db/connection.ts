import SqliteDatabase from 'better-sqlite3';

export type Database = InstanceType<typeof SqliteDatabase>;

/** Open a SQLite database with WAL mode and foreign keys enabled. */
export function openDb(file: string): Database {
  const db: Database = new SqliteDatabase(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
