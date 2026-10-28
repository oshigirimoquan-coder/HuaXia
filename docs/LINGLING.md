# 泠靈依賴說明

**結論**：譜務用的桌面程式「泠靈」（Ling Ling Suite，<https://github.com/Suikann/ling-ling-suite>）會以幹部自己的 Discord 帳號登入，直接把曲目、聲部、人數與分譜放上 HuaXia。下面列出的資料表、欄位、函式與 Storage 路徑是泠靈和 HuaXia 之間的約定：**改這些東西之前先看這份文件**；改了之後 `npm test` 裡「泠靈發譜」開頭的測試沒過，就是泠靈會壞。改不可避免時，照最後一節通知泠靈的維護者。

泠靈那一側的測試用的假 HuaXia 照這份文件實作，所以這份文件就是雙方的介面契約。依據的版本：HuaXia `main` 5cf811d 加上本次修改、Supabase Auth v2.197.0。

## 泠靈怎麼連 HuaXia

- 網址與 publishable key 取自 `config.js`，內附在泠靈裡。換 Supabase 專案或換 key，泠靈要跟著改版。
- 以 Discord 登入（PKCE），回呼網址是 `http://127.0.0.1:<隨機埠>/`，不用在 Supabase 後台登記：Supabase Auth 對 loopback IP 直接放行（官方文件沒有承諾這件事；哪天不放行了，泠靈會登不進去，到時再請維護者登記回呼網址）。
- 之後的請求都是**登入的那個人的身分**，HuaXia 的 RLS 照常生效，泠靈沒有任何後端金鑰。
- 登入後以 `POST /rest/v1/rpc/is_officer` 呼叫 `is_officer()`：不是幹部就不記住登入；每次按「發譜」都重查一次。
- 用 Email 登入的人要先在「我的設定」按「連結 Discord」，所以 Supabase 要開 **Allow manual linking**（`docs/SETUP.md`）。

## 依賴的資料表與欄位

「讀」是泠靈讀這個欄位，「寫」是泠靈寫入（經下面的發譜函式，撤回與收回例外，見後文）。

| 資料表 | 欄位 | 意義與泠靈的用法 |
|---|---|---|
| `profiles` | `id`、`status`、`created_at` | 讀。登入後不是幹部時，依帳號狀態（待核准、停用）與建立時間判斷是不是這次登入才多建的帳號 |
| `user_roles` | — | 不直接讀，經 `is_officer()` |
| `pieces` | `id`、`title`、`composer`、`duration_min`、`ensemble`、`archived` | 讀沒封存的曲目讓譜務挑。新建時寫 `id`（泠靈先產生）、`title`、`composer`、`duration_min`（分鐘，0.5 為一級，同網頁表單）、`ensemble`（`tutti`／`sizhu`）。不改現有曲目、不封存、不刪曲目 |
| `piece_parts` | `id`、`piece_id`、`name`、`needed`、`needed_min`、`section`、`sort`、`tutor_id`、`note` | 讀這幾首曲目的聲部，以名稱對到泠靈的聲部。新建時寫 `name`、`needed`、`needed_min`、`section`、`sort`；現有聲部只改 `needed`、`needed_min`、`section`。`needed` 是記法 `6`、`6-8`、`2↑`，`needed_min` 是最少人數；`section` 只寫五組之一，空白交給觸發器 `guess_section`。不改名稱；`tutor_id`、`note` 只讀不寫：撤回時其中一個有值就算有人在網頁上設定過那個聲部，不刪。撤回時也比對 `name` 與那次新建時的名稱，被改過名的同樣不刪。發譜**永遠不刪聲部** |
| `part_assignments` | `id`、`part_id` | 讀。撤回時判斷那次新建的聲部有沒有排人（依 `id` 排序分頁）；泠靈不寫 |
| `practice_reports` | `id`、`part_id` | 只讀不寫。撤回時判斷那次新建的聲部有沒有練習回報指著它（刪聲部會把 `part_id` 設成 null，回報就對不回聲部），有的話不刪；依 `id` 排序分頁，幹部經 `can_see_report` 看得到全部 |
| `scores` | `id`、`piece_id`、`part_id`、`title`、`file_path`、`section`、`created_at` | 讀這幾首曲目的樂譜，依 `file_path` 分出哪份是泠靈發的。`part_id` 為 null 且 `section` 為 null 是總譜；泠靈登記的 `section` 一律為 null。登記新樂譜、撤掉被取代的登記；網頁上傳的（不是泠靈路徑的）只在收回時刪 |
| `semesters` | `id`、`is_current` | 讀本學期 |
| `events` | `id`、`semester_id`、`title`、`starts_at`、`ends_at`、`kinds`、`location` | 讀本學期、還沒結束、類型含 `concert` 的場次讓譜務勾；公演結束時間用來提醒收回。不新增、不改場次 |
| `event_pieces` | `event_id`、`piece_id` | 讀曲目已掛的場次；發譜時把曲目掛上勾選的場次。泠靈不從場次移除曲目 |

