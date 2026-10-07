# 上線設定步驟

整個流程約 40 分鐘。順序很重要：先做資料庫，再做登入，最後做行事曆與通知。
**所有金鑰都填在各服務的後台，不要貼到聊天或任何文件裡。**

## 0. 先看示範模式

網站網址後面加 `?demo`（例如 `https://<帳號>.github.io/<repo>/?demo`），可以在不連資料庫的情況下看到完整介面。資料都是虛構的。

## 1. Supabase（資料庫）

1. 到 <https://supabase.com> 建立新專案（免費方案每個帳號最多 2 個專案）。Region 選 **Northeast Asia (Tokyo)**。
2. 左側 **SQL Editor → New query**，貼上 `supabase/schema.sql` 全部內容 → **Run**。出現 `Success` 就完成。
3. 左側 **Authentication → Sign In / Providers**：
   - **Email**：保持開啟，**Confirm email 關掉**（免費方案寄不出確認信）。
4. **Project Settings → API Keys**：記下 **Project URL** 與 **publishable key**（`sb_publishable_` 開頭），第 6 步要填。

## 2. Discord 登入

1. 到 <https://discord.com/developers/applications> → **New Application**，名稱填「華夏國樂社」。
2. 左側 **OAuth2**：複製 **Client ID**，按 **Reset Secret** 取得 **Client Secret**。
3. 回 Supabase **Authentication → Sign In / Providers → Discord**，打開，貼上 Client ID 與 Secret，複製畫面上的 **Callback URL**，Save。
4. 回 Discord **OAuth2 → Redirects → Add Redirect**，貼上剛剛的 Callback URL，Save。
5. Supabase **Authentication → URL Configuration**：**Site URL** 與 **Redirect URLs** 都填網站網址（例如 `https://<帳號>.github.io/<repo>/`）。

## 3. Google 行事曆（服務帳戶）

1. Google 帳號先開啟**兩步驟驗證**（Google Cloud 強制要求）。
2. <https://console.cloud.google.com> → 建立專案 `huaxia`。
3. 上方搜尋 **Google Calendar API** → **啟用**。
4. 左側 **IAM 與管理 → 服務帳戶 → 建立服務帳戶**，名稱 `huaxia-calendar`，角色不用選，完成。
5. 點進這個服務帳戶 → **金鑰 → 新增金鑰 → JSON**，會下載一個 `.json` 檔。**這個檔案等同密碼，不要傳給任何人。**
6. 回 Supabase **Edge Functions → Secrets**，新增：
   - `GOOGLE_SERVICE_ACCOUNT`：用記事本打開 JSON 檔，全部內容貼上
   - `SITE_URL`：網站網址
   - `CRON_SECRET`：自己打一串 30 字以上的亂碼

> 不需要設定 OAuth 同意畫面；服務帳戶不用。

## 4. 後端函式

Supabase **Edge Functions → Deploy a new function → Via Editor**，建立三個函式，名稱必須完全一致：

| 函式名稱 | 貼上的檔案 | 「Verify JWT」 |
|---|---|---|
| `calendar-sync` | `supabase/dashboard/calendar-sync.ts` | 開啟 |
| `notify` | `supabase/dashboard/notify.ts` | 開啟 |
| `daily-reminder` | `supabase/dashboard/daily-reminder.ts` | **關閉**（排程呼叫，用 CRON_SECRET 驗證） |

> 會用指令列的人也可以 `npx supabase functions deploy`，來源在 `supabase/functions/`。修改來源後執行 `node scripts/bundle-functions.mjs` 重新產生單檔版。

## 5. 每日提醒排程

打開 `supabase/cron.sql`，把 `<PROJECT_REF>` 和 `<CRON_SECRET>` 換掉，貼到 SQL Editor 執行。

## 6. 網站

1. 編輯 `config.js`，填入第 1 步的 Project URL 與 publishable key。
2. 推上 GitHub，在 repo 的 **Settings → Pages** 選 `main` / `(root)`。

## 7. 第一次登入（社長或管理員）

1. 打開網站，**第一個登入的人自動成為管理員**。
2. **設定 → 學期**：新增 `114-1` 並設為目前學期。
3. **設定 → Google 行事曆**：按「建立／檢查行事曆」。
4. **設定 → 通知**：在 DC 頻道設定 → 整合 → Webhook 建立網址，貼到公告頻道與幹部頻道。
5. **我的設定**：填 Google 信箱，並把行事曆加到自己的 Google 日曆。
6. 把網址貼到 DC，社員登入後到 **成員** 核准。
