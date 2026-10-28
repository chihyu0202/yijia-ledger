# 一家帳（yijia-ledger）

家庭共用支出記帳 PWA。前端放 GitHub Pages，後端是 Google Apps Script，資料存在 Google 試算表。

| 部分 | 位置 | 怎麼更新 |
|---|---|---|
| 前端（`docs/`） | GitHub Pages：https://chihyu0202.github.io/yijia-ledger/ | `git push` |
| 後端（`backend/`） | Google 伺服器，擁有者帳號下的 Apps Script | `clasp push` |
| 資料 | 擁有者雲端硬碟的試算表「一家帳資料」 | 由後端寫入 |

> 這個 GitHub 專案是**公開**的（GitHub Pages 免費方案需要公開）。
> email、試算表 ID、登入用的 Client ID 都放在 Apps Script 的「指令碼屬性」，**不要寫進程式碼**。

```
yijia-ledger/
├─ docs/            前端
│  ├─ index.html        畫面
│  ├─ style.css         樣式
│  ├─ app.js            登入、首頁統計、新增／修改／複製、紀錄、設定
│  ├─ config.js         後端 Web App 網址
│  ├─ sw.js             Service Worker（只快取介面檔）
│  ├─ manifest.webmanifest  App 名稱、圖示（加到主畫面用）
│  └─ icons/            圖示（icon.svg 為原始檔）
├─ backend/
│  ├─ appsscript.json   時區 Asia/Taipei、權限範圍
│  ├─ Util.gs           共用設定與工具、資料表讀寫
│  ├─ Setup.gs          setup()、checkSetup()
│  ├─ Code.gs           Web App 入口（doPost 依 action 分派、錯誤處理）
│  ├─ Auth.gs           Google 登入驗證、session、me
│  ├─ Expenses.gs       開支新增／修改／作廢／列表、可見度規則
│  ├─ Stats.gs          月統計、年統計
│  ├─ Categories.gs     分類
│  ├─ Members.gs        成員
│  ├─ Backup.gs         每週備份
│  └─ Tests.gs          在編輯器執行的測試函式
├─ tests/           本機模擬測試（node tests/*.test.js；共用模擬環境在 gas_mock.js）
├─ README.md
└─ .gitignore
```

---

## 第二階段：建立試算表與初始資料

**目標：** 完成 GitHub 專案、Apps Script 專案、試算表三張表與初始資料、Google 登入用的 OAuth 用戶端。

**以下所有 Google 操作，都用**擁有者的 Gmail 帳號**登入。** 建議在 Chrome 開一個只登入這個帳號的「使用者設定檔」，避免多個帳號互相干擾。

### 步驟 A：放好檔案

1. 把下載的 `yijia-ledger` 資料夾放到你習慣的位置，例如 `~/projects/yijia-ledger`。
2. 用 VS Code 開啟這個資料夾。

### 步驟 B：建立 GitHub 專案並開啟 Pages

1. 登入 GitHub（chihyu0202）→ 右上角 **＋ › New repository**。
2. Repository name：`yijia-ledger`；選 **Public**；**不要**勾選 Add a README。按 **Create repository**。
3. 在 VS Code 的終端機（專案根目錄）執行：

   ```bash
   git init -b main
   git add .
   git commit -m "第二階段：專案骨架與初始化程式"
   git remote add origin https://github.com/chihyu0202/yijia-ledger.git
   git push -u origin main
   ```

   若要求登入：密碼欄需貼 GitHub 的 Personal Access Token；或先執行 `gh auth login`（若已安裝 GitHub CLI）。

4. 回到 GitHub 專案頁 → **Settings › Pages**：
   - Source：**Deploy from a branch**
   - Branch：**main**，資料夾 **/docs** → **Save**
5. 等 1–2 分鐘，打開 https://chihyu0202.github.io/yijia-ledger/ ，應看到「一家帳 · 建置中」。

### 步驟 C：用 clasp 建立 Apps Script 專案

