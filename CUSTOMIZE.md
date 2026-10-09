# CUSTOMIZE.md — AI 照需求表改造網站的步驟

給 AI 的工作流程。人只需要：fork、填 `club.md`、把素材放進 `materials/`，然後對 AI 說「照 `club.md` 和 `CUSTOMIZE.md` 改造」。

**原則：直接改程式，不加設定開關。** 不要的功能整個刪掉（頁面、資料表、權限、測試、假資料），不要用 `if (enabled)` 藏起來。留下死程式碼只會讓下一個 AI 看不懂。

---

## 0. 開工前

1. 讀 `club.md`、`AGENTS.md`、本檔。
2. `npm install && npm test`，確認起點是全綠的。起點就壞了先回報，不要開始改。
3. 開新分支：`git checkout -b customize`。網站已經在用的話，**絕不直接改 main**。
4. 把 `club.md` 裡留空、寫「不確定」、或互相矛盾的地方列出來，一次問清楚再動手。常見要問的：
   - 有沒有分組？分組名稱？
   - 出席率怎麼算（晚到、請假）？
   - 標誌只有 PNG 時，要直接用圖片還是用社名文字？
5. 列出改造計畫（要刪哪些功能、要改哪些名稱、要新增什麼），給人確認後再做。

## 1. 換成新社團的身分

| 改什麼 | 在哪 |
|---|---|
| 網站標題、favicon、theme-color | `index.html` |
| 社名文字 | `grep -rn "華夏" --exclude-dir=node_modules .` 逐一替換（含備份檔名、通知訊息、招生頁、示範資料） |
| 標誌 | `js/mark.js`：有 SVG 就換掉 `GLYPHS`／`VB`，沒有就改成輸出社名文字；動畫可以直接拿掉 |
| 顏色 | `css/app.css` 開頭的 `:root`，亮色一組、暗色**兩組**（`@media` 那組和 `[data-theme="dark"]` 那組要一樣） |
| 分組顏色 | 同檔的 `--s-wind`／`--s-bow`… 和 `.sec-*` class，依新的分組改名 |
| 字型 | `index.html` 的 Google Fonts 連結、`css/app.css` 的 `--f-kai`／`--f-body` |
| Supabase 連線 | `config.js`：換成新社團自己的專案網址與 publishable key（見 `docs/SETUP.md`） |
| 全域變數名 | `HUAXIA_CONFIG`、`HUAXIA_DEMO`（`config.js`、`js/core.js`）可改成新社團的名字，兩邊一起改 |
| 給 AI 的個人習慣 | `CLAUDE.md` 換成新社團維護者的版本 |
| 說明文件 | `README.md`、`docs/*`：社名、帳號、聯絡人 |
| 授權 | `LICENSE` 保留原著作權行，可以在下面加一行自己的 |

## 2. 調整身分組、分組、活動類型

照 `club.md` §3、§4 改。每一項都是「資料庫＋前端＋測試」三處一起動：

- **身分組**：照 `AGENTS.md` §4「新增或改身分組時」那四步。只改顯示名稱的話，改 `js/logic.js` 的 `ROLE_LABEL` 就好，**代號不要改**（代號寫在資料庫約束和 policy 裡）。
- **分組**：`schema.sql` 裡所有 `section in (...)` 約束、`guess_section` 函式；`js/logic.js` 的 `SECTIONS`、`guessSection`；CSS 的分組顏色。不分組的社團：保留欄位但刪掉約束與自動判斷，或整個拿掉（要連 `leader` 看自己組的 policy 一起改）。
- **活動類型**：`schema.sql` 的 `events.kind` 與 `events.kinds` 約束；`js/logic.js` 的 `KIND_LABEL`、`eventDefaults`、`kindsDefaults`；`calendarsFor` 決定同步到哪個日曆。
- **出席率規則**：預設值在 `schema.sql` 的 `settings` 的 `attendance_rules`，計算在 `is_expected` 和 `attendance_stats`。上線後管理員也能在設定頁調整權重。
- **公告分類**：`schema.sql` 的 `announcements_channel_check`、`announcements_category` 觸發器；`announcements.js` 的分類清單；`settings.js` 的 `CH_LABEL`；`app.js` 的 `SHARE_CATS` 相關路由。

## 3. 拿掉不要的功能

### 通用步驟

