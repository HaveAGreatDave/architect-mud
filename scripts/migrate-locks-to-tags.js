/**
 * Migration Script: Square legacy locks and install kits into the unified tag system.
 * * Version: 1.1.0 (PostgreSQL JSONB Compatible)
 * Architecture Alignments: 
 * - ADR-0001: Canonical Mutation Paths
 * - ADR-0003: Tag Mechanism Unification
 * * Run via: node scripts/migrate-locks-to-tags.js
 */

import { query } from '../server/models/db.js';
import { Tags } from '../server/engine/tags.js';

async function migrateLocksAndKits() {
  console.log("=====================================================");
  console.log("⚡ STARTING POSTGRES LOCK & KIT TAG MIGRATION... ⚡");
  console.log("=====================================================");

  try {
    // Fetch all entities utilizing Postgres JSONB operator paths
    const result = await query(`
      SELECT id, data
      FROM entities
      WHERE
        data->>'legacy_lock_type' IS NOT NULL
        OR data->>'item_type' = 'lockinstallkit'
    `);

    const entities = result.rows;
    console.log(`[INFO] Found ${entities.length} potential candidates for migration.`);
    let migratedCount = 0;

    for (const row of entities) {
      let entity = row.data; // Native JSONB parsing from pool query
      let isMutated = false;
      const id = row.id;

      // --- 1. HANDLE LEGACY LOCKS ---
      if (entity.legacy_lock_type) {
        const lockType = entity.legacy_lock_type;
        const tagId = `lock:${lockType}`;

        console.log(`[MIGRATE] Entity ${id}: Converting legacy lock -> ${tagId}`);

        const preservedMetadata = {
          passcode: entity.passcode ?? null,
          key_code: entity.key_code ?? null,
          complexity: entity.complexity ?? 1,
          security_level: entity.security_level ?? "low"
        };

        // Inject using unified state rules engine
        Tags.add(entity, tagId, preservedMetadata);

        if (entity.is_locked) {
          Tags.add(entity, 'door_locked');
        } else {
          Tags.add(entity, 'door_closed');
        }

        // Drop historical document clutter
        delete entity.legacy_lock_type;
        delete entity.passcode;
        delete entity.key_code;
        delete entity.complexity;
        delete entity.security_level;
        delete entity.is_locked;

        isMutated = true;
      }

      // --- 2. HANDLE INSTALL KITS ---
      if (entity.item_type === "lockinstallkit") {
        const kitType = entity.kit_lock_type;
        const tagId = `kit:install_lock`;

        console.log(`[MIGRATE] Item ${id}: Converting install kit -> ${tagId}`);

        const kitMetadata = {
          targetLockType: `lock:${kitType}`,
          uses: entity.uses ?? 1,
          req_skill: entity.req_skill ?? "mechanics"
        };

        Tags.add(entity, tagId, kitMetadata);

        // Strip legacy variables
        delete entity.kit_lock_type;
        delete entity.uses;
        delete entity.req_skill;

        isMutated = true;
      }

      // --- COMMIT BACK TO DATABASE ---
      if (isMutated) {
        await query(
          `UPDATE entities
           SET data = $1
           WHERE id = $2`,
          [JSON.stringify(entity), id]
        );

        migratedCount++;
      }
    }

    console.log("=====================================================");
    console.log(`✅ SUCCESS: Migrated and saved ${migratedCount} entities.`);
    console.log("=====================================================");
  } catch (error) {
    console.error("❌ CRITICAL ERROR DURING MIGRATION EXECUTION:", error);
    process.exit(1);
  }
}

migrateLocksAndKits().catch(console.error);
