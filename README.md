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
├─ docs/            前端（目前只有建置中頁面）
├─ backend/
│  ├─ appsscript.json   時區 Asia/Taipei、權限範圍
│  ├─ Util.gs           共用設定與工具
│  └─ Setup.gs          setup()、checkSetup()
├─ README.md
└─ .gitignore
```

---

## 第二階段：建立試算表與初始資料

**目標：** 完成 GitHub 專案、Apps Script 專案、試算表三張表與初始資料、Google 登入用的 OAuth 用戶端。

**以下所有 Google 操作，都用擁有者帳號 `Hsieh20200202@gmail.com` 登入。** 建議在 Chrome 開一個只登入這個帳號的「使用者設定檔」，避免多個帳號互相干擾。

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
