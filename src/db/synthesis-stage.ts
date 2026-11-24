import { createDatabase, type SqliteDatabase } from './sqlite-adapter';
import { QueryBuilder } from './queries';
import { createYielder } from '../resolution/cooperative-yield';

// Ownership is independent of provenance: Go method containment is structural.
export const SYNTHESIZED_EDGE = "CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.synthesizedBy') END IS NOT NULL";

export interface SynthesisScope {
  filePaths: string[];
  names: string[];
}

/** A private edge overlay: passes see base edges plus their new Go prerequisites. */
export class SynthesisStage {
  readonly db: SqliteDatabase;
  readonly queries: QueryBuilder;

  constructor(dbPath: string, private readonly scope?: SynthesisScope) {
    this.db = createDatabase(dbPath).db;
    try {
      this.db.pragma('busy_timeout = 5000');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('wal_autocheckpoint = 0');
      const keepUnaffectedSynthesis = scope ? ` OR NOT (${this.affectedEdgeSql('e')})` : '';
      this.db.exec(`
        CREATE TEMP TABLE synthesis_inputs (file_path TEXT PRIMARY KEY);
        CREATE TEMP TABLE synthesis_scope_files (file_path TEXT PRIMARY KEY);
        CREATE TEMP TABLE synthesis_scope_names (name TEXT PRIMARY KEY);
        CREATE TEMP TABLE synthesis_edges (
          id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT,
          metadata TEXT, line INTEGER, col INTEGER, provenance TEXT
        );
        CREATE UNIQUE INDEX temp.synthesis_identity ON synthesis_edges
          (source, target, kind, IFNULL(line, -1), IFNULL(col, -1));
        CREATE INDEX temp.synthesis_source ON synthesis_edges(source, kind);
        CREATE INDEX temp.synthesis_target ON synthesis_edges(target, kind);
        CREATE TEMP VIEW edges AS
          SELECT e.* FROM main.edges e WHERE NOT COALESCE((CASE WHEN json_valid(e.metadata) THEN json_extract(e.metadata, '$.synthesizedBy') END IS NOT NULL), 0)
            ${keepUnaffectedSynthesis}
          UNION ALL SELECT * FROM synthesis_edges;
        CREATE TEMP TRIGGER synthesis_insert INSTEAD OF INSERT ON edges BEGIN
          INSERT OR IGNORE INTO synthesis_edges
            (source, target, kind, metadata, line, col, provenance)
          SELECT NEW.source, NEW.target, NEW.kind, NEW.metadata, NEW.line, NEW.col, NEW.provenance
          WHERE NOT EXISTS (
            SELECT 1 FROM main.edges WHERE source = NEW.source AND target = NEW.target
              AND kind = NEW.kind AND IFNULL(line, -1) = IFNULL(NEW.line, -1)
              AND IFNULL(col, -1) = IFNULL(NEW.col, -1)
              AND NOT COALESCE((${SYNTHESIZED_EDGE}), 0)
          );
        END;
      `);
      if (scope) {
        const insertFile = this.db.prepare('INSERT OR IGNORE INTO synthesis_scope_files(file_path) VALUES (?)');
        const insertName = this.db.prepare('INSERT OR IGNORE INTO synthesis_scope_names(name) VALUES (?)');
        for (const filePath of scope.filePaths) insertFile.run(filePath);
        for (const name of scope.names) insertName.run(name);
      }
      this.queries = new QueryBuilder(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  async publish(backpressure?: () => Promise<void> | null): Promise<void> {
    await backpressure?.();
    const yieldToLoop = createYielder();
    // Keep the replacement atomic for other connections. Yield between bounded
    // writes, but checkpoint only OUTSIDE this transaction (uncommitted frames
    // cannot be folded). Pass execution/staging above never writes the main WAL.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const remove = this.db.prepare(this.scope
        ? `DELETE FROM main.edges WHERE id IN (
            SELECT e.id FROM main.edges e
             WHERE COALESCE((CASE WHEN json_valid(e.metadata) THEN json_extract(e.metadata, '$.synthesizedBy') END IS NOT NULL), 0)
               AND (${this.affectedEdgeSql('e')}) LIMIT 2000
          )`
        : `DELETE FROM main.edges WHERE id IN (
            SELECT id FROM main.edges WHERE ${SYNTHESIZED_EDGE} LIMIT 2000
          )`);
      while (remove.run().changes > 0) await yieldToLoop();
      const insert = this.db.prepare(`INSERT OR IGNORE INTO main.edges
        (source, target, kind, metadata, line, col, provenance)
        SELECT source, target, kind, metadata, line, col, provenance
        FROM synthesis_edges WHERE id > ? AND id <= ?`);
      const max = this.db.prepare('SELECT MAX(id) AS id FROM synthesis_edges').get()?.id ?? 0;
      for (let i = 0; i < max; i += 2000) {
        insert.run(i, i + 2000);
        await yieldToLoop();
      }
      if (this.scope) {
        this.db.exec(`DELETE FROM main.synthesis_inputs
          WHERE file_path IN (SELECT file_path FROM temp.synthesis_scope_files);
          INSERT OR IGNORE INTO main.synthesis_inputs SELECT * FROM temp.synthesis_inputs`);
      } else {
        this.db.exec(`DELETE FROM main.synthesis_inputs;
          INSERT INTO main.synthesis_inputs SELECT * FROM temp.synthesis_inputs`);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    await backpressure?.();
  }

  close(): void {
    this.db.close();
  }

  private affectedEdgeSql(alias: string): string {
    const registration = `CASE WHEN json_valid(${alias}.metadata) THEN json_extract(${alias}.metadata, '$.registeredAt') END`;
    return `
      EXISTS (SELECT 1 FROM main.nodes n JOIN temp.synthesis_scope_files s ON s.file_path = n.file_path WHERE n.id = ${alias}.source OR n.id = ${alias}.target)
      OR EXISTS (SELECT 1 FROM main.nodes n JOIN temp.synthesis_scope_names s ON s.name = n.name WHERE n.id = ${alias}.source OR n.id = ${alias}.target)
      OR EXISTS (SELECT 1 FROM temp.synthesis_scope_files s WHERE substr(${registration}, 1, length(s.file_path) + 1) = s.file_path || ':')
    `;
  }
}
