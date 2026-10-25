// ===== Tests for pure backup logic (src/lib/backup.ts) =====
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(n) { console.log(`PASS  ${n}`); passed++; }
function fail(n, e) { console.log(`FAIL  ${n}\n      -> ${e?.message ?? e}`); failed++; }
function check(name, fn) { try { fn(); ok(name); } catch (e) { fail(name, e); } }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(`${m || 'not equal'}: expected ${b}, got ${a}`); }

const B = await import(pathToFileURL(path.join(ROOT, 'src/lib/backup.ts')).href);

check('isValidSqliteHeader accepts real header', () => {
  const bytes = new TextEncoder().encode('SQLite format 3\u0000rest of file...');
  assert(B.isValidSqliteHeader(bytes), 'valid header must pass');
});
check('isValidSqliteHeader rejects junk / short input', () => {
  assert(!B.isValidSqliteHeader(new TextEncoder().encode('not a database at all')), 'junk rejected');
  assert(!B.isValidSqliteHeader([1, 2, 3]), 'short rejected');
  const wrong = new TextEncoder().encode('SQLite format 4\u0000');
  assert(!B.isValidSqliteHeader(wrong), 'wrong version byte rejected');
});
check('backupFileName format sports-store-backup-YYYY-MM-DD.db', () => {
  const name = B.backupFileName(new Date(2026, 9, 25)); // Oct 25 2026 local
  assertEqual(name, 'sports-store-backup-2026-10-25.db');
});
check('selectKeepLast keeps newest 14 by date in name', () => {
  const files = Array.from({ length: 20 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 1 + i * 3)); // Sep 1 .. every 3 days
    const name = `sports-store-backup-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}.db`;
    return { name };
  });
  const { keep, remove } = B.selectKeepLast(files, 14);
  assertEqual(keep.length, 14);
  assertEqual(remove.length, 6);
  const newest = files[files.length - 1].name;
  const oldest = files[0].name;
  assert(keep.some((f) => f.name === newest) && !remove.some((f) => f.name === newest), 'newest kept');
  assert(remove.some((f) => f.name === oldest), 'oldest removed');
});
check('selectKeepLast with fewer than 14 removes nothing', () => {
  const files = [{ name: 'sports-store-backup-2026-10-01.db' }, { name: 'sports-store-backup-2026-10-02.db' }];
  const { keep, remove } = B.selectKeepLast(files, 14);
  assertEqual(keep.length, 2); assertEqual(remove.length, 0);
});
check('shouldAutoBackup: never backed up -> true', () => assert(B.shouldAutoBackup('', new Date())));
check('shouldAutoBackup: recent -> false, older than 24h -> true', () => {
  const now = new Date('2026-10-25T12:00:00');
  assert(!B.shouldAutoBackup('2026-10-25T00:30:00', now), '11.5h old -> no backup');
  assert(B.shouldAutoBackup('2026-10-24T00:00:00', now), '36h old -> backup');
  assert(B.shouldAutoBackup('2026-10-24 00:00:00'.replace('T', ' '), now) === B.shouldAutoBackup('2026-10-24T00:00:00', now), 'space form handled');
  assert(B.shouldAutoBackup('garbage', now), 'unparseable -> backup');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
