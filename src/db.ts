import { Database } from "bun:sqlite";

const db = new Database("checked.db");

db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    goal TEXT NOT NULL,
    expectation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    project TEXT NOT NULL,
    expectation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS checkin_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL UNIQUE,
    cadence_days INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    next_due TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
  );
`);

const ensureTeamCheckinSchema = () => {
  const scheduleColumns = db
    .query("PRAGMA table_info(checkin_schedules)")
    .all();
  const hasTeamId = scheduleColumns.some(
    (column: { name: string }) => column.name === "team_id"
  );

  if (scheduleColumns.length > 0 && !hasTeamId) {
    db.exec(`
      DROP TABLE IF EXISTS checkins;
      DROP TABLE IF EXISTS checkin_schedules;

      CREATE TABLE IF NOT EXISTS checkin_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL UNIQUE,
        cadence_days INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        next_due TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL,
        person_id INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
      );
    `);
  } else if (scheduleColumns.length > 0) {
    const hasStartDate = scheduleColumns.some(
      (column: { name: string }) => column.name === "start_date"
    );
    if (!hasStartDate) {
      db.exec(`
        ALTER TABLE checkin_schedules ADD COLUMN start_date TEXT;
      `);
      db.exec(`
        UPDATE checkin_schedules
        SET start_date = COALESCE(start_date, next_due, '')
        WHERE start_date IS NULL OR start_date = '';
      `);
    }
  }
};

ensureTeamCheckinSchema();

const now = () => new Date().toISOString();

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const today = () => formatLocalDate(new Date());

const parseDate = (value: string) => {
  return new Date(`${value}T00:00:00`);
};

const diffDays = (startDate: string, endDate: string) => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
};

const calculateMissedCount = (
  nextDue: string,
  cadenceDays: number,
  referenceDate = today()
) => {
  if (!nextDue || !Number.isFinite(cadenceDays) || cadenceDays <= 0) return 0;
  const daysLate = diffDays(nextDue, referenceDate);
  if (daysLate <= 0) return 0;
  return Math.floor((daysLate - 1) / cadenceDays) + 1;
};

const normalizeDate = (value?: string | null) => {
  if (!value) return today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return today();
  return value;
};

const toLocalDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatLocalDate(date);
};

const addDays = (dateString: string, days: number) => {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
};

const listTeams = () => {
  return db
    .query(
      `
      SELECT t.*, COUNT(p.id) as people_count
      FROM teams t
      LEFT JOIN people p ON p.team_id = t.id
      GROUP BY t.id
      ORDER BY t.name
      `
    )
    .all();
};

const createTeam = (name: string) => {
  const result = db
    .prepare("INSERT INTO teams (name, created_at) VALUES (?, ?)")
    .run(name, now());
  return Number(result.lastInsertRowid);
};

const getTeam = (id: number) => {
  return db.query("SELECT * FROM teams WHERE id = ?").get(id);
};

const listPeopleByTeam = (teamId: number) => {
  return db
    .query(
      `
      SELECT
        p.*,
        (SELECT COUNT(*) FROM goals g WHERE g.person_id = p.id) as goals_count,
        (SELECT COUNT(*) FROM projects pr WHERE pr.person_id = p.id) as projects_count,
        (SELECT ROUND(AVG(c.rating), 1) FROM checkins c WHERE c.person_id = p.id) as avg_rating
      FROM people p
      WHERE p.team_id = ?
      ORDER BY p.name
      `
    )
    .all(teamId);
};

const createPerson = (teamId: number, name: string, title: string | null) => {
  const result = db
    .prepare(
      "INSERT INTO people (team_id, name, title, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(teamId, name, title, now());
  return Number(result.lastInsertRowid);
};

const getPerson = (personId: number) => {
  return db
    .query(
      `
      SELECT p.*, t.name as team_name
      FROM people p
      JOIN teams t ON t.id = p.team_id
      WHERE p.id = ?
      `
    )
    .get(personId);
};

const listGoals = (personId: number) => {
  return db
    .query(
      "SELECT * FROM goals WHERE person_id = ? ORDER BY created_at DESC"
    )
    .all(personId);
};

const createGoal = (personId: number, goal: string, expectation: string) => {
  db.prepare(
    "INSERT INTO goals (person_id, goal, expectation, created_at) VALUES (?, ?, ?, ?)"
  ).run(personId, goal, expectation, now());
};

const listProjects = (personId: number) => {
  return db
    .query(
      "SELECT * FROM projects WHERE person_id = ? ORDER BY created_at DESC"
    )
    .all(personId);
};

const createProject = (
  personId: number,
  project: string,
  expectation: string
) => {
  db.prepare(
    "INSERT INTO projects (person_id, project, expectation, created_at) VALUES (?, ?, ?, ?)"
  ).run(personId, project, expectation, now());
};

const getLastTeamCheckinDate = (teamId: number) => {
  const row = db
    .query("SELECT MAX(created_at) as last_checkin FROM checkins WHERE team_id = ?")
    .get(teamId);
  return toLocalDate(row?.last_checkin ?? null);
};

const calculateNextDueDate = (
  startDateInput: string,
  cadenceDays: number,
  lastCheckinDate?: string | null
) => {
  const startDate = normalizeDate(startDateInput);
  if (!Number.isFinite(cadenceDays) || cadenceDays <= 0) return startDate;
  if (!lastCheckinDate) return startDate;
  const lastDate = normalizeDate(lastCheckinDate);
  const daysSinceStart = diffDays(startDate, lastDate);
  if (daysSinceStart < 0) return startDate;
  if (daysSinceStart % cadenceDays === 0) {
    return addDays(lastDate, cadenceDays);
  }
  const intervals = Math.floor(daysSinceStart / cadenceDays) + 1;
  return addDays(startDate, intervals * cadenceDays);
};

const getSchedule = (teamId: number) => {
  const schedule = db
    .query("SELECT * FROM checkin_schedules WHERE team_id = ?")
    .get(teamId);
  if (!schedule) return null;
  const startDate = schedule.start_date || schedule.next_due || today();
  const lastCheckinDate = getLastTeamCheckinDate(teamId);
  const nextDue = calculateNextDueDate(
    startDate,
    Number(schedule.cadence_days),
    lastCheckinDate
  );
  return {
    ...schedule,
    start_date: startDate,
    next_due: nextDue,
    missed_count: calculateMissedCount(
      nextDue,
      Number(schedule.cadence_days)
    ),
  };
};

const upsertSchedule = (
  teamId: number,
  cadenceDays: number,
  startDateInput?: string | null
) => {
  const startDate = normalizeDate(startDateInput);
  const lastCheckinDate = getLastTeamCheckinDate(teamId);
  const nextDue = calculateNextDueDate(startDate, cadenceDays, lastCheckinDate);
  const existing = db
    .query("SELECT * FROM checkin_schedules WHERE team_id = ?")
    .get(teamId);

  if (existing) {
    db.prepare(
      "UPDATE checkin_schedules SET cadence_days = ?, start_date = ?, next_due = ? WHERE team_id = ?"
    ).run(cadenceDays, startDate, nextDue, teamId);
    return nextDue;
  } else {
    db.prepare(
      "INSERT INTO checkin_schedules (team_id, cadence_days, start_date, next_due, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(teamId, cadenceDays, startDate, startDate, now());
    return startDate;
  }
};

const listCheckins = (personId: number) => {
  return db
    .query(
      "SELECT * FROM checkins WHERE person_id = ? ORDER BY created_at DESC LIMIT 8"
    )
    .all(personId);
};

const createCheckin = (
  teamId: number,
  personId: number,
  rating: number,
  notes: string | null
) => {
  db.prepare(
    "INSERT INTO checkins (team_id, person_id, rating, notes, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(teamId, personId, rating, notes, now());

  const schedule = getSchedule(teamId);
  if (schedule) {
    const nextDue = calculateNextDueDate(
      schedule.start_date,
      Number(schedule.cadence_days),
      today()
    );
    db.prepare(
      "UPDATE checkin_schedules SET next_due = ? WHERE team_id = ?"
    ).run(nextDue, teamId);
    return nextDue;
  }

  return null;
};

const listTeamCheckins = (teamId: number) => {
  return db
    .query(
      `
      SELECT c.*, p.name as person_name
      FROM checkins c
      JOIN people p ON p.id = c.person_id
      WHERE c.team_id = ?
      ORDER BY c.created_at DESC
      LIMIT 10
      `
    )
    .all(teamId);
};

const listScheduledTeams = () => {
  return db
    .query(
      `
      SELECT
        t.id as team_id,
        t.name as team_name,
        s.start_date as start_date,
        s.cadence_days as cadence_days,
        COUNT(DISTINCT p.id) as people_count,
        MAX(c.created_at) as last_checkin_at
      FROM checkin_schedules s
      JOIN teams t ON t.id = s.team_id
      LEFT JOIN people p ON p.team_id = t.id
      LEFT JOIN checkins c ON c.team_id = t.id
      GROUP BY t.id, s.start_date, s.cadence_days
      ORDER BY t.name
      `
    )
    .all();
};

const getTeamCheckinStats = (teamId: number) => {
  const row = db
    .query(
      `
      SELECT COUNT(*) as total_checkins, AVG(rating) as average_rating
      FROM checkins
      WHERE team_id = ?
      `
    )
    .get(teamId);
  return {
    total_checkins: Number(row?.total_checkins ?? 0),
    average_rating:
      row?.average_rating === null || row?.average_rating === undefined
        ? null
        : Number(row.average_rating),
  };
};

const listDueCheckins = () => {
  const referenceDate = today();
  const rows = listScheduledTeams();
  return rows
    .map(
      (row: {
        team_id: number;
        team_name: string;
        start_date: string;
        cadence_days: number;
        people_count: number;
        last_checkin_at?: string | null;
      }) => {
        const lastCheckinDate = toLocalDate(row.last_checkin_at ?? null);
        const nextDue = calculateNextDueDate(
          row.start_date,
          Number(row.cadence_days),
          lastCheckinDate
        );
        return {
          ...row,
          next_due: nextDue,
          missed_count: calculateMissedCount(
            nextDue,
            Number(row.cadence_days),
            referenceDate
          ),
        };
      }
    )
    .filter((row: { next_due: string }) => row.next_due <= referenceDate)
    .sort((a: { next_due: string }, b: { next_due: string }) =>
      a.next_due.localeCompare(b.next_due)
    );
};

const listUpcomingCheckins = (limit = 3) => {
  const referenceDate = today();
  const rows = listScheduledTeams();
  return rows
    .map(
      (row: {
        team_id: number;
        team_name: string;
        start_date: string;
        cadence_days: number;
        people_count: number;
        last_checkin_at?: string | null;
      }) => {
        const lastCheckinDate = toLocalDate(row.last_checkin_at ?? null);
        const nextDue = calculateNextDueDate(
          row.start_date,
          Number(row.cadence_days),
          lastCheckinDate
        );
        return {
          ...row,
          next_due: nextDue,
        };
      }
    )
    .filter((row: { next_due: string }) => row.next_due > referenceDate)
    .sort((a: { next_due: string }, b: { next_due: string }) =>
      a.next_due.localeCompare(b.next_due)
    )
    .slice(0, limit);
};

const counts = () => {
  const teamCount = db.query("SELECT COUNT(*) as count FROM teams").get();
  const peopleCount = db.query("SELECT COUNT(*) as count FROM people").get();
  const goalCount = db.query("SELECT COUNT(*) as count FROM goals").get();
  const projectCount = db
    .query("SELECT COUNT(*) as count FROM projects")
    .get();
  return {
    teams: Number(teamCount?.count ?? 0),
    people: Number(peopleCount?.count ?? 0),
    goals: Number(goalCount?.count ?? 0),
    projects: Number(projectCount?.count ?? 0),
  };
};

export {
  addDays,
  today,
  listTeams,
  createTeam,
  getTeam,
  listPeopleByTeam,
  createPerson,
  getPerson,
  listGoals,
  createGoal,
  listProjects,
  createProject,
  getSchedule,
  upsertSchedule,
  listCheckins,
  createCheckin,
  listTeamCheckins,
  getTeamCheckinStats,
  listDueCheckins,
  listUpcomingCheckins,
  counts,
};