1. **找出所有痕跡**：用功能的資料表名、頁面檔名、中文名稱搜尋整個 repo。
2. **前端**：刪頁面檔 → 刪 `js/app.js` 的 import 和 `NAV` 項目 → 刪其他頁面裡引用它的區塊與 import → 刪 `js/logic.js` 裡只有它用的函式 → 刪 CSS。
3. **資料庫**：刪 `create table`、相關函式、觸發器、policy → **從 RLS 迴圈的資料表陣列拿掉**（`schema.sql`「存取規則」開頭的 `foreach t in array[...]`，留著會因為找不到表而整份跑失敗）→ 其他函式若有引用也要改。
4. **備份**：從 `js/views/settings.js` 的 `BACKUP_TABLES` 拿掉。
5. **示範資料**：從 `js/mock.js` 拿掉該表的假資料。
6. **後端**：`supabase/functions/` 和 `_shared/common.ts` 裡有提到的地方，改完跑 `node scripts/bundle-functions.mjs`。
7. **測試**：刪掉只測這個功能的測試；其他測試的種子資料若用到它，改寫種子資料。
8. **已上線的資料庫**：新社團從零開始的話不用管。若資料庫已經有這張表，另外給管理員一段 `drop table if exists ... cascade;`，**不要寫進 `schema.sql`**（避免誤刪別人的資料），並說清楚會刪掉什麼。
9. `npm test` 全過，`?demo` 每一頁點過一次沒有錯誤。

### 範例 A：拿掉「座位表」

座位表是最獨立的國樂功能，適合當第一個練習。

| 步驟 | 動作 |
|---|---|
| 搜尋 | `grep -rnE "seat|Seat|seating" --exclude-dir=node_modules .` |
| 頁面 | 刪 `js/views/seating.js`；`js/app.js` 刪 `import './views/seating.js'` |
| 曲目頁裡的預覽 | `js/views/pieces.js`：刪 `import { seatSvg } from './seating.js'`；第 2 行 import 拿掉 `autoSeat, reconcileSeats, STAGES`；刪讀 `seating_charts` 的查詢、`seatStage`／`seatList` 兩個變數、「座位表」那個 `<section class="card">` |
| 純邏輯 | `js/logic.js`：刪 `STAGES`、`SEAT_STYLES`、`autoSeat`、`conductorAt`、`reconcileSeats` 及只給它們用的常數與小函式（刪之前 grep 確認沒有別人用） |
| CSS | `css/app.css`：刪 `.seat-*` 規則；列印區塊裡的 `.seat-tools` 也拿掉 |
| 資料庫 | `schema.sql`：刪 `create table seating_charts`、`seating_touch` 觸發器、`seat_read`／`seat_write` policy；RLS 迴圈陣列拿掉 `'seating_charts'` |
| 備份與假資料 | `settings.js` 的 `BACKUP_TABLES`、`mock.js` 的 `seating_charts: []` |
| 測試 | `tests/logic.test.mjs` 刪 `autoSeat` 相關測試；`tests/schema.test.mjs` 刪 `seating_charts` 那幾行斷言 |
| 驗證 | `npm test`；`?demo` 打開任一首曲目，頁面正常、沒有座位表區塊 |

### 範例 B：拿掉整組國樂功能（曲目、編制、樂譜、座位表、槍手、絲竹）

這比較大，**依賴順序很重要**，照下面順序做，每步跑一次測試：

1. **座位表** → 照範例 A。
2. **絲竹**：行程類型 `sizhu`、公告分類 `sizhu`、`pieces.ensemble` 欄位、`ensemble_members` 表、`my_mentions` 裡「標記全體」的判斷、`notify` 函式裡的絲竹分支。
3. **樂譜**：`scores` 表、`can_read_score`、Storage bucket `scores` 的建立與 policy、`pieces.js` 的上傳與檔名配對（`parseNeeded`、`partNameFromFile`、`matchPart`）。
4. **槍手**：`ringers` 表、身分組 `ringer`（約束、`is_insider`、`perms().ringerOnly`、`NAV` 裡的 `show`）、`part_assignments.ringer_id`、`notify` 裡的槍手分支、公告對象 `ringers`／`all` 的說明文字。
5. **曲目與編制**：`pieces`、`piece_parts`、`part_assignments`、`event_pieces`，以及 `in_piece`、`in_part`、`can_staff_part`、`guess_section`。
6. **出席率的「無曲」判斷**——最容易漏：`is_expected` 目前用「這場有沒有排曲目、這個人有沒有排進編制」決定該不該出席。拿掉曲目後要改成新社團的規則（例如「看活動的對象：全體／某組／幹部」），`ATT_LABEL` 的 `na: '無曲'` 改名或拿掉，並改寫出席率測試。
7. **`can_see_event`**：最後一行用 `event_pieces` 讓槍手看到自己的行程，一起改掉。

