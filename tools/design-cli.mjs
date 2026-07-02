#!/usr/bin/env node
// design-cli — thin wrapper around the dev panel HTTP API for design work.
//
// Usage:
//   node tools/design-cli.mjs get  npcs
//   node tools/design-cli.mjs get  zones/downtown
//   node tools/design-cli.mjs post npcs '{"name":"..."}'
//   node tools/design-cli.mjs put  items/42 @item.json
//   node tools/design-cli.mjs patch npcs/7/graph @graph.json
//   node tools/design-cli.mjs delete enemies/9
//
// Body may be an inline JSON string, @file.json, or piped via stdin.
// Credentials and base URL come from .env (CLAUDE_MUD_USER/PASS/API).

import 'dotenv/config';
import { readFileSync } from 'fs';

const BASE = process.env.CLAUDE_MUD_API || 'http://localhost:3000/api';
const USER = process.env.CLAUDE_MUD_USER;
const PASS = process.env.CLAUDE_MUD_PASS;

const [verb, path, bodyArg] = process.argv.slice(2);
const VERBS = ['get', 'post', 'put', 'patch', 'delete'];
if (!VERBS.includes(verb) || !path) {
  console.error('Usage: design-cli.mjs <get|post|put|patch|delete> <path> [json|@file]');
  process.exit(1);
}

function readBody() {
  if (bodyArg === undefined) {
    // Allow piped stdin for large payloads
    if (!process.stdin.isTTY) {
      const raw = readFileSync(0, 'utf8').trim();
      return raw ? JSON.parse(raw) : undefined;
    }
    return undefined;
  }
  const raw = bodyArg.startsWith('@') ? readFileSync(bodyArg.slice(1), 'utf8') : bodyArg;
  return JSON.parse(raw);
}

async function login() {
  if (!USER || !PASS) throw new Error('CLAUDE_MUD_USER / CLAUDE_MUD_PASS missing from .env');
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${data.error}`);
  return data.token;
}

const token = await login();
const body = readBody();
const res = await fetch(`${BASE}/${path.replace(/^\//, '')}`, {
  method: verb.toUpperCase(),
  headers: {
    Authorization: `Bearer ${token}`,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const text = await res.text();
let out;
try { out = JSON.stringify(JSON.parse(text), null, 2); } catch { out = text; }
console.log(out);
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}
