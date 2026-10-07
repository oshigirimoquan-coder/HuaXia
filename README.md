# 團隊事務台

多人協作的事務網站，包含任務指派、排班與活動報名、公告留言、點名出席和成員審核。

- 前端：純 HTML/JS，放在 GitHub Pages
- 後端：Supabase（資料庫加 Email 登入，免費方案即可）

## 設定步驟（第一次，約 15 分鐘）

### 1. 建立 Supabase 專案
1. 到 <https://supabase.com> 註冊，按 **New project**。Region 選 Tokyo 或 Singapore，資料庫密碼自己記好。
2. 專案建好後，左側 **SQL Editor** → **New query**，把 `schema.sql` 整份貼上，按 **Run**。

### 2. 設定登入方式（Email + 密碼）
1. Supabase 左側 **Authentication** → **Sign In / Providers**。
2. 確認 **Email** 是開啟的（預設就是）。
3. 把 **Confirm email** 關掉 → Save。
   免費方案內建的寄信功能只能寄給專案成員，開著的話社員會收不到確認信而無法登入。
   因為每個新帳號都要負責人或管理者核准，關掉信箱確認不影響安全。

### 3. 接上網站
Supabase 的 **Project Settings → API**，複製 **Project URL** 和 **anon public** key，填進 `config.js`：

```js
window.TEAM_DESK_CONFIG = {
  url: "https://xxxx.supabase.co",
  anonKey: "eyJ..."
};
```

anon key 設計上可以公開；**service_role key 絕對不能放進來**。

### 4. 第一次登入
打開網站，按「註冊帳號」用 Email 和密碼註冊。**第一個登入的人會自動成為負責人**，所以請你自己先登入。
之後把網址傳給成員，他們登入後會出現在「成員與出席」的等待核准清單。

## 角色

| 角色 | 可以做的事 |
|---|---|
| 負責人 | 所有功能；指定或取消管理者；改團隊名稱 |
| 管理者 | 發公告、建立活動與時段、點名、核准或移出一般成員 |
| 成員 | 報名與登記班表、新增和更新任務、留言 |
| 待審核 | 只能看到等待畫面 |

權限由資料庫規則（Row Level Security）強制執行，不是只把按鈕藏起來。

## 免費方案注意
Supabase 免費專案如果**連續 7 天沒有任何使用**會被暫停，回後台按 Restore 即可恢復，資料不會遺失。

## 忘記密碼
免費方案沒有寄信功能，所以沒有「忘記密碼」按鈕。成員忘記密碼時，負責人到 Supabase **Authentication → Users** 找到該帳號 → **Send password recovery** 不可用時，可以直接刪除該使用者，讓對方重新註冊，再核准一次。
