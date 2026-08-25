/**
 * Vistos — API Google Apps Script
 *
 * O frontend público nunca contém a lista de alunos. Os dados vivem no
 * armazenamento privado do próprio projeto Apps Script.
 */

const APP = Object.freeze({
  version: '1.0.0',
  timeZone: 'America/Recife',
  sessionSeconds: 21600,
  properties: Object.freeze({
    authHash: 'VISTOS_AUTH_HASH',
    authVersion: 'VISTOS_AUTH_VERSION',
    ownerEmail: 'VISTOS_OWNER_EMAIL',
    pinReset: 'VISTOS_PIN_RESET',
    bootstrappedAt: 'VISTOS_BOOTSTRAPPED_AT',
    students: 'DATA_STUDENTS',
    rounds: 'DATA_ROUNDS',
    marksPrefix: 'DATA_MARKS_'
  })
});

// Substituído por um segredo temporário somente durante a carga inicial.
const BOOTSTRAP_SECRET = 'BOOTSTRAP_DISABLED';

/** Endpoint JSON/JSONP consumido pelo GitHub Pages. */
function doGet(event) {
  const params = (event && event.parameter) || {};
  const callback = String(params.callback || '').trim();
  let payload;

  try {
    payload = { ok: true, data: dispatch_(params) };
  } catch (error) {
    console.error(error);
    payload = {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Não foi possível concluir a solicitação.'
      }
    };
  }

  const json = JSON.stringify(payload);
  if (callback) {
    if (!isValidCallback_(callback)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: { code: 'INVALID_CALLBACK', message: 'Callback inválido.' } }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/** Endpoint usado uma única vez na instalação; não é consumido pelo app. */
function doPost(event) {
  let payload;
  try {
    const body = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    if (body.action !== 'bootstrap') throw appError_('UNKNOWN_ACTION', 'Ação desconhecida.');
    payload = { ok: true, data: bootstrapFromWeb_(body) };
  } catch (error) {
    console.error(error);
    payload = {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Não foi possível concluir a configuração.'
      }
    };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(params) {
  const action = String(params.action || 'health').trim();

  if (action === 'health') return health_();
  if (action === 'login') return login_(params.pinHash);

  const session = requireSession_(params.session);
  const actions = {
    me: () => me_(session),
    logout: () => logout_(params.session),
    snapshot: () => snapshot_(),
    dashboard: () => dashboard_(params.turma),
    studentDetails: () => studentDetails_(params.ra),
    createRound: () => createRound_(params.turma, params.title),
    closeRound: () => closeRound_(params.roundId),
    cancelRound: () => cancelRound_(params.roundId),
    registerMark: () => registerMark_(params.roundId, params.qr, params.ra, params.device),
    undoMark: () => undoMark_(params.markId),
    changePin: () => changePin_(params.newPinHash, params.session)
  };

  if (!actions[action]) throw appError_('UNKNOWN_ACTION', 'Ação desconhecida.');
  return actions[action]();
}

function health_() {
  const props = PropertiesService.getScriptProperties();
  return {
    app: 'Vistos',
    version: APP.version,
    configured: Boolean(props.getProperty(APP.properties.students + '__COUNT') && props.getProperty(APP.properties.authHash)),
    serverTime: formatDate_(new Date())
  };
}

function login_(pinHash) {
  const normalizedHash = String(pinHash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
    throw appError_('INVALID_CREDENTIALS', 'PIN inválido.');
  }

  const props = PropertiesService.getScriptProperties();
  const expectedHash = props.getProperty(APP.properties.authHash);
  if (!expectedHash) throw appError_('NOT_CONFIGURED', 'O sistema ainda não foi configurado.');

  const cache = CacheService.getScriptCache();
  const failureKey = 'login-fail:' + normalizedHash.slice(0, 16);
  const failures = Number(cache.get(failureKey) || 0);
  if (failures >= 5) throw appError_('TOO_MANY_ATTEMPTS', 'Muitas tentativas. Aguarde 5 minutos.');

  if (!safeEquals_(normalizedHash, expectedHash)) {
    cache.put(failureKey, String(failures + 1), 300);
    throw appError_('INVALID_CREDENTIALS', 'PIN incorreto.');
  }

  cache.remove(failureKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const authVersion = props.getProperty(APP.properties.authVersion) || '1';
  cache.put(
    'session:' + token,
    JSON.stringify({ createdAt: new Date().toISOString(), authVersion: authVersion }),
    APP.sessionSeconds
  );

  return { token: token, expiresIn: APP.sessionSeconds };
}

function requireSession_(token) {
  const normalized = String(token || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(normalized)) throw appError_('UNAUTHORIZED', 'Sessão expirada. Entre novamente.');

  const cache = CacheService.getScriptCache();
  const raw = cache.get('session:' + normalized);
  if (!raw) throw appError_('UNAUTHORIZED', 'Sessão expirada. Entre novamente.');

  const session = JSON.parse(raw);
  const authVersion = PropertiesService.getScriptProperties().getProperty(APP.properties.authVersion) || '1';
  if (session.authVersion !== authVersion) throw appError_('UNAUTHORIZED', 'Sessão expirada. Entre novamente.');

  cache.put('session:' + normalized, raw, APP.sessionSeconds);
  return session;
}

function logout_(token) {
  CacheService.getScriptCache().remove('session:' + String(token || ''));
  return { loggedOut: true };
}

function me_() {
  const snapshot = snapshot_();
  return {
    authenticated: true,
    version: APP.version,
    activeRound: snapshot.activeRound,
    classes: snapshot.classes
  };
}

function snapshot_() {
  const students = readStudents_();
  const activeRound = readRounds_().filter((round) => round.status === 'ATIVA').sort(sortNewest_)[0] || null;
  const classes = Array.from(new Set(students.filter((student) => student.active).map((student) => student.className))).sort(sortClasses_);

  return {
    activeRound: activeRound,
    classes: classes,
    students: students.filter((student) => student.active).map((student) => ({
      ra: student.ra,
      name: student.name,
      className: student.className
    })),
    recentMarks: recentMarks_(12)
  };
}

function dashboard_(className) {
  const wantedClass = normalizeClass_(className, true);
  const allStudents = readStudents_().filter((student) => student.active);
  const students = wantedClass ? allStudents.filter((student) => student.className === wantedClass) : allStudents;
  const rounds = readRounds_().filter((round) => round.status !== 'CANCELADA');
  const marks = readMarks_();
  const roundById = {};
  rounds.forEach((round) => { roundById[round.id] = round; });

  const markCounts = {};
  marks.forEach((mark) => {
    if (roundById[mark.roundId]) markCounts[mark.ra] = (markCounts[mark.ra] || 0) + 1;
  });

  const roundCounts = {};
  rounds.forEach((round) => { roundCounts[round.className] = (roundCounts[round.className] || 0) + 1; });

  const rows = students.map((student) => {
    const expected = roundCounts[student.className] || 0;
    const received = markCounts[student.ra] || 0;
    return {
      ra: student.ra,
      name: student.name,
      className: student.className,
      received: received,
      expected: expected,
      grade: expected ? roundNumber_((received / expected) * 10, 1) : null,
      percentage: expected ? Math.round((received / expected) * 100) : 0
    };
  }).sort((a, b) => sortClasses_(a.className, b.className) || a.name.localeCompare(b.name, 'pt-BR'));

  const grades = rows.filter((row) => row.grade !== null).map((row) => row.grade);
  const today = Utilities.formatDate(new Date(), APP.timeZone, 'yyyy-MM-dd');
  const todayMarks = marks.filter((mark) => Utilities.formatDate(mark.date, APP.timeZone, 'yyyy-MM-dd') === today).length;

  return {
    generatedAt: formatDate_(new Date()),
    selectedClass: wantedClass || '',
    classes: Array.from(new Set(allStudents.map((student) => student.className))).sort(sortClasses_),
    activeRound: rounds.filter((round) => round.status === 'ATIVA').sort(sortNewest_)[0] || null,
    summary: {
      students: rows.length,
      rounds: wantedClass ? (roundCounts[wantedClass] || 0) : rounds.length,
      todayMarks: todayMarks,
      averageGrade: grades.length ? roundNumber_(grades.reduce((sum, grade) => sum + grade, 0) / grades.length, 1) : null
    },
    students: rows
  };
}

function studentDetails_(ra) {
  const normalizedRa = normalizeRa_(ra);
  const student = readStudents_().find((item) => item.ra === normalizedRa);
  if (!student) throw appError_('STUDENT_NOT_FOUND', 'Aluno não encontrado.');

  const rounds = readRounds_().filter((round) => round.className === student.className && round.status !== 'CANCELADA');
  const markRoundIds = new Set(readMarks_().filter((mark) => mark.ra === normalizedRa).map((mark) => mark.roundId));

  return {
    student: { ra: student.ra, name: student.name, className: student.className },
    history: rounds.sort(sortNewest_).map((round) => ({
      id: round.id,
      number: round.number,
      title: round.title,
      createdAt: round.createdAt,
      received: markRoundIds.has(round.id)
    }))
  };
}

function createRound_(className, title) {
  const normalizedClass = normalizeClass_(className);
  const normalizedTitle = String(title || '').trim().slice(0, 80) || 'Atividade';
  const validClasses = new Set(readStudents_().filter((student) => student.active).map((student) => student.className));
  if (!validClasses.has(normalizedClass)) throw appError_('INVALID_CLASS', 'Turma inválida.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    closeActiveRounds_();
    const rounds = readRoundRecords_();
    const number = rounds.filter((round) => round.className === normalizedClass && round.status !== 'CANCELADA').length + 1;
    const now = new Date();
    const id = Utilities.getUuid();
    const round = {
      id: id,
      number: number,
      className: normalizedClass,
      title: normalizedTitle,
      createdAt: formatDate_(now),
      closedAt: '',
      status: 'ATIVA',
      marksCount: 0
    };
    rounds.push(round);
    saveRounds_(rounds);
    return round;
  } finally {
    lock.releaseLock();
  }
}

function closeRound_(roundId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rounds = readRoundRecords_();
    const round = rounds.find((item) => item.id === String(roundId || ''));
    if (!round) throw appError_('ROUND_NOT_FOUND', 'Atividade não encontrada.');
    if (round.status === 'CANCELADA') throw appError_('ROUND_CANCELLED', 'A atividade foi cancelada.');
    round.closedAt = formatDate_(new Date());
    round.status = 'ENCERRADA';
    saveRounds_(rounds);
    return { closed: true };
  } finally {
    lock.releaseLock();
  }
}

function cancelRound_(roundId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rounds = readRoundRecords_();
    const round = rounds.find((item) => item.id === String(roundId || ''));
    if (!round) throw appError_('ROUND_NOT_FOUND', 'Atividade não encontrada.');
    round.closedAt = formatDate_(new Date());
    round.status = 'CANCELADA';
    saveRounds_(rounds);
    deleteCompressed_(marksKey_(round.id));
    return { cancelled: true };
  } finally {
    lock.releaseLock();
  }
}

function registerMark_(roundId, qr, ra, device) {
  const normalizedRoundId = String(roundId || '').trim();
  const qrToken = normalizeQrToken_(qr);
  const normalizedRa = ra ? normalizeRa_(ra) : '';
  if (!qrToken && !normalizedRa) throw appError_('INVALID_QR', 'QR code inválido.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const round = readRoundRecords_().find((item) => item.id === normalizedRoundId);
    if (!round) throw appError_('ROUND_NOT_FOUND', 'Atividade não encontrada.');
    if (round.status !== 'ATIVA') throw appError_('ROUND_CLOSED', 'Esta atividade já foi encerrada.');

    const student = readStudents_().find((item) => item.active && (qrToken ? item.qrToken === qrToken : item.ra === normalizedRa));
    if (!student) throw appError_('STUDENT_NOT_FOUND', 'QR code não reconhecido.');
    if (student.className !== round.className) {
      throw appError_('WRONG_CLASS', student.name + ' pertence ao ' + student.className + '.');
    }

    const roundMarks = readRoundMarks_(round.id);
    const existing = roundMarks.find((mark) => mark.ra === student.ra);
    if (existing) {
      return {
        duplicate: true,
        markId: existing.id,
        student: publicStudent_(student),
        round: round,
        roundMarks: roundMarks.length
      };
    }

    const now = new Date();
    const markId = Utilities.getUuid();
    roundMarks.push({
      id: markId,
      roundId: round.id,
      ra: student.ra,
      date: now.toISOString(),
      device: String(device || '').trim().slice(0, 120)
    });
    writeCompressed_(marksKey_(round.id), roundMarks);

    return {
      duplicate: false,
      markId: markId,
      student: publicStudent_(student),
      round: round,
      registeredAt: formatDate_(now),
      roundMarks: roundMarks.length
    };
  } finally {
    lock.releaseLock();
  }
}

function undoMark_(markId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const mark = readMarks_().find((item) => item.id === String(markId || ''));
    if (!mark) throw appError_('MARK_NOT_FOUND', 'Visto não encontrado.');
    const roundMarks = readRoundMarks_(mark.roundId).filter((item) => item.id !== mark.id);
    writeCompressed_(marksKey_(mark.roundId), roundMarks);
    return { undone: true, roundId: mark.roundId, ra: mark.ra };
  } finally {
    lock.releaseLock();
  }
}

