// 座位表：依編制自動排位，拖曳微調；幹部與組長可以儲存
import { sb, state, route, esc, run, toast, empty, nameOf, $, $$ } from '../core.js';
import { STAGES, SEAT_STYLES, SECTIONS, autoSeat, reconcileSeats, conductorAt, guessSection } from '../logic.js';

const SEC_VAR = { 吹管: '--s-wind', 拉弦: '--s-bow', 彈撥: '--s-pluck', 打擊: '--s-perc', 低音: '--s-bass' };
const shortName = (s) => { const t = String(s || ''); return t.length > 3 ? t.slice(-2) : t; };

export function seatLabel(k, ringers) {
  if (k.startsWith('u:')) return nameOf(k.slice(2));
  return ringers.find((r) => r.id === k.slice(2))?.name || '槍手';
}

// 畫出座位表（預覽與編輯共用）
export function seatSvg({ stage, seats, parts, ringers, interactive = false, compact = false }) {
  const w = stage.w, d = stage.d, pad = 0.6;
  const partOf = new Map(parts.map((p) => [p.id, p]));
  const c = conductorAt();
  const Y = (y) => d - y; // 觀眾在下方
  const grid = [];
  for (let x = Math.ceil(-w / 2); x <= w / 2; x++) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${d}" />`);
  for (let y = 1; y < d; y++) grid.push(`<line x1="${-w / 2}" y1="${y}" x2="${w / 2}" y2="${y}" />`);
  const seat = (s, i) => {
    const pt = partOf.get(s.part); const sec = pt?.section || guessSection(pt?.name) || '';
    const name = seatLabel(s.k, ringers);
    return `<g class="seat ${interactive ? 'drag' : ''}" data-i="${i}" transform="translate(${s.x} ${Y(s.y)})" style="--c: var(${SEC_VAR[sec] || '--muted'})">
      <title>${esc(name)}・${esc(pt?.name || '')}</title>
      <circle r="0.36" /><text class="nm" y="0.06">${esc(compact ? shortName(name) : name.slice(0, 4))}</text>
      ${compact ? '' : `<text class="pt" y="0.62">${esc((pt?.name || '').slice(0, 5))}</text>`}</g>`;
  };
  return `<svg class="seat-svg ${compact ? 'compact' : ''}" viewBox="${-w / 2 - pad} ${-pad} ${w + pad * 2} ${d + pad * 2 + 0.5}" role="img" aria-label="座位表">
    <rect class="stage" x="${-w / 2}" y="0" width="${w}" height="${d}" rx="0.25" />
    <g class="grid">${grid.join('')}</g>
    <text class="aud" x="0" y="${d + 0.62}">觀　眾　席</text>
    <g class="cond" transform="translate(${c.x} ${Y(c.y)})"><rect x="-0.35" y="-0.22" width="0.7" height="0.44" rx="0.08" /><text y="0.065">指揮</text></g>
    ${seats.map(seat).join('')}
  </svg>`;
}

