-- 每天晚上 20:00（台北）發送「明天的行程」提醒到 DC
-- 使用前把兩個地方換掉：
--   <PROJECT_REF>  = Supabase 專案網址中間那段（https://<這段>.supabase.co）
--   <CRON_SECRET>  = 你在 Edge Functions → Secrets 設定的 CRON_SECRET（自己想一串長亂碼）
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('huaxia-daily-reminder') where exists (select 1 from cron.job where jobname = 'huaxia-daily-reminder');
select cron.schedule('huaxia-daily-reminder', '0 12 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb)
$$);
-- 12:00 UTC = 20:00 台北