1. 開啟 https://script.google.com/home/usersettings ，把 **Google Apps Script API** 切到「開啟」。
2. 終端機安裝 clasp：

   ```bash
   npm install -g @google/clasp
   clasp --version
   ```

   若出現權限錯誤，改用 `sudo npm install -g @google/clasp`。

3. 登入（會開瀏覽器，選擁有者帳號並允許）：

   ```bash
   clasp login
   ```

4. 建立專案並上傳：

   ```bash
   cd backend
   clasp create --type standalone --title "一家帳 後端"
   git checkout -- appsscript.json   # clasp create 可能覆蓋設定檔，用 git 還原
   clasp push
   ```

   `clasp push` 若詢問「Manifest file has been updated. Do you want to push and overwrite?」，輸入 `y`。

5. 開啟線上編輯器：

   ```bash
   clasp open-script     # 舊版 clasp 請用 clasp open
   ```

   左側應看到 `Setup.gs`、`Util.gs`。

### 步驟 D：設定初始成員

1. 線上編輯器左側點 **⚙ 專案設定** → 捲到最下方 **指令碼屬性** → **新增指令碼屬性**。
2. 屬性：`INITIAL_MEMBERS`，值貼上下面這行，**把兩個 email 換成 Gloria 與 Yao 實際登入用的 Gmail**：

   ```json
   [{"name":"Gloria","email":"Gloria的Gmail","role":"admin"},{"name":"Yao","email":"Yao的Gmail","role":"admin"},{"name":"小珠寶"}]
   ```

   - 必須是 Google 帳號（建議 @gmail.com）。
   - 引號要用半形 `"`，不要用 `“ ”`。
3. 按 **儲存指令碼屬性**。

> setup() 成功後會自動刪除 `INITIAL_MEMBERS`；之後成員以試算表的 Members 工作表為準（第四階段起可在 App 內管理）。

### 步驟 E：執行 setup()

1. 左側點 **< > 編輯器** → 開啟 `Setup.gs`。
2. 上方函式下拉選單選 **setup** → 按 **▷ 執行**。
3. 第一次會要求授權：
   - **審查權限** → 選擁有者帳號。
   - 若出現「Google 尚未驗證這個應用程式」：點 **進階 › 前往「一家帳 後端」（不安全）**。這是你自己的程式，只會存取你自己的試算表。
   - 按 **允許**。
4. 下方「執行記錄」應出現：

   ```
   ✔ setup 完成
   試算表：https://docs.google.com/spreadsheets/d/……
   新增分類 7 筆、新增成員 3 位（0 表示先前已建立，未重複新增）
   ```

5. 函式改選 **checkSetup** → **▷ 執行**，確認三張表、7 個分類、3 位成員。`GOOGLE_CLIENT_ID` 此時顯示 ✘ 是正常的，下一步會設定。

### 步驟 F：檢查試算表

打開執行記錄中的試算表網址，確認：

- 有 **Expenses**、**Categories**、**Members** 三張工作表，第一列是英文欄位名稱。
- Categories 有 餐飲、交通、居家生活、育兒、醫療、娛樂、其他，`is_active` 為勾選。
- Members 有 Gloria（admin）、Yao（admin）、小珠寶（無 email）。

**請不要更改標題列或欄位順序**；資料列可以看，但建議透過 App 修改。試算表不需要分享給 Yao。

### 步驟 G：建立 Google 登入用的 OAuth 用戶端

1. 開啟 https://console.cloud.google.com/ → 上方專案選單 → **新增專案**，名稱 `yijia-ledger` → 建立，並切換到這個專案。
2. 左側選單 **Google Auth Platform**（或搜尋「OAuth 同意畫面」）→ **開始使用**：
   - 應用程式名稱：`一家帳`；使用者支援電子郵件：擁有者 Gmail。
   - 目標對象：**外部**。
   - 聯絡資訊：擁有者 Gmail → 同意政策 → **建立**。
