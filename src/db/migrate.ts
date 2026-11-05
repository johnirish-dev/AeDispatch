import type { Db } from "./connection";
import { MIGRATIONS, Migration } from "./migrations";

/** Applies any migration that has not run yet. Returns the names it applied. */
export function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)");
  const done = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name),
  );

  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(m.name);
    })();
    applied.push(m.name);
  }
  return applied;
}
