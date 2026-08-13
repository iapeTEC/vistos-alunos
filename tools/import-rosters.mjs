import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateDir = join(root, '.private');
const outputFile = join(privateDir, 'students.json');
const documents = join(homedir(), 'Documents');
const sources = [
  { file: join(documents, '4 Ano Alunos.pdf'), className: '4º Ano', expected: 13 },
  { file: join(documents, '6 Ano Alunos.pdf'), className: '6º Ano', expected: 32 },
  { file: join(documents, '7 Ano Alunos.pdf'), className: '7º Ano', expected: 24 },
  { file: join(documents, '8 Ano Alunos.pdf'), className: '8º Ano', expected: 36 }
];

const previous = existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, 'utf8')) : [];
const previousTokens = new Map(previous.map((student) => [student.ra, student.qrToken]));
const students = [];

for (const source of sources) {
  if (!existsSync(source.file)) throw new Error(`Lista não encontrada: ${source.file}`);
  const text = execFileSync('pdftotext', ['-layout', source.file, '-'], { encoding: 'utf8' });
  const roster = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{6})\s+(.+?)\s{2,}(?:Rematrícula|Aluno Novo)\s{2,}Matriculado\s*$/u);
    if (!match) continue;
    const ra = match[1];
    const name = match[2].trim().replace(/\s+/g, ' ');
    roster.push({
      ra,
      name,
      className: source.className,
      qrToken: previousTokens.get(ra) || randomBytes(16).toString('hex')
    });
  }

  if (roster.length !== source.expected) {
    throw new Error(`${source.className}: esperados ${source.expected} alunos, encontrados ${roster.length}.`);
  }
  students.push(...roster);
}

const ras = new Set(students.map((student) => student.ra));
const tokens = new Set(students.map((student) => student.qrToken));
if (ras.size !== students.length) throw new Error('Há RAs duplicados nas listas.');
if (tokens.size !== students.length) throw new Error('Há tokens QR duplicados.');

mkdirSync(privateDir, { recursive: true, mode: 0o700 });
writeFileSync(outputFile, `${JSON.stringify(students, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

const summary = Object.fromEntries(sources.map((source) => [source.className, students.filter((student) => student.className === source.className).length]));
console.log(`Importação concluída: ${students.length} alunos.`);
console.log(summary);
console.log(`Dados privados: ${outputFile}`);