3. **資料存取** → **新增或移除範圍**：勾選 `openid` 與 `.../auth/userinfo.email` → 更新 → 儲存。
4. **目標對象** → 發布狀態按 **發布應用程式** → 確認。
   （只用 openid 與 email 這類基本範圍，不需要 Google 審核；發布後新增成員不用再到這裡加測試使用者。）
5. **用戶端** → **建立用戶端**：
   - 應用程式類型：**網頁應用程式**；名稱：`一家帳 Web`
   - **已授權的 JavaScript 來源**：
     - `https://chihyu0202.github.io`
     - `http://localhost:8080`（本機測試用）
   - **已授權的重新導向 URI**：
     - `https://chihyu0202.github.io/yijia-ledger/`
     - `http://localhost:8080/`
   - 按 **建立**。
6. 複製畫面上的 **用戶端 ID**（`……apps.googleusercontent.com`）。**不需要**用戶端密碼，也不要把密碼放到任何地方。
7. 回 Apps Script → **⚙ 專案設定 › 指令碼屬性** → 新增 `GOOGLE_CLIENT_ID`，值貼上用戶端 ID → 儲存。
8. 再執行一次 **checkSetup**，`GOOGLE_CLIENT_ID` 應顯示 ✔。

### 步驟 H：提交

```bash
cd ..            # 回到專案根目錄
git status       # 應該沒有 .clasp.json（已被 .gitignore 排除）
```

這一階段沒有新的程式變更需要提交；若有，`git add . && git commit -m "..." && git push`。

### 完成後應該有

- [ ] https://chihyu0202.github.io/yijia-ledger/ 顯示建置中頁面
- [ ] Apps Script 專案「一家帳 後端」，`clasp push` 可正常上傳
- [ ] 試算表「一家帳資料」：三張表、7 個分類、3 位成員
- [ ] 指令碼屬性：`SPREADSHEET_ID`、`GOOGLE_CLIENT_ID`、`PERSONAL_VISIBILITY = full`

### 常見錯誤

| 訊息／狀況 | 處理方式 |
|---|---|
| `User has not enabled the Apps Script API` | 步驟 C-1 開啟 API，等 2–5 分鐘再試 |
| `clasp: command not found` | 用 `npx @google/clasp ...`，或確認 npm 全域路徑在 PATH 中 |
| `clasp login` 沒開瀏覽器 | 把終端機顯示的網址複製到瀏覽器手動開啟 |
| 尚未設定 INITIAL_MEMBERS | 完成步驟 D 後重新執行 setup() |
| INITIAL_MEMBERS 不是有效的 JSON | 多半是全形引號或少逗號，直接複製步驟 D 的範本再改 email |
| 管理員必須有 email | role 為 admin 的成員一定要填 email |
| 標題列與預期不同 | 有人改了標題列：改回原樣，或刪除該工作表再執行 setup() |
| SPREADSHEET_ID 無法開啟 | 試算表被刪除或換帳號：刪除該指令碼屬性後重新執行 setup() |
| GitHub Pages 顯示 404 | 等幾分鐘；確認 Settings › Pages 選的是 main 與 /docs |
| 授權來源格式錯誤 | JavaScript 來源只能是 `https://chihyu0202.github.io`，不能有路徑或結尾斜線 |

setup() 可以放心重複執行：已存在的表與資料不會被覆蓋或重複新增。

---

## 第三階段：後端 API

**目標：** 後端提供登入、開支、分類、成員、統計 API，以 Web App 部署，取得前端要呼叫的網址。

### 本機測試（不需要網路）

```bash
node tests/mock_setup.test.js
node tests/mock_api.test.js
```

兩個都應顯示 `failed 0`。

### 步驟 A：上傳程式

```bash
cd backend
clasp push
```

若詢問「Manifest file has been updated. Do you want to push and overwrite?」，輸入 `y`（這次 `appsscript.json` 新增了對外連線權限與 Web App 設定）。

### 步驟 B：重新授權並執行測試函式