讀取一律分頁（`offset`、`limit`），不依賴 Supabase 一次最多回傳幾列。

## Storage（bucket `scores`）

- **路徑格式**：`lingling/<曲目編號>/<檔案內容的 SHA-256，64 位小寫十六進位>-<登記位置>.pdf`。固定前綴 `lingling/` 表示是泠靈發的；網頁上傳的路徑是 `<曲目編號>/<聲部編號或 full>/<時間戳>_<檔名>`，不會以 `lingling/` 開頭。登記位置是 1 到 32 個小寫英數字，由泠靈決定、HuaXia 不解讀：總譜是 `score`，分譜依泠靈的聲部算出；同一個位置重發同樣的內容得到同一個路徑。
- **一份 Storage 檔只給一筆樂譜登記**：泠靈從不讓兩筆 `scores` 指著同一個檔，兩個聲部的 PDF 內容相同時也各傳一份。網頁刪樂譜時會連 Storage 的檔一起刪（`js/views/pieces.js` 的 `editScore`），共用的話會弄壞另一筆登記。發譜函式擋下登記已有登記指著的檔（錯誤 `23505`）。
- 泠靈上傳（`POST /storage/v1/object/scores/<路徑>`，不覆寫）、列出 `lingling/<曲目編號>/`（`POST /storage/v1/object/list/scores`）、刪除（`DELETE /storage/v1/object/scores`）。只刪 `lingling/` 底下的檔，收回例外。用到的權限是現有的 `scores_write`、`scores_delete`（幹部）與 `scores_read`（幹部與老師）。
- **單檔上限 20MB 由泠靈自己擋**（同網頁 `js/views/pieces.js` 的 `MAX`），超過的先壓縮。bucket 不設 `file_size_limit`；HuaXia 改上限時告訴泠靈。

## 發譜函式

發譜分三段：先把檔傳到 Storage（還不登記，團員看不到），再**一個群組（一首曲目）呼叫一次** `lingling_publish` 切換，最後刪掉被取代、已經沒人登記的舊檔。第 2 段交給資料庫函式，是為了讓一首曲目的寫入全成或全不成：中途斷線不會讓團員看到半套譜。

兩個函式都在 `supabase/schema.sql` 最後一節，以呼叫者身分執行（`security invoker`），明寫 `grant execute ... to authenticated`（Supabase 自 2026-10-30 起不再自動授權新物件），匿名不能呼叫。

### `lingling_publish_version() returns int`

目前回傳 **1**。泠靈開發譜預覽前先呼叫（`POST /rest/v1/rpc/lingling_publish_version`，本體 `{}`）；函式不存在或版本不是泠靈要的，泠靈就停用發譜。

### `lingling_publish(payload jsonb) returns jsonb`

呼叫：`POST /rest/v1/rpc/lingling_publish`，本體 `{"payload": {...}}`。

輸入（陣列省略等於空的）：

```json
{
  "version": 1,
  "piece_id": "曲目編號；新建時是泠靈先產生的編號",
  "new_piece": null,
  "create_parts": [
    {"name": "二胡 I", "needed": "6-8", "needed_min": 6, "section": "", "sort": 3}
  ],
  "update_parts": [
    {"id": "聲部編號", "needed": "4", "needed_min": 4, "section": "拉弦"}
  ],
  "add_scores": [
    {"part_id": "現有聲部編號", "title": "二胡 I", "file_path": "lingling/<曲目編號>/<sha256>-<登記位置>.pdf"},
    {"new_part": "二胡 I", "title": "二胡 I", "file_path": "..."},
    {"title": "總譜", "file_path": "..."}
  ],
  "remove_scores": ["要撤掉登記的樂譜編號"],
  "attach_events": ["場次編號"]
}
```

