// Which class runs which table.
//
// `game_tables.game_type` used to be stored and never read — every row became a
// poker felt regardless. This is the one place that decides, so adding a third
// game means adding a line here and nothing else.

import { query } from '../../server/models/db.js';
import { activeTables } from './table-base.js';
import { GameTable } from './game-table.js';
import { ChessTable } from './chess-table.js';

export const TABLE_CLASSES = {
  holdem: GameTable,
  chess: ChessTable,
};

// An unknown game_type falls back to poker rather than throwing: a typo in a
// content file should cost you the right game, not the whole plugin boot.
export function tableClassFor(gameType) {
  return TABLE_CLASSES[gameType] || GameTable;
}

export async function loadAllTables() {
  const { rows } = await query('SELECT * FROM game_tables');
  for (const row of rows) {
    if (activeTables.has(row.id)) continue;
    const Klass = tableClassFor(row.game_type);
    new Klass(row);
  }
}

export function chessTables() {
  return [...activeTables.values()].filter(t => t instanceof ChessTable);
}

export { activeTables };