1. `clasp open-script` 開啟線上編輯器，左側應多出 `Code.gs`、`Auth.gs`、`Expenses.gs`、`Stats.gs`、`Categories.gs`、`Members.gs`、`Tests.gs`。
2. 開啟 `Tests.gs` → 函式選 **testLoginRejectsBadToken** → **▷ 執行**。
   - 因為新增了「連線到外部服務」權限，會再要求一次授權：用擁有者帳號 → **進階 › 前往（不安全）** → **允許**。
   - 執行記錄應出現 `✔ 假 token 被拒絕，對外連線正常`。
3. 函式改選 **testBackend** → **▷ 執行**。執行記錄每一行都應是 ✔，最後是 `✔ 全部通過（測試紀錄已刪除）`。
   這個測試會用第一位管理員的身分新增一筆「【測試】請忽略」，跑完會自動刪除，不會留在試算表。

### 步驟 C：部署 Web App

在 `backend/` 執行：

```bash
clasp deploy --description "一家帳 API"
```

會顯示 `Deployed <deploymentId> @1`。Web App 網址是：

```
https://script.google.com/macros/s/<deploymentId>/exec
```

- 部署設定來自 `appsscript.json`：執行身分「我」、存取「任何人」。權限全部在後端檢查，沒有 session 什麼都拿不到。
- 用瀏覽器打開這個網址，應看到 `{"ok":true,"data":{"app":"一家帳"}}`。
- 請把 deploymentId 記在自己的筆記；第四階段前端會用到這個網址。

**之後更新後端**，一律用同一個 deployment，網址才不會變：

```bash
clasp push
clasp deploy -i <deploymentId> --description "說明這次改了什麼"
```

只執行 `clasp push` 不會更新 Web App（Web App 跑的是部署時的版本）。

### 完成後應該有

- [ ] 兩個本機測試 `failed 0`
- [ ] 編輯器 testLoginRejectsBadToken、testBackend 全部 ✔
- [ ] Web App 網址打開看到 `{"ok":true,...}`

### 常見錯誤

| 訊息／狀況 | 處理方式 |
|---|---|
| 執行測試時「需要授權」或 `UrlFetchApp` 權限錯誤 | 步驟 B-2 重新授權 |
| testBackend：找不到啟用中的管理員 | 檢查 Members 工作表有 admin 且 `is_active` 已勾選、有 email |
| `CONFIG`：尚未設定 GOOGLE_CLIENT_ID | 第二階段步驟 G-7 |
| `CONFIG`：PERSONAL_VISIBILITY 設定錯誤 | 指令碼屬性只能填 `full`、`summary`、`private` |
| 打開網址顯示「找不到指令碼函式」 | 部署的是舊版本：先 `clasp push`，再 `clasp deploy -i <deploymentId>` |
| 打開網址要求登入 Google 或顯示沒有權限 | 部署的存取權不是「任何人」：在編輯器 **部署 › 管理部署作業** 檢查 |
| 每次部署網址都不同 | 沒有加 `-i <deploymentId>`；多出來的部署可在「管理部署作業」封存 |

---

## 第四階段：前端記帳介面

**目標：** 用 Google 帳號登入，四個分頁都能使用：首頁（月／年統計）、新增、紀錄（修改／複製／作廢）、設定（分類、成員）。

- Google 登入用的 Client ID 不寫進前端程式碼：前端登入前呼叫後端 `auth.config`，從指令碼屬性讀取。
- `docs/config.js` 是後端 Web App 網址。這個網址公開無妨：沒有登入 session 什麼都拿不到。

### 步驟 A：更新後端（新增了 `auth.config`）

```bash
cd backend
clasp push
clasp deploy -i <deploymentId> --description "第四階段 A：auth.config"
```

`<deploymentId>` 就是 `docs/config.js` 網址中 `/s/` 和 `/exec` 之間那一段。

### 步驟 B：在電腦上測試

```bash
cd docs
python3 -m http.server 8080
```

