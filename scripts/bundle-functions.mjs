// 把共用檔併進每個函式，產生可以直接貼到 Supabase 後台編輯器的單一檔案
import fs from 'node:fs';
const common = fs.readFileSync('supabase/functions/_shared/common.ts', 'utf8');
fs.mkdirSync('supabase/dashboard', { recursive: true });
for (const name of ['calendar-sync', 'notify', 'daily-reminder']) {
  const src = fs.readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')
    .replace(/^import \{[^}]+\} from "\.\.\/_shared\/common\.ts";\n/m, '');
  const out = `// ${name}：自動產生的單檔版本（來源 supabase/functions/${name}），請勿直接修改\n` + common + '\n' + src;
  fs.writeFileSync(`supabase/dashboard/${name}.ts`, out);
  console.log('wrote', name, out.length);
}