route('/pieces/:id/seating', async ({ id }) => {
  const p = state.p;
  const [pc, parts, asg, chart, ringers] = await Promise.all([
    sb.from('pieces').select('*').eq('id', id).maybeSingle(),
    sb.from('piece_parts').select('*').eq('piece_id', id).order('sort'),
    sb.from('part_assignments').select('*'),
    sb.from('seating_charts').select('*').eq('piece_id', id).maybeSingle(),
    p.officer ? sb.from('ringers').select('id,name') : { data: [] },
  ]);
  if (!pc.data) return empty('找不到這首曲目', '', '<a class="btn" href="#/pieces">回曲目</a>');
  const pts = parts.data || [];
  const myAsg = (asg.data || []).filter((a) => pts.some((x) => x.id === a.part_id));
  const rs = ringers.data || [];
  const canEdit = p.officer || p.leader;
  const saved = chart.data;
  const st = { preset: 'hall', style: 'arc', ...STAGES.hall, ...(saved?.stage || {}) };
  let seats, missing = [];
  if (saved?.seats?.length) ({ seats, missing } = reconcileSeats(saved.seats, pts, myAsg));
  else seats = autoSeat(pts, myAsg, st);
  let dirty = !saved, savedNow = !!saved;

  const draw = () => {
    $('#seat-box').innerHTML = seatSvg({ stage: st, seats, parts: pts, ringers: rs, interactive: canEdit });
    $('#seat-miss').innerHTML = missing.length ? `<b>還沒排進座位：</b>${missing.map((m) => esc(seatLabel(m.k, rs))).join('、')}${canEdit ? ' <button class="btn sm" id="place-miss">放進座位表</button>' : ''}` : '';
    $('#seat-state').textContent = dirty ? (canEdit ? '尚未儲存' : '') : (savedNow ? '已儲存' : '');
    $('#place-miss')?.addEventListener('click', () => {
      // 新加入的人：用自動排位算出位置，挑離現有座位最遠的空位放
      const auto = autoSeat(pts, myAsg, st);
      for (const m of missing) {
        const cand = auto.filter((a) => a.part === m.part).concat(auto);
        const free = cand.find((a) => !seats.some((s) => Math.hypot(s.x - a.x, s.y - a.y) < 0.6)) || cand[0] || { x: 0, y: 2 };
        seats.push({ ...m, x: free.x, y: free.y });
      }
      missing = []; dirty = true; draw();
    });
    if (canEdit) bindDrag();
  };

  const bindDrag = () => {
    const svg = $('#seat-box svg');
    $$('#seat-box .seat').forEach((g) => {
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('on');
        const i = +g.dataset.i;
        const move = (ev) => {
          const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
          const q = pt.matrixTransform(svg.getScreenCTM().inverse());
          const x = Math.max(-st.w / 2 + 0.3, Math.min(st.w / 2 - 0.3, Math.round(q.x * 20) / 20));
          const y = Math.max(0.3, Math.min(st.d - 0.3, Math.round((st.d - q.y) * 20) / 20));
          seats[i] = { ...seats[i], x, y }; g.setAttribute('transform', `translate(${x} ${st.d - y})`);
          if (!dirty) { dirty = true; $('#seat-state').textContent = '尚未儲存'; }
        };
        const up = () => { g.classList.remove('on'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); };
        g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
      });
    });
  };

  setTimeout(() => {
    draw();
    const syncCustom = () => { $$('.st-custom').forEach((el) => (el.hidden = $('#st-preset').value !== 'custom')); };
    const restage = () => {
      const pr = $('#st-preset').value;
      Object.assign(st, { preset: pr, style: $('#st-style').value });
      if (pr === 'custom') Object.assign(st, { w: Math.max(4, Math.min(30, +$('#st-w').value || 12)), d: Math.max(3, Math.min(20, +$('#st-d').value || 8)) });
      else Object.assign(st, { w: STAGES[pr].w, d: STAGES[pr].d });
      syncCustom();
    };
    $('#st-preset')?.addEventListener('change', () => { restage(); seats = autoSeat(pts, myAsg, st); missing = []; dirty = true; draw(); });
    $('#st-style')?.addEventListener('change', () => { restage(); seats = autoSeat(pts, myAsg, st); missing = []; dirty = true; draw(); });
    $$('.st-custom input').forEach((el) => el.addEventListener('change', () => { restage(); seats = autoSeat(pts, myAsg, st); dirty = true; draw(); }));
    syncCustom();
    $('#seat-auto')?.addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = '確定重排？手動調整會不見'; return; }
      delete b.dataset.armed; b.textContent = '依編制重新排位';
      seats = autoSeat(pts, myAsg, st); missing = []; dirty = true; draw();
    });
    $('#seat-save')?.addEventListener('click', async () => {
      const stage = { preset: st.preset, style: st.style, w: st.w, d: st.d };
      if (await run(() => sb.from('seating_charts').upsert({ piece_id: id, stage, seats }), '座位表已儲存')) { dirty = false; savedNow = true; draw(); }
    });
    $('#seat-print')?.addEventListener('click', () => window.print());
    window.onbeforeunload = null;
  });

  const presetOpts = Object.entries(STAGES).map(([k, v]) => `<option value="${k}" ${st.preset === k ? 'selected' : ''}>${v.label}${k === 'custom' ? '' : `（${v.w}×${v.d} 公尺）`}</option>`).join('');
  const styleOpts = Object.entries(SEAT_STYLES).map(([k, v]) => `<option value="${k}" ${st.style === k ? 'selected' : ''}>${v}</option>`).join('');
  const legend = SECTIONS.map((s) => `<span class="lg" style="--c: var(${SEC_VAR[s]})"><i></i>${s}</span>`).join('');
  return `<a class="back no-print" href="#/pieces/${id}">← ${esc(pc.data.title)}</a>
    <div class="page-head"><div><h1>座位表</h1><div class="sub">${esc(pc.data.title)}・${seats.length + missing.length} 人<span id="seat-state" class="chip"></span></div></div>
      <div class="actions no-print">${canEdit ? '<button class="btn ghost" id="seat-auto">依編制重新排位</button>' : ''}<button class="btn" id="seat-print">列印</button>${canEdit ? '<button class="btn pri" id="seat-save">儲存</button>' : ''}</div></div>
    ${canEdit ? `<div class="seat-tools no-print">
      <label>舞台<select id="st-preset">${presetOpts}</select></label>
      <label class="st-custom">寬（公尺）<input id="st-w" type="number" min="4" max="30" step="0.5" value="${st.w}"></label>
      <label class="st-custom">深（公尺）<input id="st-d" type="number" min="3" max="20" step="0.5" value="${st.d}"></label>
      <label>排法<select id="st-style">${styleOpts}</select></label>
      <span class="small muted">拖曳圓點可以調整位置；換舞台或排法會重新排位。</span></div>` : ''}
    <div class="seat-legend">${legend}</div>
    <div id="seat-box" class="seat-box"></div>
    <p id="seat-miss" class="small seat-miss"></p>
    ${pts.length ? '' : '<p class="muted">這首曲子還沒有設定聲部，先到曲目頁設定編制。</p>'}`;
});