用瀏覽器開 http://localhost:8080/ （一定要用 `localhost:8080`，這是 OAuth 用戶端登記的網址）：

1. 按「使用 Google 登入」→ 選擁有者帳號 → 回到一家帳，看到底部四個分頁。
2. 「新增」：輸入金額、項目，選歸屬與分類 → 儲存，出現「已儲存」，表單清空。
3. 打開試算表 Expenses，確認多了一列：日期是文字 `yyyy-MM-dd`、`created_by` 是你的 member_id、`status` 是 `active`。
4. 「設定」→ 登出，回到登入畫面。

### 步驟 C：測試紀錄、首頁、設定

先在「新增」記 3 筆不同歸屬、分類的開支，然後：

1. **紀錄**：看到這個月的紀錄，日期新到舊。切換歸屬、分類篩選，筆數與合計會跟著變。
2. 點一筆 → 底部面板 → **修改** 金額 → 儲存，回到紀錄，金額已更新。
3. 點一筆 → **複製** → 日期是今天、其他欄位相同 → 儲存，多一筆。
4. 點一筆 → **作廢** → 確認，該筆從列表消失；試算表中該列 `status` 變成 `void`（不會刪除）。
5. **首頁**：月統計的總額、各歸屬、各分類正確；選分類只看該分類。切到「年」，看到全年、月平均、12 個月；點某個月會跳到該月的紀錄。
6. **設定 › 分類**：新增一個分類 → 「新增」頁出現；用 ↑↓ 調整順序 → 「新增」頁的順序跟著變（只影響自己）；停用一個分類 → 「新增」頁不再出現，舊紀錄仍顯示原分類。
7. **設定 › 成員**（管理員）：新增成員、修改、停用；停用最後一位管理員會被擋下。

月平均：今年只除到本月，過去的年份除以 12。

> **更新前端時**：改了 `style.css`、`config.js` 或 `app.js`，請把 `index.html` 裡三個 `?v=` 和 `sw.js` 的 `VERSION` 一起加 1。否則瀏覽器可能拿新的 `index.html` 配舊的 `app.js`，畫面會空白。

### 步驟 D：在手機上測試

`git push` 後等 1–2 分鐘，用手機開 https://chihyu0202.github.io/yijia-ledger/ （若還是舊畫面，關掉分頁重開）重複步驟 B、C。

### 常見錯誤

| 訊息／狀況 | 處理方式 |
|---|---|
| 按登入後顯示「不支援的操作：auth.config」 | 後端還是舊版：做步驟 A，記得加 `-i <deploymentId>` |
| Google 顯示 `redirect_uri_mismatch` | 網址不是 `http://localhost:8080/` 或 GitHub Pages 網址；或 OAuth 用戶端的「已授權的重新導向 URI」少了結尾 `/` |
| Google 登入後顯示「這個 Google 帳號沒有使用權限」 | 選錯帳號，或 Members 裡該成員的 email 不同／未啟用 |
| 「Google 登入驗證失敗」 | 指令碼屬性 `GOOGLE_CLIENT_ID` 和 OAuth 用戶端 ID 不一致；或登入後太久才回到頁面，重新登入即可 |
| 「無法連線」 | 網路問題，或 `config.js` 的網址錯誤：瀏覽器直接打開該網址應看到 `{"ok":true,...}` |
| 修改時顯示「資料已變更，請重新整理」 | 有人在你打開後改過這筆：按取消，回紀錄重新點開再改 |
| 其他人停用的分類還出現在「新增」頁 | 切到「設定」頁或重新開啟 App 即會更新；若仍選了，儲存時會提示重新選擇 |
| 打開後還是舊畫面 | 瀏覽器快取：電腦按 Ctrl+Shift+R（Mac：Cmd+Shift+R），手機關掉分頁重開 |

---

## 第五階段：PWA（加到主畫面、離線）

**目標：** 可以加到手機主畫面，像 App 一樣全螢幕開啟；沒有網路時仍能打開介面，但不能儲存。

