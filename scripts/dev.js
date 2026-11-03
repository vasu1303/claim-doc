const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, '.env'))) throw new Error('Run npm install and npm run setup first.');
require(path.join(root, 'node_modules', 'dotenv')).config({ path: path.join(root, '.env') });
const python = path.join(root, 'ai_service', '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
if (!fs.existsSync(python)) throw new Error('Python environment missing. Run npm run setup.');
const commands = [
  [process.execPath, [path.join(root, 'backend', 'src', 'index.js')], root],
  [process.execPath, [path.join(root, 'messenger', 'src', 'index.js')], root],
  [python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', process.env.AI_PORT || '8001', '--no-access-log'], path.join(root, 'ai_service')],
  [process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--webpack', '-p', '3000', '-H', '127.0.0.1'], path.join(root, 'frontend')],
];
let stopping = false;
const children = commands.map(([command, args, cwd]) => spawn(command, args, { cwd, stdio: 'inherit', env: process.env }));
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (err) => { console.error('Service failed to start:', err.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code || 1); });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