function changePin_(newPinHash, currentToken) {
  const normalizedHash = String(newPinHash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) throw appError_('INVALID_PIN', 'O novo PIN é inválido.');

  const props = PropertiesService.getScriptProperties();
  const nextVersion = Utilities.getUuid();
  props.setProperties({
    [APP.properties.authHash]: normalizedHash,
    [APP.properties.authVersion]: nextVersion
  });
  CacheService.getScriptCache().remove('session:' + String(currentToken || ''));
  return { changed: true };
}

/**
 * Reset manual do PIN, executavel somente pelo proprietario autorizado no
 * editor do Apps Script. Defina VISTOS_OWNER_EMAIL e VISTOS_PIN_RESET nas
 * Script Properties, execute uma vez e remova VISTOS_PIN_RESET em seguida.
 */
function resetPinForOwner() {
  const props = PropertiesService.getScriptProperties();
  const ownerEmail = String(props.getProperty(APP.properties.ownerEmail) || '').toLowerCase().trim();
  const newPin = String(props.getProperty(APP.properties.pinReset) || '').trim();
  const email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase().trim();

  if (!ownerEmail || email !== ownerEmail) throw new Error('Conta não autorizada para resetar o PIN.');
  if (!/^\d{6,12}$/.test(newPin)) {
    throw new Error('Defina VISTOS_PIN_RESET com 6 a 12 números nas Script Properties.');
  }

  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    newPin,
    Utilities.Charset.UTF_8
  );
  const hash = bytes.map((byte) => {
    const value = byte < 0 ? byte + 256 : byte;
    return value.toString(16).padStart(2, '0');
  }).join('');

  props.setProperties({
    [APP.properties.authHash]: hash,
    [APP.properties.authVersion]: Utilities.getUuid()
  });
  props.deleteProperty(APP.properties.pinReset);
  CacheService.getScriptCache().removeAll([]);
  return 'PIN redefinido com sucesso e valor temporario removido.';
}