- 登入串接與權限檢查已在第三、四階段完成（權限全部由後端判斷）。
- `sw.js` 只快取介面檔（HTML、CSS、JS、圖示），**不快取任何資料**。離線時打開 App 會顯示「目前離線，無法儲存」與「無法連線」，不會顯示舊資料或假裝儲存成功。
- 圖示：屋頂與雙手護著錢袋，原始檔 `docs/icons/icon.svg`，另有 192、512、180（iPhone）三種 PNG。

### 步驟 A：電腦測試

1. `cd docs && python3 -m http.server 8080`，開 http://localhost:8080/ ，按 Ctrl+Shift+R。
2. Chrome 按 F12 → **Application**：
   - **Manifest**：名稱「一家帳」、看得到圖示，沒有紅字錯誤。
   - **Service Workers**：`sw.js` 狀態為 activated。
   - **Cache Storage › yijia-ui**：只有介面檔，沒有 script.google.com 的網址。
3. **Network** 分頁勾選 **Offline** → 重新整理：頁面仍會出現，上方紅條「目前離線，無法儲存」，並顯示「無法連線」與「重新載入」。取消 Offline → 按「重新載入」恢復正常。

### 步驟 B：iPhone 加到主畫面

1. 用 **Safari** 開 https://chihyu0202.github.io/yijia-ledger/ （其他瀏覽器在 iPhone 上不能加入主畫面為 App）。
2. 下方 **分享** 按鈕 → **加入主畫面** → 名稱「一家帳」→ **新增**。
3. 從主畫面打開：全螢幕、沒有網址列。登入一次（會跳到 Google 再回來）。
4. 關掉 App 再開，應該不用重新登入（session 30 天）。

### 步驟 C：Android 加到主畫面

1. 用 **Chrome** 開 https://chihyu0202.github.io/yijia-ledger/ 。
2. 右上角 **⋮** → **加到主畫面**（或「安裝應用程式」）→ **安裝**。
3. 從主畫面打開並登入，同 iPhone 步驟 3–4。

### 常見錯誤

| 訊息／狀況 | 處理方式 |
|---|---|
| iPhone 從主畫面登入後回到 Safari，而不是 App | 第六階段實測項目；先回報情況，必要時調整登入流程 |
| 圖示是網頁截圖而不是一家帳圖示 | 加入主畫面前先強制重新整理；或刪掉主畫面圖示重新加入 |
| 更新後手機還是舊版 | 完全關掉 App（從多工畫面滑掉）再開；若仍是舊版，確認 `?v=` 與 `sw.js` 的 `VERSION` 有加 1 |
| DevTools 顯示 Service Worker 錯誤 | 確認是用 `http://localhost:8080` 或 GitHub Pages 開啟（直接開 html 檔不支援 Service Worker） |

---

## 第七階段：每週備份與日常維護

**目標：** 每週日凌晨自動把試算表複製到雲端硬碟「記帳備份」資料夾，只保留最新 12 份；整理日常維護方式。

### 本機測試

```bash
node tests/mock_setup.test.js
node tests/mock_api.test.js
node tests/mock_backup.test.js
```

三個都應顯示 `failed 0`。

### 步驟 A：上傳並建立備份觸發器

1. 上傳（這次新增了雲端硬碟與觸發器權限，詢問是否覆蓋 Manifest 時輸入 `y`）：

   ```bash
   cd backend
   clasp push
   ```

2. `clasp open-script` → 開啟 `Backup.gs` → 函式選 **installBackupTrigger** → **▷ 執行**。
   - 會再要求一次授權（新增「查看、編輯雲端硬碟檔案」與「管理觸發器」）：擁有者帳號 → **進階 › 前往（不安全）** → **允許**。
   - 執行記錄：`✔ 已建立每週備份：每週日 03:00–04:00（台北時間）`
