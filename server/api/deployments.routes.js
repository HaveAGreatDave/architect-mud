// Deploy history for the dev panel. CI's deploy-content workflow writes one
// `deployments` row per content deploy (deployed_by 'ci', the sha in
// changes_summary); nothing on the server writes the table.
//
// This file was staging.routes.js until 2026-10-17. Dev-panel staging went then:
// prod is read-only and local saves write content/ files directly, so a review
// queue in front of the local DB protected nothing, and its publish path skipped
// the file sync.

import { query } from '../models/db.js';

const DEV_ROLES = ['dev', 'admin', 'builder', 'designer'];

export async function handleDeploymentsApi(path, method, body, auth) {
  if (path !== '/deployments' && path !== '/deployments/latest') return null;
  if (method !== 'GET') return null;
  if (!auth || !DEV_ROLES.includes(auth.role)) {
    return { status: 403, body: { error: 'Dev access required' } };
  }
  return path === '/deployments' ? getDeployments() : getLatestDeployAt();
}

// The dashboard's deploy clock polls this once a minute and only reads the timestamp, so it
// skips changes_summary. The Backups panel's list uses getDeployments.
async function getLatestDeployAt() {
  const { rows } = await query('SELECT deployed_at FROM deployments ORDER BY deployed_at DESC LIMIT 1');
  return { status: 200, body: { deployments: rows.map(r => ({ deployedAt: r.deployed_at })) } };
}

async function getDeployments() {
  const { rows } = await query('SELECT * FROM deployments ORDER BY deployed_at DESC LIMIT 3');
  return {
    status: 200,
    body: {
      deployments: rows.map(r => ({
        id: r.id,
        deployedAt: r.deployed_at,
        deployedBy: r.deployed_by,
        changeCount: r.change_count,
        changes: r.changes_summary || [],
      })),
    },
  };
}