function bootstrapForCli(payload) {
  return bootstrapState_(payload);
}

function bootstrapFromWeb_(payload) {
  if (BOOTSTRAP_SECRET === 'BOOTSTRAP_DISABLED' || !safeEquals_(payload.setupSecret, BOOTSTRAP_SECRET)) {
    throw appError_('UNAUTHORIZED', 'Configuração não autorizada.');
  }
  return bootstrapState_(payload);
}

function bootstrapState_(payload) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(APP.properties.authHash)) throw new Error('O sistema já foi configurado.');
  if (!payload || !/^[a-f0-9]{64}$/i.test(String(payload.pinHash || ''))) throw new Error('Hash do PIN inválido.');

  const students = validateSeedStudents_(payload.students || []);
  if (!students.length) throw new Error('Nenhum aluno foi informado.');
  const now = new Date();
  const records = students.map((student) => ({ ...student, active: true }));
  clearDataStore_();
  writeCompressed_(APP.properties.students, records);
  writeCompressed_(APP.properties.rounds, []);

  const authVersion = Utilities.getUuid();
  props.setProperties({
    [APP.properties.authHash]: String(payload.pinHash).toLowerCase(),
    [APP.properties.authVersion]: authVersion,
    [APP.properties.bootstrappedAt]: now.toISOString()
  });

  return {
    configured: true,
    storage: 'Apps Script Properties',
    students: records.length
  };
}