3. 函式改選 **backupSpreadsheet** → **▷ 執行**，先手動備份一次。執行記錄：`✔ 已備份：一家帳資料 備份 yyyy-MM-dd HHmm`。
4. 打開雲端硬碟，確認有「記帳備份」資料夾，裡面有一份備份。
5. 執行 **checkSetup**，最後一行應是 `✔ 每週備份觸發器`。
6. 左側 **⏰ 觸發條件**：看到一個 `backupSpreadsheet`、每週。點它右邊 ⋮ › 編輯，**失敗通知設定** 選「立即通知」，備份失敗會寄信到擁有者信箱。

> 觸發器執行的是最新上傳的程式，不需要重新部署 Web App。

### 完成後應該有

- [ ] 三個本機測試 `failed 0`
- [ ] 雲端硬碟「記帳備份」資料夾裡有備份
- [ ] checkSetup 顯示 `✔ 每週備份觸發器`

---

## 日常維護

### 更新程式

| 要改的 | 做法 |
|---|---|
| 前端（`docs/`） | 改完把 `index.html` 三個 `?v=` 與 `sw.js` 的 `VERSION` 一起加 1 → `git push`。手機上完全關掉 App 再開即可更新 |
| 後端（`backend/`） | `clasp push` → `clasp deploy -i <deploymentId> --description "改了什麼"`（`<deploymentId>` 見 `docs/config.js`）。**一定要加 `-i`**，網址才不會變 |
| 改完後端 | 本機先跑 `node tests/*.test.js`；上傳後在編輯器跑 `testBackend` |

### 常見管理工作

| 想做的事 | 做法 |
|---|---|
| 新增家人、停用成員、改管理員 | App › 設定 › 成員（管理員才能操作）。成員只能停用，不能刪除 |
| 新增、改名、停用分類 | App › 設定 › 分類 |
| 調整個人開支給其他人看的程度 | 指令碼屬性 `PERSONAL_VISIBILITY`：`full`（全部可看可改）、`summary`（只看總額與分類小計）、`private`（看不到）。存檔後立即生效 |
| 手機遺失，要讓所有人重新登入 | 指令碼屬性中刪除所有 `sess_` 開頭的屬性。只停用某人時，在 App 停用該成員即可（他的登入立即失效） |
| 查看後端錯誤 | Apps Script 編輯器左側 **≡ 執行項目**，看失敗的紀錄 |
| 立即備份一次 | 編輯器執行 `backupSpreadsheet` |

### 從備份還原

只有試算表資料壞掉時才需要：

1. 雲端硬碟 › 記帳備份 → 選要還原的那一份 → 右鍵 **建立副本**，把副本改名為「一家帳資料」，移到原本的位置。
2. 打開副本，從網址複製試算表 ID（`/d/` 和 `/edit` 之間那一段）。
3. Apps Script › 專案設定 › 指令碼屬性：把 `SPREADSHEET_ID` 改成新的 ID → 儲存。
4. 執行 `checkSetup` 確認三張表與筆數正確，再用 App 看一下紀錄。
5. 原本壞掉的試算表先不要刪，改名為「一家帳資料（舊）」保留一陣子。

> 請不要直接在備份檔上修改：它可能在之後被自動清理（只保留最新 12 份）。

### 關於載入速度

後端（Apps Script）每個請求固定約 1–1.5 秒，這是 Google 平台本身的時間。為了讓操作順暢，App 會：

- 看過的畫面再次打開時先顯示上次的資料，同時在背景更新（約 1 秒內），資料有變才重畫。
- 登入後在背景先載入「設定」頁；首頁與「紀錄」本月預設畫面共用同一份資料。
- 新增、修改、作廢或改設定後，清掉暫存，避免看到舊的總額。

暫存只在記憶體中，關掉 App 就清除。第一次看某個月份或年份仍需等 1–2 秒。

### 使用試算表的注意事項

- 不要改標題列、不要調整欄位順序、不要插入欄。
- 不要直接刪除列：要取消一筆開支，請在 App 用「作廢」。
- 試算表不需要分享給其他家人；所有人都是透過 App 存取。