| 欄位 | 規則 |
|---|---|
| `version` | 必須等於 `lingling_publish_version()`，否則整個不做 |
| `new_piece` | `null`：`piece_id` 是現有曲目。物件 `{"title", "composer", "duration_min", "ensemble"}`（`title` 必填；`composer` 省略為空白、`duration_min` 可為 `null`、`ensemble` 省略為 `tutti`）：以 `piece_id` 新建；這個編號已經存在就沿用、不改它的欄位（重跑不會多建一首） |
| `create_parts` | 同一次不能有兩個同名的；`section` 空白時由觸發器依名稱判斷 |
| `update_parts` | 聲部必須屬於這首曲目；`needed`、`needed_min`、`section` 省略或 `null` 就不改，`section` 給空字串等於交給觸發器重新判斷 |
| `add_scores` | `part_id`（現有聲部）與 `new_part`（這次 `create_parts` 裡的名稱）最多給一個，都不給是總譜；`file_path` 必須是這首曲目的泠靈路徑、檔案已經在 Storage，而且（撤掉這次的 `remove_scores` 之後）沒有任何樂譜登記指著它 |
| `remove_scores` | 只撤這首曲目上泠靈發的登記（`file_path` 是這首曲目的泠靈路徑 `lingling/<piece_id>/…`）；有一筆是網頁上傳的、別人放的或別首曲目的，整個不做（錯誤 `22023`）；已經不在的略過 |
| `attach_events` | 已經掛著的略過 |

執行順序：曲目 → 新建聲部 → 改聲部 → 撤掉登記 → 登記新樂譜 → 掛場次。任何一步出錯，整次呼叫的寫入全部不生效。

輸出：

```json
{
  "version": 1,
  "piece_id": "...",
  "piece_created": true,
  "created_parts": [{"id": "新聲部編號", "name": "二胡 I"}],
  "added_scores": [{"id": "新樂譜編號", "part_id": "...或 null", "file_path": "..."}],
  "removed_scores": [{"id": "...", "part_id": "...或 null", "file_path": "..."}],
  "attached_events": ["這次新掛上的場次編號"]
}
```

`removed_scores` 是**實際**撤掉的登記；泠靈依它與 `added_scores`、`created_parts` 寫發譜紀錄，撤回時只動那次記下的編號。

錯誤（`code` 是 PostgreSQL 的 SQLSTATE，PostgREST 依它決定 HTTP 狀態）：

| `code` | HTTP | 情況 |
|---|---|---|
| `PT409` | 409 | 介面版本不符 |
| `22023` | 400 | 缺 `piece_id`、同名的新聲部、`part_id` 與 `new_part` 同時給、`new_part` 不是這次新建的、不是泠靈路徑、`remove_scores` 指到不是這首曲目泠靈發的登記 |
| `PT404` | 404 | 找不到曲目、聲部不屬於這首曲目（或已被刪、或沒有權限改）、檔案還沒傳到 Storage |
| `42501` | 401／403 | 不是幹部：RLS 擋下寫入（`new row violates row-level security policy`）；或沒登入，不能呼叫 |
| `23503` | 409 | 場次不存在 |
| `23505` | 409 | 已有樂譜登記指著這個檔 |

## 撤回與收回（不經函式，以幹部身分經 REST）

- **撤回**某次發譜的某些曲目：刪掉那次 `added_scores` 的登記（`DELETE /rest/v1/scores?id=in.(...)`），刪掉那次 `created_parts` 裡還沒排人、也沒人在網頁上設定過的聲部（先讀 `part_assignments`、`piece_parts.tutor_id`、`note`、`name` 與 `practice_reports.part_id` 確認，再 `DELETE /rest/v1/piece_parts?id=in.(...)`），最後刪 Storage 檔。那次發譜沒有寫下結果（泠靈中途停下）時，泠靈不知道 HuaXia 的編號，改依那次要登記的泠靈路徑，撤掉那首曲目現在登記在這些路徑的樂譜，聲部一律不刪。注意 `piece_parts` 刪除會連帶刪掉它的 `part_assignments` 與 `scores`（`on delete cascade`），所以泠靈一定先確認沒排人。人數、聲部組與場次不改回。
- **收回**公演結束後的曲目：刪掉曲目的所有樂譜登記與檔案，包括網頁上傳的。聲部、曲目、場次與排人都留著，因為出席率由場次掛的曲目加排人算出。
- 用到的權限是現有的 `score_write`、`part_write`（幹部）與 Storage 的 `scores_delete`。

## 改了會影響泠靈的事

- 上面表格裡的資料表或欄位改名、刪除、改型別或改意義（例如 `needed` 的記法、`section` 的五組、`ensemble` 的值）。
- `is_officer()` 的名稱或意義；RLS 讓幹部不能寫上面這些表。
- Storage bucket 名稱、`scores_*` 的權限，或網頁上傳改用 `lingling/` 開頭的路徑。
- 發譜函式的輸入或輸出：改了就把 `lingling_publish_version()` 的回傳值加一，舊版泠靈會因此停用發譜而不是寫錯資料。回傳型別要改時先 `drop function` 再建立（`create or replace` 不能改回傳型別）。

要改時到泠靈的 repo 開 issue（<https://github.com/Suikann/ling-ling-suite/issues>），寫明改了什麼、從哪一版起。