function validateSeedStudents_(students) {
  if (!Array.isArray(students) || students.length > 500) throw new Error('Lista de alunos inválida.');
  const seenRa = new Set();
  const seenTokens = new Set();

  return students.map((item) => {
    const student = {
      ra: normalizeRa_(item.ra),
      name: String(item.name || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      className: normalizeClass_(item.className),
      qrToken: normalizeQrToken_(item.qrToken)
    };
    if (!student.name || !student.qrToken) throw new Error('Aluno com dados incompletos.');
    if (seenRa.has(student.ra)) throw new Error('RA duplicado: ' + student.ra);
    if (seenTokens.has(student.qrToken)) throw new Error('Token QR duplicado.');
    seenRa.add(student.ra);
    seenTokens.add(student.qrToken);
    return student;
  });
}

function readStudents_() {
  const students = readCompressed_(APP.properties.students, null);
  if (!students) throw appError_('NOT_CONFIGURED', 'O sistema ainda não foi configurado.');
  return students;
}

function readRounds_() {
  const rounds = readRoundRecords_();
  const marks = readMarks_();
  const counts = {};
  marks.forEach((mark) => { counts[mark.roundId] = (counts[mark.roundId] || 0) + 1; });
  return rounds.map((round) => ({ ...round, marksCount: counts[round.id] || 0 }));
}

function readMarks_() {
  const allProperties = PropertiesService.getScriptProperties().getProperties();
  const countSuffix = '__COUNT';
  return Object.keys(allProperties)
    .filter((key) => key.indexOf(APP.properties.marksPrefix) === 0 && key.slice(-countSuffix.length) === countSuffix)
    .flatMap((countKey) => readCompressedFromMap_(allProperties, countKey.slice(0, -countSuffix.length), []))
    .map((mark) => ({ ...mark, date: new Date(mark.date) }));
}

function recentMarks_(limit) {
  const students = {};
  readStudents_().forEach((student) => { students[student.ra] = student; });
  const rounds = {};
  readRounds_().forEach((round) => { rounds[round.id] = round; });

  return readMarks_().sort((a, b) => b.date - a.date).slice(0, limit).map((mark) => ({
    id: mark.id,
    registeredAt: formatDate_(mark.date),
    student: students[mark.ra] ? publicStudent_(students[mark.ra]) : { ra: mark.ra, name: 'Aluno removido', className: '' },
    round: rounds[mark.roundId] || null
  }));
}

function readRoundRecords_() {
  return readCompressed_(APP.properties.rounds, []);
}

function saveRounds_(rounds) {
  writeCompressed_(APP.properties.rounds, rounds);
}

function closeActiveRounds_() {
  const rounds = readRoundRecords_();
  let changed = false;
  rounds.forEach((round) => {
    if (round.status === 'ATIVA') {
      round.status = 'ENCERRADA';
      round.closedAt = formatDate_(new Date());
      changed = true;
    }
  });
  if (changed) saveRounds_(rounds);
}

function countRoundMarks_(roundId) {
  return readRoundMarks_(roundId).length;
}

function readRoundMarks_(roundId) {
  return readCompressed_(marksKey_(roundId), []);
}

function marksKey_(roundId) {
  return APP.properties.marksPrefix + String(roundId || '').replace(/[^a-z0-9]/gi, '');
}

function writeCompressed_(key, value) {
  const props = PropertiesService.getScriptProperties();
  const previousCount = Number(props.getProperty(key + '__COUNT') || 0);
  const json = JSON.stringify(value);
  const compressed = Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes();
  const encoded = Utilities.base64EncodeWebSafe(compressed);
  const chunks = encoded.match(/[\s\S]{1,7800}/g) || [''];
  const updates = { [key + '__COUNT']: String(chunks.length) };
  chunks.forEach((chunk, index) => { updates[key + '__' + index] = chunk; });
  props.setProperties(updates);
  for (let index = chunks.length; index < previousCount; index += 1) props.deleteProperty(key + '__' + index);
}

function readCompressed_(key, fallback) {
  return readCompressedFromMap_(PropertiesService.getScriptProperties().getProperties(), key, fallback);
}

function readCompressedFromMap_(allProperties, key, fallback) {
  const count = Number(allProperties[key + '__COUNT'] || 0);
  if (!count) return fallback;
  let encoded = '';
  for (let index = 0; index < count; index += 1) encoded += allProperties[key + '__' + index] || '';
  if (!encoded) return fallback;
  const bytes = Utilities.base64DecodeWebSafe(encoded);
  const gzipBlob = Utilities.newBlob(bytes, 'application/gzip', key + '.gz');
  const json = Utilities.ungzip(gzipBlob).getDataAsString('UTF-8');
  return JSON.parse(json);
}

function deleteCompressed_(key) {
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty(key + '__COUNT') || 0);
  for (let index = 0; index < count; index += 1) props.deleteProperty(key + '__' + index);
  props.deleteProperty(key + '__COUNT');
}

