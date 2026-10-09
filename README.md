# 華夏國樂社系統

行程、請假、點名與出席率、公告、任務、曲目編制、樂譜、分部課、教學班、槍手管理。

- 前端：純 HTML／CSS／JavaScript（ES modules），放 GitHub Pages
- 後端：Supabase（Postgres＋權限規則、登入、檔案、Edge Functions）
- 行事曆：Google Calendar（服務帳戶）；通知：Discord webhook

| 文件 | 內容 |
|---|---|
| `AGENTS.md` | 給 AI 的專案說明（架構、權限、金鑰、測試） |
| `club.md` | 社團需求表（其他社團 fork 後填這份） |
| `CUSTOMIZE.md` | AI 照需求表改造的步驟 |
| `docs/SETUP.md` | 第一次上線的設定步驟 |
| `docs/HANDOVER.md` | 帳號轉移與換屆交接 |
| `docs/MAINTENANCE.md` | 長期維護：自動檢查、定期工作、出問題怎麼辦 |
| `docs/open-questions.md` | 待社長決定的事項 |
| `STATUS.md` / `HANDOFF.md` | 開發進度與交接紀錄 |

## 本機預覽

```bash
python3 -m http.server 8000
# 開 http://localhost:8000/?demo 看示範模式（虛構資料，不連資料庫）
```

## 測試

```bash
npm install
npm test   # 純邏輯測試＋資料庫權限規則測試（PGlite，本機 Postgres）
```

## 結構

```
index.html, config.js, css/app.css
js/app.js        外框、選單、登入流程
js/core.js       連線、狀態、表單對話框、路由
js/logic.js      純邏輯（有測試）
js/mock.js       示範模式的假資料
js/views/*.js    各頁面
supabase/schema.sql            資料表、權限、出席率計算
supabase/functions/*           Edge Functions 原始碼
supabase/dashboard/*.ts        可直接貼到 Supabase 後台的單檔版
tests/                         node:test 測試
```

## 給其他社團

fork 這個 repo → 填 `club.md`、素材放 `materials/` → 請 AI「照 `club.md` 和 `CUSTOMIZE.md` 改造」。授權：MIT（見 `LICENSE`）。
