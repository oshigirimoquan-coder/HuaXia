# STATUS

階段：**已上線使用**（https://nccu-huaxia.github.io/HuaXia/），2026-10 完成介面改版。

- 網站：GitHub Pages（repo `nccu-huaxia/HuaXia`，2026-11 從舊帳號搬過來），推上 `main` 約 1–3 分鐘生效
- 資料庫：Supabase（目前在 Eddy 的帳號）；改資料庫要先在 SQL Editor 執行 `supabase/schema.sql`，再合併網站的修改
- 示範模式（`?demo`）已移除
- 每晚提醒的 Edge Function 實際名稱是 `daily-reminder-`（多一個 `-`），排程（`supabase/cron.sql`）呼叫這個名字

## 進行中（2026-11-10）
1. 發公告告訴大家換新網址
2. Supabase 專案等 Eddy 轉到「政大華夏國樂社」組織
3. 「用 Discord 登入」改用社團自己的 Discord 應用程式（華夏恐ㄎ一ㄤ龍）：Supabase 後台換 Client ID／Secret、Discord 加 Redirect
4. 換網址後要同步：Supabase 的 Site URL／Redirect URLs、Edge Function Secret `SITE_URL`

最新紀錄見 `HANDOFF.md`；待決事項見 `docs/open-questions.md`。
