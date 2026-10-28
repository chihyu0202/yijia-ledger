/**
 * 一家帳 — 每週備份
 *
 * backupSpreadsheet()     複製試算表到雲端硬碟「記帳備份」資料夾，只保留最新 12 份（較舊的移到垃圾桶，30 天內可救回）。
 *                         可在編輯器手動執行，也由觸發器每週執行。
 * installBackupTrigger()  在編輯器執行一次：建立每週日凌晨 3 點的備份觸發器（重複執行不會多建）。
 */

const BACKUP = {
  FOLDER_NAME: '記帳備份',
  FILE_PREFIX: '一家帳資料 備份 ',
  KEEP: 12,
  HANDLER: 'backupSpreadsheet',
};

function backupSpreadsheet() {
  const folder = getBackupFolder_();
  const name = BACKUP.FILE_PREFIX + Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HHmm');
  // 複製時鎖住，避免拷到寫到一半的資料
  const copy = withLock_(function () {
    return DriveApp.getFileById(props_().getProperty(PROP.SPREADSHEET_ID)).makeCopy(name, folder);
  });

  const backups = [];
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed() && f.getName().indexOf(BACKUP.FILE_PREFIX) === 0) backups.push(f);
  }
  backups.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  const removed = backups.slice(BACKUP.KEEP);
  removed.forEach(function (f) { f.setTrashed(true); });

  console.log('✔ 已備份：' + copy.getName());
  console.log('目前保留 ' + Math.min(backups.length, BACKUP.KEEP) + ' 份' + (removed.length ? '，移到垃圾桶 ' + removed.length + ' 份' : ''));
}

function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === BACKUP.HANDLER) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(BACKUP.HANDLER).timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).inTimezone(APP.TZ).create();
  getBackupFolder_();
  console.log('✔ 已建立每週備份：每週日 03:00–04:00（台北時間）');
}

/** 取得備份資料夾；ID 記在指令碼屬性 BACKUP_FOLDER_ID，資料夾被刪除時重新建立 */
function getBackupFolder_() {
  const props = props_();
  const id = props.getProperty(PROP.BACKUP_FOLDER_ID);
  if (id) {
    try {
      const folder = DriveApp.getFolderById(id);
      if (!folder.isTrashed()) return folder;
    } catch (e) {
      // 找不到就重新建立
    }
  }
  let folder = null;
  const found = DriveApp.getFoldersByName(BACKUP.FOLDER_NAME);
  while (!folder && found.hasNext()) {
    const f = found.next();
    if (!f.isTrashed()) folder = f;
  }
  if (!folder) folder = DriveApp.createFolder(BACKUP.FOLDER_NAME);
  props.setProperty(PROP.BACKUP_FOLDER_ID, folder.getId());
  return folder;
}