function clearDataStore_() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach((key) => {
    if (key.indexOf('DATA_') === 0) props.deleteProperty(key);
  });
}

function normalizeQrToken_(value) {
  const raw = String(value || '').trim();
  const token = raw.indexOf('VST1:') === 0 ? raw.slice(5) : raw;
  return /^[a-f0-9]{32}$/i.test(token) ? token.toLowerCase() : '';
}

function normalizeRa_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits || digits.length > 10) throw appError_('INVALID_RA', 'RA inválido.');
  return digits.padStart(6, '0');
}

function normalizeClass_(value, allowEmpty) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (allowEmpty && !normalized) return '';
  if (!/^\d{1,2}º Ano$/.test(normalized)) throw appError_('INVALID_CLASS', 'Turma inválida.');
  return normalized;
}

function publicStudent_(student) {
  return { ra: student.ra, name: student.name, className: student.className };
}

function formatDate_(date) {
  return Utilities.formatDate(date, APP.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function sortNewest_(a, b) {
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

function sortClasses_(a, b) {
  return parseInt(a, 10) - parseInt(b, 10);
}

function roundNumber_(value, decimals) {
  const factor = Math.pow(10, decimals || 0);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function safeEquals_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a.charCodeAt(index % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(index % Math.max(b.length, 1)) || 0);
  return mismatch === 0;
}

function isValidCallback_(callback) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback);
}

function appError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
