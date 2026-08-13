import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputFile = join(root, '.private', 'students.json');
const pin = String(process.env.VISTOS_PIN || '');

if (!existsSync(inputFile)) throw new Error('Execute “npm run import:students” primeiro.');
if (!/^\d{6,12}$/.test(pin)) throw new Error('Defina VISTOS_PIN com 6 a 12 números.');

const students = JSON.parse(readFileSync(inputFile, 'utf8'));
const pinHash = createHash('sha256').update(pin).digest('hex');
const params = JSON.stringify([{ pinHash, students }]);
const result = spawnSync('npx', ['--yes', '@google/clasp', 'run', 'bootstrapForCli', '--params', params], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

const combinedOutput = `${result.stdout || ''}${result.stderr || ''}`;
if (result.status !== 0 || /Unable to run script function|Error:/i.test(combinedOutput)) {
  process.stderr.write(combinedOutput);
  process.exit(result.status || 1);
}

process.stdout.write(combinedOutput);
