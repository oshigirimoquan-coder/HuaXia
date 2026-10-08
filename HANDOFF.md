# HANDOFF

## 目標與驗收
華夏國樂社專用系統的**架構版**：功能齊全可操作，尚未接上正式帳號、未匯入社員資料。
驗收：示範模式各頁正常、資料庫權限測試通過、社長看過懶人包並回覆待決事項。

## 本輪狀態（2026-10-08）
- 完成：schema（26 張表＋RLS＋出席率函式）、前端 11 個頁面、3 個 Edge Functions、示範模式、設定與交接文件。
- 驗證證據：
  - `npm test` → 22/22 通過（11 個邏輯、11 個資料庫權限情境）
  - Playwright 截圖 12 個頁面 × 桌機 1280／手機 375：無橫向捲動、無 JS 錯誤
  - Edge Functions 以 esbuild 解析通過
- 尚未驗證（需要真實帳號）：Google 行事曆同步、Discord 登入、Discord webhook、每日提醒排程、Storage 上傳下載。
- 本輪自行決定：Email＋密碼為備用登入；出席率「目前」只算已點名場次；未點名場次不算缺席；示範模式用虛構姓名。

## 2026-10-08 更新
- 社長決定：只發 DC；晚到早退有預告算 1、沒預告算 0.5（設定頁 unexcused_weight）；招生報名表要做；公演清單用公告。
- 新增：`applications` 表（匿名可在開放期間送出）、`#/join` 公開報名頁、「招生」管理頁、`settings.recruit_open`。
- 介面改版：石青石綠、楷書標題、行書動態標誌（`js/mark.js`，Yuji Syuku 字形，OFL）。
- 驗證：`npm test` 25/25；Playwright 桌機／手機截圖無橫向捲動、無 JS 錯誤。
- 上線前要在 Supabase 重新執行一次 `supabase/schema.sql`（可重複執行，不會刪資料）。

## 2026-10-08 頻道與導覽列
- 新增頻道（`announcements.channel`）：公告 main、絲竹 sizhu（附絲竹行程）、音樂會 concerts（社內成員都能分享，只能改刪自己的）、校友團 alumni。
- 導覽列依性質分段（練習／社團／交流），電腦版可左右捲動；槍手、招生、設定在「幹部」下拉選單。
- 通知依頻道送到對應 DC webhook（設定頁可填，沒填就送公告頻道）。
- 驗證：`npm test` 28/28；桌機 1280／960、手機 375 截圖無橫向捲動與 JS 錯誤。

- 絲竹名單（`ensemble_members`）＋公告標記（`mentions`、`mention_all`）；`my_mentions()` 給首頁「有人提到你」與絲竹紅點；
  `discord_ids()` 只給後端（已 revoke），notify 用它 @ 人；@全體絲竹 用設定頁的 DC 身分組 ID。`npm test` 31/31。

## 2026-10-08 長期維護
- `.github/workflows/keepalive.yml`：每 3 天連資料庫、登入服務、網站；失敗 GitHub 寄信。
- 設定頁「匯出備份」：26 個表格 JSON＋出席率 CSV＋名冊 CSV（不含 private_settings）；`settings.last_backup_at`；`backupDue()` 控制首頁提醒。
- `docs/MAINTENANCE.md`。`npm test` 33/33。

## 2026-10-08 行程類型複選
- `events.kinds text[]`；觸發器讓 `kind` = 第一個（照類型順序），舊資料自動補 `kinds`。
- `is_expected` 改成任一類型符合就算應出席；絲竹排練沒指定曲目時只算絲竹名單上的人（名單是空的就算全體）。
- 前端 `kindsDefaults()`／`kindsLabel()`；通知、行事曆、每日提醒顯示「大團・絲竹」。`npm test` 38/38。

## 2026-10-08 公告改版（社長手寫回饋）
- 公告分類＝`announcements.channel`：performance 華夏演出｜tutti 大團｜sizhu 絲竹｜class 教學班｜alumni 校友團｜concerts 音樂會｜resources 資源。
  舊的 main 由觸發器依 type 轉換；音樂會、資源開放社員分享（只能改刪自己的）。
- 對象多 `sizhu`：大家看得到，自動 mention_all 提醒絲竹名單。
- 選單：拿掉教學、任務、絲竹、音樂會、校友團；「教學班」進度移到幹部選單（canTeach）；任務與練習回報資料保留但不顯示。
- `npm test` 41/41；桌機／手機截圖檢查公告頁、分類切換、發布對話框欄位切換。

## 下一步
1. 社長回覆 `docs/open-questions.md`。
2. 使用者建立 GitHub repo，經同意後推送並開 Pages。
3. 照 `docs/SETUP.md` 設定 Supabase（第 2 個免費專案）、Discord、Google Cloud。
4. 上線後用兩個測試帳號做一次完整 QA（請假、點名、樂譜權限、行事曆同步）。

## 已知風險
- 槍手帳號可以讀到所有啟用中成員的名字與組別（不含聯絡方式）。
- `is_expected` 可被任何登入者呼叫，能推得某人是否被排到某場次；風險低。
- Supabase 免費專案 7 天沒人用會暫停。

## 2026-10-08 分組樂譜、工具頁
- 樂譜可依「組別」發（scores.section）：批次上傳依檔名猜組（js/logic.js `guessSection`，DB 端 `guess_section` 規則一致），組員看自己那組；槍手看排到的曲子裡同組的譜（piece_parts.section 依名稱自動填）。
- 讀譜權限統一在 `can_read_score()`，表格與 Storage 共用。
- 「工具」頁（#/tools）：settings.tools 清單，外部連結開新分頁，管理員可編輯。

## 2026-10-08 座位表、組長排人
- 座位表（#/pieces/:id/seating，表 seating_charts，每首一份）：`autoSeat()` 依編制排（拉弦左前、彈撥右前、低音接彈撥後、吹管後排、打擊最後），舞台預設 教室/演講廳/音樂廳/自訂，弧形或直排；拖曳微調、列印。`reconcileSeats()` 讓編制變動後保留舊位置。
- 排人權限 `can_staff_part()`：幹部全部、組長自己組、小老師自己帶的聲部。組長看不到槍手名單，槍手仍由幹部排。
