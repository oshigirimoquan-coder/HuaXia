import { sb, state, me, route, esc, run, toast, pageHead, avatar, nameOf, sectionChip, roleChips, render, $, loadShared, discordAvatar } from '../core.js';
import { calendarsFor } from '../logic.js';

route('/me', async () => {
  const u = state.profile;
  const { data: priv } = await sb.from('profile_private').select('*').eq('user_id', me()).maybeSingle();
  const cals = calendarsFor(state.calendars, state.p, u?.section);
  const ids = (await sb.auth.getUserIdentities().catch(() => null))?.data?.identities || [];
  const hasDiscord = ids.some((i) => i.provider === 'discord');
  const hasEmail = ids.some((i) => i.provider === 'email');
  const dcAvatar = await discordAvatar();
  const canUseDc = dcAvatar && dcAvatar !== u?.avatar_url;
  setTimeout(() => {
    $('#link-discord')?.addEventListener('click', async () => {
      const r = await sb.auth.linkIdentity({ provider: 'discord', options: { redirectTo: location.origin + location.pathname + '#/me' } });
      if (r?.error) toast(/manual linking/i.test(r.error.message) ? '管理員還沒開啟「帳號連結」功能（Supabase 的 Allow manual linking）。' : /already/i.test(r.error.message) ? '這個 Discord 已經綁在另一個帳號上，請管理員先刪掉那個帳號。' : '連結失敗：' + r.error.message, 'bad');
    });
    $('#me-form')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      const a = await run(() => sb.from('profiles').update({ display_name: f.get('display_name').trim(), real_name: f.get('real_name').trim(), instruments: f.get('instruments').trim(), grade: f.get('grade').trim(), school: f.get('school').trim(), bio: f.get('bio').trim() }).eq('id', me()));
      const b = await run(() => sb.from('profile_private').update({ google_email: f.get('google_email').trim() || null, phone: f.get('phone').trim() }).eq('user_id', me()));
      if (a && b) { toast('已儲存', 'ok'); await loadShared(); state.profile = { ...state.profile, display_name: f.get('display_name').trim() }; render(); }
    });
    $('#logout')?.addEventListener('click', () => sb.auth.signOut());
    $('#use-dc-avatar')?.addEventListener('click', async () => {
      if (await run(() => sb.from('profiles').update({ avatar_url: dcAvatar }).eq('id', me()), '已換成 Discord 頭像')) {
        state.profile = { ...state.profile, avatar_url: dcAvatar }; await loadShared(); location.reload();
      }
    });
  });
  return pageHead('我的設定') +
    `<section class="card me-head">${avatar(me(), 56)}<div><h2>${esc(nameOf(me()))}</h2><div class="chips">${sectionChip(u?.section)}${roleChips(state.roles)}${u?.officer_title ? `<span class="chip gold">${esc(u.officer_title)}</span>` : ''}</div></div>
      <div class="actions">${canUseDc ? '<button class="btn sm" id="use-dc-avatar">使用 Discord 頭像</button>' : ''}<button class="btn ghost" id="logout">登出</button></div></section>

    <section class="card"><h2>登入方式</h2>
      <p class="small">目前可用：${[hasDiscord && 'Discord', hasEmail && 'Email ＋ 密碼'].filter(Boolean).join('、') || '—'}</p>
      ${hasDiscord ? '<p class="small muted">已綁定 Discord，用 Discord 或 Email 登入都是同一個帳號。</p>'
        : `<p class="small muted">把 Discord 綁到這個帳號，之後按「用 Discord 登入」就會進到同一個帳號，出席與編制紀錄不會分開。</p>
           <button class="btn" id="link-discord">連結 Discord</button>`}
    </section>

    <section class="card"><h2>加到我的 Google 行事曆</h2>
      ${cals.length ? `<p class="small muted">按一下加入，之後幹部新增或修改行程都會自動出現在你的行事曆，練習前一天和前一小時會提醒。只需要加一次。</p>
        <div class="cal-btns">${cals.map((c) => `<a class="btn cal-btn" href="https://calendar.google.com/calendar/render?cid=${encodeURIComponent(c.gcal_id)}" target="_blank" rel="noopener"><span class="cal-dot cal-${esc(c.key)}"></span>${esc(c.name.replace(/^華夏｜/, ''))}<span class="plus">＋</span></a>`).join('')}</div>
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
