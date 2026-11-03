const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  const password = crypto.randomBytes(18).toString('base64url');
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
    .replace(/^JWT_SECRET=$/m, `JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`)
    .replace(/^SERVICE_TOKEN=$/m, `SERVICE_TOKEN=${crypto.randomBytes(48).toString('hex')}`)
    .replace(/^ADMIN_PASSWORD=$/m, `ADMIN_PASSWORD=${password}`);
  fs.writeFileSync(envPath, env, { flag: 'wx', mode: 0o600 });
  console.log('Created the root .env. The generated admin password is stored there; it is not printed to logs.');
}
const python = process.platform === 'win32' ? 'py' : 'python3';
const executable = path.join(root, 'ai_service', '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `Command failed: ${command}`);
    process.exit(result.status || 1);
  }
}
if (!fs.existsSync(executable)) run(python, [...(process.platform === 'win32' ? ['-3.12'] : []), '-m', 'venv', path.join(root, 'ai_service', '.venv')]);
run(executable, ['-m', 'pip', 'install', '-r', path.join(root, 'ai_service', 'requirements.txt')]);
run(process.execPath, [path.join(root, 'backend', 'src', 'db', 'seed.js')]);
console.log('Setup complete. Run npm run dev. Sign in with ADMIN_EMAIL and ADMIN_PASSWORD from the root .env.');
