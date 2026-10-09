# AGENTS.md — 給 AI 看的專案說明

這是一套社團管理網站：行程、請假、點名與出席率、公告、任務、教學班、招生，外加國樂社專用的曲目編制、樂譜、座位表、槍手、絲竹。
目前跑在華夏國樂社。其他社團 fork 後，照 `club.md`（需求表）和 `CUSTOMIZE.md`（改造步驟）讓 AI 改程式。**本專案沒有設定開關，客製就是直接改程式碼。**

> 開工前先讀：`club.md`（這個社團要什麼）→ 本檔 → 要改造時讀 `CUSTOMIZE.md`。
> `CLAUDE.md` 是原作者（華夏）的個人工作習慣，fork 後應改成新社團自己的版本。

## 1. 技術架構

| 層 | 用什麼 | 放哪 |
|---|---|---|
| 前端 | 純 HTML／CSS／JavaScript（ES modules），**沒有建置步驟、沒有框架** | GitHub Pages |
| 資料庫與權限 | Supabase Postgres＋RLS | `supabase/schema.sql`（整份可重複執行） |
| 登入 | Supabase Auth（Discord、Email） | Supabase 後台 |
| 後端函式 | Supabase Edge Functions（Deno） | `supabase/functions/*` |
| 行事曆 | Google Calendar 服務帳戶 | `calendar-sync` 函式 |
| 通知 | Discord webhook | `notify`、`daily-reminder` 函式 |
| 排程 | Supabase pg_cron | `supabase/cron.sql` |
| 保活 | GitHub Actions 每 3 天連一次 | `.github/workflows/keepalive.yml` |

不要引入 npm 套件到前端、不要加 bundler。外部函式庫只能用 CDN 的 ES module（目前只有 supabase-js）。

## 2. 檔案地圖

```
index.html            頁面外殼、網站標題、favicon、字型
config.js             Supabase 網址與 publishable key（公開的，見 §5）
css/app.css           全部樣式；顏色在檔案開頭的 :root 變數（亮色＋兩段暗色）
js/app.js             外框、選單（NAV 陣列）、登入流程、載入各頁面
js/core.js            連線、全域 state、表單對話框 formDialog、路由 route()、共用小元件
js/logic.js           純邏輯，沒有畫面也沒有網路，全部有測試
js/mark.js            社團標誌（SVG 字形，含書寫動畫）
js/mock.js            示範模式（?demo）的假資料庫
js/views/*.js         每個頁面一個檔，檔尾用 route('/路徑', fn) 註冊
supabase/schema.sql   資料表、身分判斷函式、出席率計算、觸發器、RLS
supabase/functions/   Edge Functions 原始碼（_shared/common.ts 是共用）
supabase/dashboard/   上面函式的單檔版（自動產生，不要手改）
tests/                node:test；logic 測 js/logic.js，schema 用 PGlite 在本機跑 schema.sql 測權限
materials/            新社團放標誌、配色、範例資料的地方（見 materials/README.md）
docs/                 給人看的設定、交接、維護手冊
```

## 3. 功能在哪

「共用」= 大部分社團都用得到；「國樂」= 華夏專用，其他社團多半要拿掉或改寫。

| 功能 | 頁面 (`js/views/`) | 資料表 | 類別 |
|---|---|---|---|
| 首頁 | `home.js` | （讀取其他表） | 共用 |
| 行程（類型可複選、同步 Google 日曆） | `events.js` | `events`, `event_pieces`, `calendars` | 共用；`event_pieces` 與類型 `tutti`/`sizhu`/`sectional`/`dress`/`concert` 是國樂用語 |
| 請假、點名、出席率 | `attendance.js`, `events.js` | `leave_requests`, `attendance`；函式 `is_expected`, `event_roster`, `attendance_stats`, `attendance_detail` | 共用；但「無曲」判斷依賴曲目編制 |
| 公告（分類頻道、標記人、已讀） | `announcements.js` | `announcements`, `announcement_reads`, `ensemble_members` | 共用；`sizhu` 頻道與 `ensemble_members` 是國樂 |
| 任務 | `tasks.js` | `tasks` | 共用 |
| 成員、身分組 | `members.js`, `me.js` | `profiles`, `profile_private`, `user_roles` | 共用；「組別」欄位用國樂五組 |
| 教學班、進度、練習回報 | `teaching.js` | `classes`, `class_students`, `class_milestones`, `class_progress`, `resources`, `practice_reports`, `report_feedback` | 共用 |
| 招生報名（免登入 `#/join`） | `recruit.js` | `applications` | 共用 |
| 外部小工具連結 | `tools.js` | `settings.tools` | 共用 |
| 設定、學期、備份匯出 | `settings.js` | `semesters`, `settings`, `private_settings` | 共用 |
| 曲目、編制（聲部排人） | `pieces.js` | `pieces`, `piece_parts`, `part_assignments` | 國樂 |
| 樂譜（分譜、分組譜） | `pieces.js` | `scores`＋Storage bucket `scores` | 國樂 |
| 座位表 | `seating.js` | `seating_charts`；`logic.js` 的 `autoSeat` 等 | 國樂 |
| 槍手（外援） | `ringers.js` | `ringers`；身分組 `ringer` | 國樂（但「外援」概念別的社團可能也用得到） |
| 絲竹（小樂團） | `pieces.js`, `announcements.js` | `pieces.ensemble`, `ensemble_members`, 行程類型 `sizhu` | 國樂 |
| 五個組別（吹管、拉弦、彈撥、打擊、低音） | 幾乎所有頁面 | `profiles.section`, `scores.section`, `piece_parts.section`；`logic.js` 的 `SECTIONS`、`guessSection`；SQL 的 `guess_section` | 國樂；別的社團改成自己的分組（或拿掉） |

