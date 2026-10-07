# 交接手冊

系統由 4 個外部帳號組成。目前都掛在 Eddy 的個人帳號，建議申請**社團共用 Gmail** 後整組轉過去，之後每屆只要交接這一組帳號密碼。

| 服務 | 用途 | 轉移方式 |
|---|---|---|
| GitHub | 放網站程式、提供網址 | repo → Settings → Transfer ownership 給社團帳號；網址會變，記得同步改 Supabase 的 Site URL 與 Discord Redirect |
| Supabase | 資料庫、登入、後端函式 | Organization → Members 邀請社團帳號為 Owner，再把自己移除 |
| Google Cloud | 行事曆服務帳戶 | 專案 → IAM 加入社團帳號為「擁有者」。行事曆屬於服務帳戶，不受個人帳號影響 |
| Discord Developer | Discord 登入 | Application → 轉移到社團的 Team，或請社團帳號重建後更新 Supabase 的 Client ID/Secret |

## 每屆換屆要做的事

1. **設定 → 學期**：新增新學期並設為目前學期（舊學期資料保留，出席率分開算）。
2. **成員**：調整幹部、組長身分組；畢業或離團的人改成「停用」。
3. 把**管理員**交給下一任（系統不允許移除最後一位管理員，先加新的、再移除自己）。
4. 交接本文件與帳號密碼。

## 不要做的事

- 不要把 Supabase 的 `service_role` / `secret` key、Google 服務帳戶 JSON 放進 GitHub 或聊天群組。
- 不要在 SQL Editor 直接刪資料表；要清資料請先匯出備份（Database → Backups）。
