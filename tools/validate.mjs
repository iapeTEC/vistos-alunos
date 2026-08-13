import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html', 'dashboard.html', 'config.js', 'manifest.webmanifest', 'sw.js',
  'assets/app.js', 'assets/scanner.js', 'assets/dashboard.js', 'assets/styles.css',
  'vendor/html5-qrcode.min.js', 'apps-script/Code.gs', 'apps-script/appsscript.json'
];

const failures = [];
required.forEach((file) => {
  if (!existsSync(join(root, file))) failures.push(`Arquivo ausente: ${file}`);
});

const config = existsSync(join(root, 'config.js')) ? readFileSync(join(root, 'config.js'), 'utf8') : '';
if (config.includes('APP_SCRIPT_URL_AQUI')) failures.push('config.js ainda não contém a URL publicada do Apps Script.');

for (const file of ['config.js', 'sw.js', 'assets/app.js', 'assets/scanner.js', 'assets/dashboard.js', 'tools/import-rosters.mjs', 'tools/generate-qr-pdfs.mjs', 'tools/bootstrap-appscript.mjs']) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`Erro de sintaxe em ${file}: ${result.stderr.trim()}`);
}

const backendCheck = spawnSync(process.execPath, ['--check'], {
  input: readFileSync(join(root, 'apps-script', 'Code.gs'), 'utf8'),
  encoding: 'utf8'
});
if (backendCheck.status !== 0) failures.push(`Erro de sintaxe em apps-script/Code.gs: ${backendCheck.stderr.trim()}`);

const privateFile = join(root, '.private', 'students.json');
if (!existsSync(privateFile)) {
  failures.push('Dados privados dos alunos ainda não foram importados.');
} else {
  const students = JSON.parse(readFileSync(privateFile, 'utf8'));
  const expected = { '4º Ano': 13, '6º Ano': 32, '7º Ano': 24, '8º Ano': 36 };
  if (students.length !== 105) failures.push(`Total de alunos incorreto: ${students.length}.`);
  for (const [className, count] of Object.entries(expected)) {
    const actual = students.filter((student) => student.className === className).length;
    if (actual !== count) failures.push(`${className}: ${actual} alunos, esperado ${count}.`);
  }
  if (new Set(students.map((student) => student.ra)).size !== students.length) failures.push('Há RAs duplicados.');
  if (new Set(students.map((student) => student.qrToken)).size !== students.length) failures.push('Há tokens QR duplicados.');

  const publicFiles = [];
  function walk(directory) {
    for (const name of readdirSync(directory)) {
      if (['.git', '.private', 'node_modules', 'pdf-output'].includes(name)) continue;
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (['.html', '.js', '.mjs', '.css', '.json', '.md', '.txt', '.gs'].includes(extname(path))) publicFiles.push(path);
    }
  }
  walk(root);
  const publicText = publicFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const student of students) {
    if (publicText.includes(student.name) || publicText.includes(student.qrToken)) {
      failures.push(`Dados pessoais vazaram em arquivo público: ${student.ra}.`);
      break;
    }
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join('\n'));
  process.exit(1);
}

console.log('✓ Estrutura do app válida');
console.log('✓ JavaScript sem erros de sintaxe');
console.log('✓ 105 alunos e tokens únicos');
console.log('✓ Nenhum nome ou token de aluno nos arquivos públicos');
