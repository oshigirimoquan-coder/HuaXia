# 給接手的 AI / 開發者

- 使用者（Eddy）沒有程式背景，說明用白話、先講結論。
- 權限以資料庫 RLS 為準（`supabase/schema.sql`）；前端 `js/logic.js` 的 `perms()` 只決定顯示什麼，兩邊要一致。
- 泠靈（Ling Ling Suite）直接寫入曲目、聲部、樂譜、場次與 Storage，並呼叫 `lingling_publish`：改這些資料表、`is_officer()`、Storage 權限或發譜函式之前先看 `docs/LINGLING.md`。
- 改 schema 後跑 `npm test`；改 `supabase/functions/*` 後跑 `node scripts/bundle-functions.mjs`。
- 不匯入真實社員資料，除非社長確認（見 `docs/open-questions.md` #9）。
- 改完直接推上 GitHub，不用先問（Eddy 2026-10-08 指示）。例外：有改資料庫時，先給他要跑的 SQL，確認跑完再推。
- 金鑰只放在 Supabase Secrets；`config.js` 只能放 publishable key。
- commit 作者用 Eddy 的帳號：`git config user.name swiming`、`git config user.email swiming929@gmail.com`（2026-11-09 指示，Claude 只放在 Co-Authored-By）。
