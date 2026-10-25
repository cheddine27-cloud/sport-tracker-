// ===== Automated tests for src/services/distributors.ts + phone helper =====
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let passed = 0, failed = 0;
function ok(name) { console.log(`PASS  ${name}`); passed++; }
function fail(name, err) { console.log(`FAIL  ${name}\n      -> ${err?.message ?? err}`); failed++; }
async function checkAsync(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${b}, got ${a}`); }
function stripArabicDiacritics(s) { return String(s).replace(/[\u064B-\u0652]/g, ''); }
async function expectReject(promiseFactory, msgPart, label) {
  let threw = null;
  try { await promiseFactory(); } catch (e) { threw = e; }
  assert(threw, `${label}: expected rejection but it resolved`);
  const actual = stripArabicDiacritics(String(threw.message ?? threw));
  assert(actual.includes(stripArabicDiacritics(msgPart)), `${label}: error "${threw.message}" should contain "${msgPart}"`);
}

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(path.join(ROOT, 'src-tauri/migrations/001_schema.sql'), 'utf8'));
  db.exec(readFileSync(path.join(ROOT, 'src-tauri/migrations/002_seed.sql'), 'utf8'));
  return db;
}
function makeAdapter(db) {
  return {
    async query(sql, params = []) { return db.prepare(sql).all(...params); },
    async execute(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    },
    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const r = await fn(this); db.exec('COMMIT'); return r; }
      catch (err) { db.exec('ROLLBACK'); throw err; }
    },
  };
}

const { addDistributor, updateDistributor, deleteDistributor, getDistributors } =
  await import(pathToFileURLJoin('src/services/distributors.ts'));
const { whatsappUrl } = await import(pathToFileURLJoin('src/lib/phone.ts'));
function pathToFileURLJoin(p) {
  return new URL('file://' + path.join(ROOT, p)).href;
}

const db = freshDb();
const ad = makeAdapter(db);

await checkAsync('1. add "0555123456" stored normalized as 213555123456', async () => {
  const d = await addDistributor(ad, { name: 'سمير', whatsapp: '0555123456' });
  assertEqual(d.whatsapp, '213555123456');
  const raw = db.prepare('SELECT whatsapp FROM distributors WHERE id = ?').get(d.id);
  assert(raw.whatsapp.startsWith('213555123456'), `raw stored: ${raw.whatsapp}`);
});

await checkAsync('2. "+213 555 12 34 56" and "00213555123456" normalize to same number', async () => {
  // Test in isolation (fresh table) so earlier rows cannot clash with the same number.
  const db2 = freshDb();
  const ad2 = makeAdapter(db2);
  const a = await addDistributor(ad2, { name: 'كمال', whatsapp: '+213 555 12 34 56' });
  assertEqual(a.whatsapp, '213555123456');
  assertEqual(a.whatsapp, '213555123456');
  await expectReject(
    () => addDistributor(ad2, { name: 'آخر', whatsapp: '00213555123456' }),
    'مستعمل من قبل الموزع', 'dup-normalized',
  );
});

await checkAsync('3. duplicate rejected with Arabic message naming existing distributor', async () => {
  await addDistributor(ad, { name: 'يوسف', whatsapp: '0770112233' });
  let threw = null;
  try { await addDistributor(ad, { name: 'آخر', whatsapp: '+213 770 11 22 33' }); } catch (e) { threw = e; }
  assert(threw, 'expected rejection');
  const m = stripArabicDiacritics(threw.message);
  assert(m.includes('يوسف'), `message should name يوسف: ${threw.message}`);
});

await checkAsync('4. missing name / missing number / invalid number rejected; nothing saved', async () => {
  const before = db.prepare('SELECT COUNT(*) c FROM distributors').get().c;
  await expectReject(() => addDistributor(ad, { name: '  ', whatsapp: '0555999888' }), 'اسم الموزع مطلوب', 'no-name');
  await expectReject(() => addDistributor(ad, { name: 'بلا رقم', whatsapp: '' }), 'رقم واتساب مطلوب', 'no-phone');
  await expectReject(() => addDistributor(ad, { name: 'رقم خاطئ', whatsapp: 'abc123' }), 'غير صالح', 'bad-phone');
  const after = db.prepare('SELECT COUNT(*) c FROM distributors').get().c;
  assertEqual(after, before, 'no rows should be inserted');
});

await checkAsync('5. update works; taking another distributor number rejected; own number allowed', async () => {
  const x = await addDistributor(ad, { name: 'بشير', whatsapp: '0661000111', note: 'ملاحظة قديمة' });
  await updateDistributor(ad, x.id, { name: 'بشير المعدل', whatsapp: '0661000111', note: 'جديد' });
  const list = await getDistributors(ad, { search: 'بشير' });
  assertEqual(list.length, 1);
  assertEqual(list[0].name, 'بشير المعدل');
  assertEqual(list[0].note, 'جديد');
  await expectReject(
    () => updateDistributor(ad, x.id, { name: 'بشير', whatsapp: '0770112233' }),
    'مستعمل من قبل الموزع', 'update-conflict',
  );
});

await checkAsync('6. delete removes row; deleting non-existing id gives Arabic error', async () => {
  const y = await addDistributor(ad, { name: 'مؤقت', whatsapp: '0555777888' });
  await deleteDistributor(ad, y.id);
  assert(!db.prepare('SELECT id FROM distributors WHERE id = ?').get(y.id), 'row should be gone');
  await expectReject(() => deleteDistributor(ad, y.id), 'الموزع غير موجود', 'delete-again');
});

await checkAsync('7. search by name / number / note; ordering by name', async () => {
  const byName = await getDistributors(ad, { search: 'سمير' });
  assertEqual(byName.length, 1);
  const byNum = await getDistributors(ad, { search: '213555123456' });
  assertEqual(byNum.length, 1);
  assertEqual(byNum[0].name, 'سمير');
  const byNote = await getDistributors(ad, { search: 'جديد' });
  assertEqual(byNote.length, 1);
  const all = await getDistributors(ad);
  const names = all.map((d) => d.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ar'));
  assert(JSON.stringify(names) === JSON.stringify(sorted), `ordering by name broken: ${names.join(',')}`);
});

await checkAsync('8. whatsappUrl: no message = old output; with message ends with ?text=<encoded>; invalid -> null', async () => {
  assertEqual(whatsappUrl('0555123456'), 'https://wa.me/213555123456');
  const url = whatsappUrl('0555123456', 'السلام عليكم، أريد الأسعار');
  assert(url.startsWith('https://wa.me/213555123456?text='), url);
  assert(url.endsWith(encodeURIComponent('السلام عليكم، أريد الأسعار')), 'arabic text must be encoded');
  assertEqual(whatsappUrl('abc', 'x'), null);
  assertEqual(whatsappUrl('', 'x'), null);
});

console.log(`\ntest-distributors: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
