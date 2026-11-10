import { secsOf } from '../core.js';
import { sb, state, me, route, esc, run, toast, pageHead, avatar, nameOf, sectionChip, roleChips, render, $, $$, loadShared, discordAvatar, getTheme, setTheme, uploadAvatar, removeOldAvatar } from '../core.js';
import { calendarsFor, LINK_DISCORD_TAKEN } from '../logic.js';

// 頭像：裁成正方形、縮成小圖，上傳到 Storage「avatars」，profiles.avatar_url 只記網址
function squareImage(file, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url); c.toBlob((b) => (b ? resolve(b) : reject(new Error('bad image'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
async function saveAvatar(value, okMsg) {
  const old = state.profile?.avatar_url;
  if (!(await run(() => sb.from('profiles').update({ avatar_url: value }).eq('id', me()), okMsg))) return;
  if (old && old !== value) removeOldAvatar(old);
  state.profile = { ...state.profile, avatar_url: value };
  const p = state.people.get(me()); if (p) p.avatar_url = value;
  const sum = $('.me-menu summary'); if (sum) sum.innerHTML = avatar(me(), 32);
  const who = $('.me-who'); if (who) who.firstElementChild.outerHTML = avatar(me(), 40);
  render();
}

route('/me', async () => {
  const u = state.profile;
  const { data: priv } = await sb.from('profile_private').select('*').eq('user_id', me()).maybeSingle();
  const cals = calendarsFor(state.calendars, state.p, secsOf(u));
  // 幹部行事曆沒有公開，Apple 只能訂閱公開的那幾個
  const apple = cals.filter((c) => c.audience !== 'officers');
  const ids = (await sb.auth.getUserIdentities().catch(() => null))?.data?.identities || [];
  const hasDiscord = ids.some((i) => i.provider === 'discord');
  const hasEmail = ids.some((i) => i.provider === 'email');
  const dcAvatar = await discordAvatar();
  const canUseDc = dcAvatar && dcAvatar !== u?.avatar_url;
  setTimeout(() => {
    $$('[data-theme-pick]').forEach((b) => (b.onclick = () => { setTheme(b.dataset.themePick); $$('[data-theme-pick]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    // 按了先給反應；拿到 Discord 網址後自己跳過去（有些瀏覽器不會自動跳），出錯也一定顯示原因
    $('#link-discord')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = '正在前往 Discord…';
      let r;
      try { r = await sb.auth.linkIdentity({ provider: 'discord', options: { redirectTo: location.origin + location.pathname + '#/me', skipBrowserRedirect: true } }); }
      catch (err) { r = { error: err }; }
      if (r?.data?.url) { location.assign(r.data.url); return; }
      btn.disabled = false; btn.textContent = '連結 Discord';
      if (!r?.error) r = { error: new Error('沒有拿到 Discord 的連結網址，請重新整理後再試一次') };
      if (r?.error) toast(/manual linking/i.test(r.error.message) ? '管理員還沒開啟「帳號連結」功能（Supabase 的 Allow manual linking）。' : /already/i.test(r.error.message) ? LINK_DISCORD_TAKEN : '連結失敗：' + r.error.message, 'bad');
    });
    $('#me-form')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      const a = await run(() => sb.from('profiles').update({ display_name: f.get('display_name').trim(), real_name: f.get('real_name').trim(), instruments: f.get('instruments').trim(), grade: f.get('grade').trim(), school: f.get('school').trim(), bio: f.get('bio').trim() }).eq('id', me()));
      const b = await run(() => sb.from('profile_private').update({ google_email: f.get('google_email').trim() || null, phone: f.get('phone').trim() }).eq('user_id', me()));
      if (a && b) { toast('已儲存', 'ok'); await loadShared(); state.profile = { ...state.profile, display_name: f.get('display_name').trim() }; render(); }
    });
    $('#logout')?.addEventListener('click', () => sb.auth.signOut());
    $('#use-dc-avatar')?.addEventListener('click', () => saveAvatar(dcAvatar, '已換成 Discord 頭像'));
    $('#del-avatar')?.addEventListener('click', () => saveAvatar(null, '已移除頭像'));
    $('#pick-avatar')?.addEventListener('click', () => $('#avatar-file').click());
    $('#avatar-file')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      if (!f.type.startsWith('image/')) return toast('請選一張圖片', 'bad');
      let url; try { url = await uploadAvatar(await squareImage(f, 256)); } catch (err) { return toast(/bad image/.test(err?.message) ? '這張圖片讀不出來，換一張試試' : '頭像上傳失敗：' + (err?.message || err), 'bad'); }
      await saveAvatar(url, '頭像已更新');
    });
  });
  return pageHead('我的設定') +
    `<section class="card me-head">${avatar(me(), 56)}<div><h2>${esc(nameOf(me()))}</h2><div class="chips">${secsOf(u).map(sectionChip).join('')}${roleChips(state.roles)}${u?.officer_title ? `<span class="chip gold">${esc(u.officer_title)}</span>` : ''}</div></div>
      <div class="actions"><button class="btn ghost" id="logout">登出</button></div>
      <div class="avatar-acts"><button class="btn sm" id="pick-avatar">更換頭像</button>${canUseDc ? '<button class="btn sm ghost" id="use-dc-avatar">使用 Discord 頭像</button>' : ''}${u?.avatar_url ? '<button class="btn sm ghost" id="del-avatar">移除頭像</button>' : ''}
        <input type="file" id="avatar-file" accept="image/*" hidden></div></section>

    <section class="card"><h2>外觀</h2>
      <div class="theme-pick" role="group" aria-label="外觀">${[['system', '跟隨系統', 'auto'], ['light', '淺色', 'light'], ['dark', '深色', 'dark']].map(([k, l, sw]) => `<button data-theme-pick="${k}" aria-pressed="${getTheme() === k}"><span class="sw sw-${sw}"><i></i><i></i></span>${l}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:10px">只影響這台裝置。「跟隨系統」會照手機或電腦的深色模式自動切換。</p>
    </section>

    <section class="card"><h2>登入方式</h2>
      <p class="small">目前可用：${[hasDiscord && 'Discord', hasEmail && 'Email ＋ 密碼'].filter(Boolean).join('、') || '—'}</p>
      ${hasDiscord ? '<p class="small muted">已綁定 Discord，用 Discord 或 Email 登入都是同一個帳號。</p>'
        : `<p class="small muted">把 Discord 綁到這個帳號，之後按「用 Discord 登入」就會進到同一個帳號，出席與編制紀錄不會分開。</p>
           <button class="btn" id="link-discord">連結 Discord</button>`}
    </section>

    <section class="card"><h2>加到我的行事曆</h2>
      ${cals.length ? `<h3 class="cal-sub">Google 行事曆</h3><p class="small muted">按一下加入，之後幹部新增或修改行程都會自動出現在你的行事曆，練習前一天和前一小時會提醒。只需要加一次。</p>
        <div class="cal-btns">${cals.map((c) => `<a class="btn cal-btn" href="https://calendar.google.com/calendar/render?cid=${encodeURIComponent(c.gcal_id)}" target="_blank" rel="noopener"><span class="cal-dot cal-${esc(c.key)}"></span>${esc(c.name.replace(/^華夏｜/, ''))}<span class="plus">＋</span></a>`).join('')}</div>
        ${apple.length ? `<h3 class="cal-sub">Apple 行事曆（iPhone、Mac）</h3>
        <p class="small muted">點一下會跳出「訂閱行事曆」，按確定就好。Apple 的更新比 Google 慢，可以到 iPhone「設定 › 行事曆 › 帳號 › 取得新資料」調快；提醒請在 Apple 行事曆自己設定。</p>
        <div class="cal-btns">${apple.map((c) => `<a class="btn cal-btn" href="webcal://calendar.google.com/calendar/ical/${encodeURIComponent(c.gcal_id)}/public/basic.ics"><span class="cal-dot cal-${esc(c.key)}"></span>${esc(c.name.replace(/^華夏｜/, ''))}<span class="plus">＋</span></a>`).join('')}</div>` : ''}
        ${state.p.officer ? `<p class="small muted">幹部行事曆只分享給下面填的 Google 信箱${priv?.google_email ? '' : '，<b>請先填寫</b>'}。</p>` : ''}`
        : '<p class="muted">行事曆還沒建立好，管理員完成設定後這裡會出現按鈕。</p>'}
    </section>

    <section class="card"><h2>個人資料</h2>
      <form id="me-form" class="grid-form">
        <label>顯示名稱<input name="display_name" value="${esc(u?.display_name)}" required></label>
        <label>本名<input name="real_name" value="${esc(u?.real_name)}"></label>
        <label>樂器<input name="instruments" value="${esc(u?.instruments)}" placeholder="例：二胡／中胡"></label>
        <label>系級<input name="grade" value="${esc(u?.grade)}" placeholder="例：金融三"></label>
        <label>學校（外校填寫）<input name="school" value="${esc(u?.school)}"></label>
        <label>Google 信箱（行事曆用）<input name="google_email" type="email" value="${esc(priv?.google_email || '')}" placeholder="xxx@gmail.com"></label>
        <label>手機（只有幹部看得到）<input name="phone" value="${esc(priv?.phone || '')}"></label>
        <label class="full">自我介紹<textarea name="bio" rows="3">${esc(u?.bio)}</textarea></label>
        <button class="btn pri">儲存</button>
      </form>
      <p class="small muted">組別由幹部設定，身分組由管理員設定。登入信箱：${esc(priv?.email || '')}</p></section>`;
});
