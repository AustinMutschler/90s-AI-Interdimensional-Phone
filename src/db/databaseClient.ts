import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { v4 as uuid4 } from 'uuid';
import { OutboundCallSchedule } from '../characterInterfaces/characterTypes.js';


// Singleton database handle
let db: Database<sqlite3.Database, sqlite3.Statement> | null = null;

/**
 * Initialize the SQLite database and schema.
 * Call this once at application startup.
 */
export async function initDb(dbPath: string = './data/partyphone.db'): Promise<void> {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign key support
  await db.run('PRAGMA foreign_keys = ON;');

  // Create conditions table if it doesn't exist
  await db.run(`
    CREATE TABLE IF NOT EXISTS conditions (
      id TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Create the outbound_call_schedule table if it doesn't exist
  await db.run(`
    CREATE TABLE IF NOT EXISTS outbound_call_schedule (
      id TEXT PRIMARY KEY,
      character_name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      start_date_time INTEGER NOT NULL,
      condition_id TEXT,
      completed INTEGER NOT NULL DEFAULT 0
    );
  `);

  console.log('Database initialized successfully');
}

/**
 * Internal helper to get the DB handle, initializing if needed.
 */
async function getDb(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  if (!db) {
    await initDb();
  }
  return db!;
}

/**
 * Fetch scheduled calls for a character, filtered by completed flag.
 */
export async function getScheduleByCharacter(
  characterName: string,
  completed: boolean
): Promise<OutboundCallSchedule[]> {
  const database = await getDb();
  const rows = await database.all(
    `SELECT *
       FROM outbound_call_schedule
      WHERE character_name = ?
        AND completed = ?
      ORDER BY start_date_time ASC`,
    characterName,
    completed ? 1 : 0
  ) as OutboundCallSchedule[];

  return rows.map(r => ({
    id: r.id,
    character_name: r.character_name,
    prompt: r.prompt,
    start_date_time: new Date(r.start_date_time),
    condition_id: r.condition_id,
    completed: r.completed
  }));
}

export async function getCountOfScheduleByCharacterName(characterName: string): Promise<number> {
  const database = await getDb();
  // make query to count the number of schedules by character name
  const response: { count: number } = await database.get(
    `SELECT COUNT(*) as count
       FROM outbound_call_schedule
      WHERE character_name = ?`,
    characterName
  );
  return response.count;
}

export async function uploadCharacterSchedule(schedules: OutboundCallSchedule[]): Promise<void> {
  const database = await getDb();

  schedules.forEach(async (schedule) => {
    const rowToInsert = [
      schedule.id,
      schedule.character_name,
      schedule.prompt,
      schedule.start_date_time.getTime(),
      schedule.condition_id,
      schedule.completed
    ];
    // make query to insert the schedules into the database
    await database.run(
      `INSERT INTO outbound_call_schedule (id, character_name, prompt, start_date_time, condition_id, completed)
         VALUES (?, ?, ?, ?, ?, ?)`,
      rowToInsert
    );

    if (schedule.condition_id) {
      await database.run(
        `INSERT OR IGNORE INTO conditions (id)
         VALUES (?)`,
        schedule.condition_id
      );
    }
  });
}

/**
 * Mark a scheduled call as completed.
 */
export async function markCompleted(id: string): Promise<void> {
  const database = await getDb();
  await database.run(
    `UPDATE outbound_call_schedule
        SET completed = 1
      WHERE id = ?`,
    id
  );
}

export async function markConditionCompleted(id: string): Promise<void> {
  const database = await getDb();
  await database.run(
    `UPDATE conditions
        SET value = 1
      WHERE id = ?`,
    id
  );
}

export async function isConditionMet(id: string): Promise<boolean> {
  const database = await getDb();
  const response: { value: number } = await database.get(
    `SELECT value
       FROM conditions
      WHERE id = ?`,
    id
  );
  return response.value === 1;
}

/**
 * Reset all schedules to not completed (i.e. set completed = 0).
 */
export async function resetAll(): Promise<void> {
  const database = await getDb();
  await database.run(
    `UPDATE outbound_call_schedule
        SET completed = 0`
  );
}

export async function getAllData(): Promise<any> {
  const database = await getDb();
  const outboundTable = await database.all(`SELECT * FROM outbound_call_schedule`); // Use .all() to fetch rows
  const conditionsTable = await database.all(`SELECT * FROM conditions`); // Use .all() to fetch rows

  return {
    outboundTable,
    conditionsTable
  }
}
