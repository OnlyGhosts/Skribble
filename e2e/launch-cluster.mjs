#!/usr/bin/env node
/**
 * Starts what the multi-instance e2e spec needs: a throw-away redis-server and two Skribble
 * instances (PORT 4181 and 4182) sharing it through REDIS_URL. Playwright runs this as a
 * webServer command and kills it afterwards; every child goes down with it.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const REDIS_PORT = Number(process.env.E2E_REDIS_PORT ?? 6479);
const PORTS = [4181, 4182];
const SERVER = 'dist/server/index.js';

if (!existsSync(SERVER)) {
  console.error(`[cluster] ${SERVER} is missing; run "npm run build" first`);
  process.exit(1);
}

const children = [];
let stopping = false;

function start(label, command, args, env = {}) {
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[cluster] ${label} exited (${signal ?? code}); stopping the cluster`);
    stop(1);
  });
  child.on('error', (err) => {
    console.error(`[cluster] ${label} failed to start: ${err.message}`);
    stop(1);
  });
  return child;
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  const exits = children.map((child) => new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve))));
  for (const child of children) child.kill('SIGTERM');
  const force = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 3000);
  Promise.all(exits).then(() => {
    clearTimeout(force);
    process.exit(code);
  });
}

start('redis-server', 'redis-server', ['--port', String(REDIS_PORT), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--loglevel', 'warning']);
for (const port of PORTS) {
  start(`server:${port}`, process.execPath, [SERVER], { PORT: String(port), REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}` });
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
process.on('SIGHUP', () => stop(0));