國樂字眼散落處的快速檢查：

```bash
grep -rnE "sizhu|絲竹|ringer|槍手|seating|scores|piece_parts|SECTIONS|guessSection|華夏" --exclude-dir=node_modules .
```

## 4. 權限規則

**資料庫的 RLS 才是真正的把關**（`supabase/schema.sql` 後半）。前端 `js/logic.js` 的 `perms()` 只決定畫面顯示什麼。**兩邊必須一致**：改一邊就要改另一邊，並補測試。

身分組（`user_roles.role`，一人可多個）：

| 代號 | 名稱 | 重點 |
|---|---|---|
| `admin` | 管理員 | 全部權限；系統至少保留一位（觸發器 `keep_one_admin`） |
| `officer` | 幹部 | 管行程、曲目、公告、成員、點名 |
| `leader` | 組長 | 看自己組的請假與點名、排自己組的人、調座位表 |
| `teacher` | 指導老師 | 看全部樂譜、帶教學班 |
| `member` | 社員 | 一般成員 |
| `newbie` | 新生 | 社員的一種，可收新生專屬公告 |
| `alumni` | 校友 | 看得到社內資訊；排進當天編制才算出席 |
| `ringer` | 槍手 | 外援，只看自己參與的曲目與行程 |

帳號狀態 `profiles.status`：`pending`（待核准）／`active`（啟用）／`inactive`（停用，紀錄保留）。**第一位登入的人自動成為管理員**（`handle_new_user`），之後的人都要核准。

SQL 身分判斷函式（RLS 都用這些，不要在 policy 裡重寫判斷）：
`is_active()`、`has_role(r)`、`is_admin()`、`is_officer()`（admin 或 officer）、`is_staff()`（officer 或 teacher）、`is_insider()`（不含只有 ringer 的人）、`my_section()`、`leads_user(uid)`、`in_piece(pid)`、`in_part(part)`、`teaches_class(cid)`、`in_class(cid)`、`can_see_event(e)`。

新增或改身分組時，要一起改的地方：
1. `schema.sql`：`user_roles_role_check` 約束、相關判斷函式（如 `is_insider`）、受影響的 policy
2. `js/logic.js`：`ROLE_LABEL`、`perms()`
3. `js/app.js`：`NAV` 的 `show` 條件
4. `tests/`：至少一個「該看的看得到、不該看的看不到」測試

新增資料表時一定要：`alter table ... enable row level security;`＋讀寫 policy＋加進 `settings.js` 的 `BACKUP_TABLES`。

## 5. 金鑰規定

- `config.js` **只能放 publishable key**（`sb_publishable_...`，或舊式 anon key）。這把本來就會出現在網頁上，安全靠 RLS。
- **絕不**把 `service_role` / secret key、Google 服務帳戶 JSON、Discord webhook 網址、Bot token 寫進任何檔案或 commit。
- 後端需要的值放 **Supabase → Edge Functions → Secrets**：`SUPABASE_SERVICE_ROLE_KEY`（內建）、`GOOGLE_SERVICE_ACCOUNT`、`CRON_SECRET`、`SITE_URL`。
- Discord webhook 網址存在資料表 `private_settings`（只有管理員與後端讀得到），不放程式碼。
- fork 之後 `config.js` 裡還是原社團的 Supabase 網址：**新社團必須換成自己的 Supabase 專案**，不能共用。
- 發現金鑰被 commit：立刻到該服務後台作廢重發，再清掉檔案。只刪 commit 不夠。

## 6. 改完要做

```bash
npm install          # 第一次
npm test             # 必須全過才算完成
node scripts/bundle-functions.mjs   # 有改 supabase/functions/* 時
python3 -m http.server 8000         # 開 http://localhost:8000/?demo 用假資料看畫面
```

- 改了 `js/logic.js` → 補 `tests/logic.test.mjs`。
- 改了 `schema.sql` 的表、函式或 policy → 補 `tests/schema.test.mjs`。`schema.sql` 要能**對已上線的資料庫重複執行**：用 `create ... if not exists`、`add column if not exists`、`drop ... if exists` 再建，不要寫只能跑一次的 SQL。
- 改了資料表 → `js/mock.js` 的假資料也要跟著改，否則 `?demo` 會壞。
- 改了 `supabase/functions/*` → 重新產生 `supabase/dashboard/*`，不要手改 dashboard 版。
- 拿掉頁面後，搜尋整個 repo 確認沒有殘留的 import、`NAV` 項目、`route()`、`BACKUP_TABLES` 項目、CSS class。

## 7. 程式風格

- 介面文字一律繁體中文，白話、短句。
- 新頁面照現有 `js/views/*.js` 的寫法：從 `core.js` import 工具，HTML 用 template string，**所有使用者內容都要經過 `esc()`**。
- 共用邏輯放 `logic.js`（不碰 DOM、不碰網路），才能測。
- 顏色只用 `css/app.css` 的 CSS 變數，不要在頁面寫死色碼。
- 時區預設 `Asia/Taipei`（`logic.js` 的 `TZ`）。
- 不要匯入真實成員資料到 repo 或測試；測試用固定的假 UUID。
