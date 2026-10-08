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

## 下一步
1. 社長回覆 `docs/open-questions.md`。
2. 使用者建立 GitHub repo，經同意後推送並開 Pages。
3. 照 `docs/SETUP.md` 設定 Supabase（第 2 個免費專案）、Discord、Google Cloud。
4. 上線後用兩個測試帳號做一次完整 QA（請假、點名、樂譜權限、行事曆同步）。

## 已知風險
- 槍手帳號可以讀到所有啟用中成員的名字與組別（不含聯絡方式）。
- `is_expected` 可被任何登入者呼叫，能推得某人是否被排到某場次；風險低。
- Supabase 免費專案 7 天沒人用會暫停。