### 範例 B 的完成標準

- `grep -rnE "piece|ringer|sizhu|score|seat|絲竹|槍手|曲目|樂譜|編制" --exclude-dir=node_modules .` 只剩刻意保留的（例如歷史文件）。
- `npm test` 全過，`schema.sql` 在空資料庫連跑兩次都成功（測試已經會做）。
- `?demo` 所有頁面正常，選單沒有空的項目。

## 4. 新增一個功能

### 通用步驟

1. **先寫清楚**：誰用、能看什麼、能改什麼、存哪些欄位。權限講不清楚就先問人。
2. **資料庫**（`schema.sql`，放在相近的區段）：`create table if not exists` → 加進 RLS 迴圈陣列 → 寫 policy（用現有的身分判斷函式）→ 需要時加 `touch_updated` 觸發器。
3. **先寫測試**：`tests/schema.test.mjs` 寫「該能做的做得到、不該做的做不到」；有純邏輯就放 `js/logic.js` 並寫 `tests/logic.test.mjs`。先看到測試失敗，再寫實作。
4. **前端**：新增 `js/views/<功能>.js`，照現有頁面寫法；`js/app.js` 加 import 和 `NAV` 項目（`show` 用 `perms()` 的欄位）。權限需要新欄位就加在 `perms()`，並與 SQL 一致。
5. **周邊**：加進 `BACKUP_TABLES`；`mock.js` 加假資料；需要 CSS 就用現有變數。
6. **文件**：`AGENTS.md` §3 的功能表加一列；`club.md` 的功能清單加一列。
7. `npm test` 全過，`?demo` 實際操作一次：新增、修改、刪除，以及用不同身分（假資料裡切換）看看權限對不對。

### 範例：新增「器材借用」

需求（假設 `club.md` 這樣寫）：社員登記借哪件器材、預計哪天還；本人看得到自己的紀錄；幹部看得到全部、可以標記已歸還；逾期的要顯示紅色。

**資料庫**（`schema.sql`，放在「公告、任務」區段後面）：

```sql
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  item text not null,
  borrowed_on date not null default current_date,
  due_on date not null,
  returned_on date,
  note text not null default '',
  created_at timestamptz not null default now()
);
```

RLS 迴圈陣列加上 `'loans'`，然後在 policy 區加：

```sql
-- 器材借用：本人看自己的、可以新增；幹部看全部、可以改與刪
create policy loan_read on public.loans for select using (user_id = auth.uid() or public.is_officer());
create policy loan_insert on public.loans for insert with check (public.is_insider() and user_id = auth.uid());
create policy loan_officer on public.loans for update using (public.is_officer()) with check (public.is_officer());
create policy loan_delete on public.loans for delete using (public.is_officer());
```

**純邏輯**（`js/logic.js`）：

```js
// 借用狀態：已還／逾期／借用中
export function loanStatus(loan, now = new Date()) {
  if (loan.returned_on) return 'returned';
  return daysFromToday(loan.due_on + 'T12:00:00+08:00', now) < 0 ? 'overdue' : 'out';
}
```

**測試**：

- `tests/logic.test.mjs`：`loanStatus` 三種狀態各一個案例。
- `tests/schema.test.mjs`：社員 B 能新增自己的借用、看不到別人的、不能把自己的改成已歸還；管理員 A 看得到全部、能標記歸還；槍手 R 不能新增。

**頁面**（`js/views/loans.js`）：照 `tasks.js` 的結構——上方 `pageHead`，社員有「＋ 登記借用」按鈕（用 `formDialog`，欄位：器材、預計歸還日、備註），清單依 `loanStatus` 顯示 `chip`（逾期用 `bad`），幹部每列多一個「已歸還」按鈕。檔尾 `route('/loans', ...)`。

**接上**：`js/app.js` 加 `import './views/loans.js'`，`NAV` 加 `{ path: '/loans', label: '器材', group: '社團', show: (p) => p.insider }`；`BACKUP_TABLES` 加 `'loans'`；`mock.js` 加兩三筆假資料（含一筆逾期）。

**收尾**：`AGENTS.md` §3 加「器材借用｜`loans.js`｜`loans`｜共用」；`npm test`；`?demo` 試借、試還、看逾期顏色。

## 5. 交付

1. `npm test` 全過。
2. 列出改了什麼、刪了什麼、新增了什麼，以及**人要手動做的事**（例如在 Supabase 跑 SQL、設定 Secrets、Discord webhook）。
3. 推到分支，讓人在 `?demo` 看過再合併。資料庫已上線的社團，先給 SQL、確認跑完再合併。
