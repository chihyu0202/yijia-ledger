// 以模擬的 Apps Script 環境測第七階段：每週備份、保留 12 份、觸發器。
// 執行：node tests/mock_backup.test.js
const { makeEnv } = require('./gas_mock');

let pass = 0, fail = 0;
function check(label, cond) { if (cond) pass++; else { fail++; console.log('FAIL: ' + label); } }

const env = makeEnv();
const { api, store, drive } = env;
store.INITIAL_MEMBERS = JSON.stringify([{ name: 'Gloria', email: 'gloria@example.com', role: 'admin' }]);
api.setup();
const live = () => drive.files.filter((f) => f.parent && !f.trashed);

// 第一次備份：建立資料夾、記下 ID
api.backupSpreadsheet();
check('建立「記帳備份」資料夾', drive.folders.length === 1 && drive.folders[0].name === '記帳備份');
check('記下 BACKUP_FOLDER_ID', store.BACKUP_FOLDER_ID === drive.folders[0].id);
check('第一份備份', live().length === 1 && /^一家帳資料 備份 \d{4}-\d{2}-\d{2} \d{4}$/.test(live()[0].name));

// 資料夾裡其他檔案不受影響
const other = drive.makeFile('我的其他試算表', drive.folders[0], 'application/vnd.google-apps.spreadsheet');

// 連續備份 13 次 → 只保留最新 12 份
for (let i = 0; i < 13; i++) api.backupSpreadsheet();
const kept = live().filter((f) => f !== other);
check('只保留 12 份', kept.length === 12);
check('留下的是最新的', Math.min(...kept.map((f) => f.created.getTime())) > Math.max(...drive.files.filter((f) => f.trashed).map((f) => f.created.getTime())));
check('舊的移到垃圾桶（不是刪除）', drive.files.filter((f) => f.trashed).length === 2);
check('其他檔案沒被動到', !other.trashed);
check('沒有重複建立資料夾', drive.folders.length === 1);
check('執行記錄', env.logs.some((l) => l.includes('移到垃圾桶 1 份')));

// 資料夾被丟到垃圾桶 → 重新建立
drive.folders[0].trashed = true;
api.backupSpreadsheet();
check('資料夾被刪除時重新建立', drive.folders.length === 2 && store.BACKUP_FOLDER_ID === drive.folders[1].id && live().filter((f) => f.parent === drive.folders[1]).length === 1);

// 觸發器：重複執行只會有一個
api.installBackupTrigger();
api.installBackupTrigger();
check('只建立一個觸發器', env.triggers.length === 1);
const t = env.triggers[0];
check('每週日 3 點、台北時區', t.fn === 'backupSpreadsheet' && t.day === 'SUNDAY' && t.hour === 3 && t.tz === 'Asia/Taipei');
env.logs.length = 0;
api.checkSetup();
check('checkSetup 顯示觸發器', env.logs.includes('✔ 每週備份觸發器'));

console.log(`passed ${pass}, failed ${fail}`);
process.exit(fail ? 1 : 0);
