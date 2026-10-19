(() => {
'use strict';
const D = window.DLA_DATA;
const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const FAST = params.get('fast') === '1';
const T = { think: FAST ? 2 : D.timing.thinkSeconds, answer: FAST ? 8 : D.timing.answerSeconds };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SCORING = !!(window.DLA_CONFIG && window.DLA_CONFIG.scoring);
const HAS_TTS = 'speechSynthesis' in window && !FAST;

const SECTIONS = {
  general:   { label: 'Genel sorular',  tag: 'Genel soru',        bank: D.general,   color: '#984ae8', desc: 'Kişisel ve günlük konularda kısa sorular. Neden ve örnek vererek cevapla.' },
  picture:   { label: 'Resim yorumlama', tag: 'Resim',            bank: D.pictures,  color: '#7a2fc9', desc: 'Resimde ne gördüğünü ve ne olduğunu anlat; tahmin yürüt.' },
  scenario:  { label: 'Senaryolar',      tag: 'Senaryo',          bank: D.scenarios, color: '#6a28b0', desc: 'Kabinde yaşanabilecek bir durumda ne yapar ve ne söylersin?' },
  retelling: { label: 'Metni yeniden anlatma', tag: 'Yeniden anlatma', bank: D.retelling, color: '#4f2087', desc: 'Kısa bir haber metnini oku, kendi cümlelerinle anlat.' },
};
const CRIT = { pronunciation: 'Telaffuz (tahmini)', structure: 'Dil bilgisi ve yapı', vocabulary: 'Kelime hazinesi', fluency: 'Akıcılık', production: 'Cevabın kapsamı' };
const CHECKS = {
  common: [
    ['fluency', 'Çoğunlukla duraksamadan, akıcı konuştum.'],
    ['fluency', 'Süreyi iyi kullandım (cevabım en az 45 saniye sürdü).'],
    ['pronunciation', 'Kaydı dinleyince kelimelerim net anlaşılıyordu.'],
    ['structure', 'Cümlelerimde belirgin bir dil bilgisi hatası duymadım.'],
  ],
  general: [
    ['production', 'Soruyu doğrudan cevapladım.'],
    ['production', 'En az bir neden veya örnek verdim.'],
    ['vocabulary', 'Aynı kelimeleri tekrarlamadım, çeşitli kelimeler kullandım.'],
  ],
  picture: [
    ['production', 'Kişileri, nesneleri ve mekânı anlattım.'],
    ['structure', 'Olanları "is / are + -ing" ile anlattım.'],
    ['vocabulary', '"Might", "probably", "it looks like" gibi ifadelerle tahmin yürüttüm.'],
  ],
  scenario: [
    ['production', 'Güvenli ve mantıklı bir çözüm söyledim.'],
    ['production', 'Yolcuya söyleyeceğim cümleleri örnek olarak verdim.'],
    ['vocabulary', 'Nazik kalıplar kullandım (I understand, May I..., I apologise).'],
  ],
  retelling: [
    ['production', 'Metnin ana noktalarını anlattım.'],
    ['vocabulary', 'Kendi kelimelerimle anlattım, metni olduğu gibi okumadım.'],
    ['structure', 'Olayları doğru sırayla ve uygun zamanlarla anlattım.'],
  ],
};
const TIPS = {
  pronunciation: 'Telaffuz: kendi kaydını dinle, anlaşılmayan kelimeleri not al ve yavaş, net tekrar et.',
  structure: 'Dil bilgisi: cevabını yazıya dökmüş hâliyle oku; zaman ve çoğul hatalarını bul, düzeltilmiş hâlini yüksek sesle tekrar et.',
  vocabulary: 'Kelime: her soru için 3 yeni ifade öğren (özellikle kabin ve yolcu iletişimi kalıpları) ve bir sonraki denemede kullan.',
  fluency: 'Akıcılık: 75 saniyeyi doldurmaya çalış; takılırsan "Let me think..." gibi kalıplarla devam et, sessizce bekleme.',
  production: 'Kapsam: her cevapta ana fikir, neden ve örnek ver; senaryoda mutlaka söyleyeceğin cümleyi de ekle.',
};
const PREFIX = { general: 'g', picture: 'p', scenario: 's', retelling: 'r' };

/* ---------- storage ---------- */
const mem = {};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch { return k in mem ? mem[k] : d; } },
  set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const settings = Object.assign({ tts: true, showPassage: false }, store.get('dla.settings', {}));
const saveSettings = () => store.set('dla.settings', settings);
const getHistory = () => store.get('dla.history', []);

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = root) => el.querySelector(sel);
const words = (t) => (String(t).trim() ? String(t).trim().split(/\s+/).length : 0);
const fmtDate = (ts) => new Date(ts).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pickRandom = (arr, n) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };

function show(html, focus = true) {
  root.innerHTML = html;
  window.scrollTo(0, 0);
  if (focus) root.focus({ preventScroll: true });
}

function makeItem(section, id) {
  const q = SECTIONS[section].bank.find((x) => x.id === id);
  const base = { section, id, qid: PREFIX[section] + id, prompt: q.prompt, context: '' };
  if (section === 'picture') return { ...base, image: q.image, context: q.sceneDescription, speak: q.prompt };
  if (section === 'scenario') return { ...base, situation: q.situation, context: q.situation, speak: q.situation + ' ' + q.prompt };
  if (section === 'retelling') return { ...base, passage: q.passage, context: q.passage, speak: q.prompt + ' You have a few seconds to read the text.' };
  return { ...base, speak: q.prompt };
}
function examItems(exam) {
  return [
    ...exam.general.map((i) => makeItem('general', i)),
    ...exam.pictures.map((i) => makeItem('picture', i)),
    ...exam.scenarios.map((i) => makeItem('scenario', i)),
    ...exam.retelling.map((i) => makeItem('retelling', i)),
  ];
}

/* ---------- mic ---------- */
let stream = null;
let audioCtx = null;
let analyser = null;
let levelRaf = 0;

async function openMic() {
  if (stream && stream.getTracks().some((t) => t.readyState === 'live')) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
  } catch { analyser = null; }
  return stream;
}
function watchLevel(el) {
  cancelAnimationFrame(levelRaf);
  if (!analyser || !el) return;
  const buf = new Uint8Array(analyser.fftSize);
  const tick = () => {
    if (!document.body.contains(el)) return;
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
    el.style.setProperty('--lvl', Math.min(100, Math.round((peak / 128) * 220)) + '%');
    levelRaf = requestAnimationFrame(tick);
  };
  tick();
}
function beep(freq = 880, ms = 180) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.frequency.value = freq; g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* no audio */ }
}
function speak(text) {
  return new Promise((resolve) => {
    if (!HAS_TTS || !settings.tts) return resolve();
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.95;
      const v = speechSynthesis.getVoices().find((x) => /^en[-_]US/i.test(x.lang)) || speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, Math.max(4000, text.length * 90));
      u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}
const stopSpeaking = () => { try { if (HAS_TTS) speechSynthesis.cancel(); } catch { /* ignore */ } };

/* ---------- recorder / recogniser ---------- */
function startRecorder() {
  if (!stream || !window.MediaRecorder) return null;
  try {
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start();
    return {
      stop: () => new Promise((res) => {
        const fin = () => res(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null);
        if (rec.state === 'inactive') return fin();
        rec.onstop = fin;
        try { rec.stop(); } catch { fin(); }
      }),
    };
  } catch { return null; }
}

function startRecognizer() {
  if (!SR) return null;
  const st = { finals: [], interim: '', conf: [], firstSpeechAt: null, active: true, error: null };
  let r;
  try { r = new SR(); } catch { return null; }
  r.lang = 'en-US'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  const mark = () => { if (st.firstSpeechAt == null) st.firstSpeechAt = performance.now(); };
  r.onspeechstart = mark;
  r.onresult = (e) => {
    mark();
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const alt = res[0];
      if (res.isFinal) {
        const text = alt.transcript.trim();
        if (text) { st.finals.push(text); if (alt.confidence > 0) st.conf.push({ c: alt.confidence, w: Math.max(1, words(text)) }); }
      } else interim += alt.transcript;
    }
    st.interim = interim;
  };
  r.onerror = (e) => {
    st.error = e.error;
    if (['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported'].includes(e.error)) st.active = false;
  };
  r.onend = () => { if (st.active) setTimeout(() => { if (st.active) { try { r.start(); } catch { /* already started */ } } }, 150); };
  try { r.start(); } catch (e) { st.error = String(e); return null; }
  st.stop = () => new Promise((res) => {
    st.active = false;
    let finished = false;
    const done = () => { if (!finished) { finished = true; res(); } };
    r.onend = done;
    try { r.stop(); } catch { done(); }
    setTimeout(done, 1200);
  });
  st.text = () => (st.finals.join(' ') + ' ' + st.interim).replace(/\s+/g, ' ').trim();
  st.confidence = () => {
    const tot = st.conf.reduce((a, x) => a + x.w, 0);
    return tot ? st.conf.reduce((a, x) => a + x.c * x.w, 0) / tot : undefined;
  };
  return st;
}

/* ---------- views: home ---------- */
function bestFor(examId) {
  const h = getHistory().filter((x) => x.type === 'exam' && x.examId === examId);
  return h.length ? Math.max(...h.map((x) => x.result.overall_score)) : null;
}

function renderHome() {
  stopSpeaking();
  cancelAnimationFrame(levelRaf);
  const rows = D.exams.map((e) => {
    const best = bestFor(e.id);
    return `<div class="board-row" role="row">
      <span class="code">DLA ${pad(e.id)}</span>
      <span class="nm">${esc(e.name)}<small>5 genel, 2 resim, 2 senaryo, 2 yeniden anlatma</small></span>
      <span class="dur">11 soru, ~20 dk</span>
      <span class="best ${best == null ? 'none' : ''}">${best == null ? '—' : 'en iyi ' + best}</span>
      <button class="btn small" data-exam="${e.id}">Sınava başla</button>
    </div>`;
  }).join('');

  const gates = Object.entries(SECTIONS).map(([key, s]) => {
    const visual = key === 'picture'
      ? `<img class="thumb" src="${D.pictures[0].image}" alt="" loading="lazy">`
      : `<div class="ico" style="background:${s.color}" aria-hidden="true">${s.label[0]}</div>`;
    const opts = s.bank.map((q) => `<option value="${q.id}">Soru ${q.id}</option>`).join('');
    return `<div class="gate">
      ${visual}
      <div><h3>${s.label}</h3><p>${s.desc} 50 farklı soru.</p></div>
      <div class="ctl">
        <button class="btn small solid" data-practice="${key}" data-n="3">Rastgele 3 soru</button>
        <button class="btn small" data-practice="${key}" data-n="1">Rastgele 1 soru</button>
        <label class="help" for="sel-${key}" style="position:absolute;left:-999px">${s.label} için soru seç</label>
        <select id="sel-${key}">${opts}</select>
        <button class="btn small" data-pick="${key}">Bu soruyu çöz</button>
      </div>
    </div>`;
  }).join('');

  const hist = getHistory();
  const histHtml = hist.length
    ? `<table class="hist"><thead><tr><th>Tarih</th><th>Çalışma</th><th>Puan</th><th>Seviye</th><th></th></tr></thead><tbody>${hist.map((h, i) =>
        `<tr><td>${esc(fmtDate(h.ts))}</td><td>${esc(h.label)}</td><td><b>${h.result.overall_score}</b></td><td>${esc(h.result.cefr || '—')}</td><td><button class="btn link" data-hist="${i}">Sonucu aç</button></td></tr>`).join('')}</tbody></table>
       <p class="row"><button class="btn small" id="clear-hist">Geçmişi sil</button></p>`
    : '<p class="help">Henüz kayıt yok. İlk denemeni çözünce sonuçların burada görünecek (yalnızca bu tarayıcıda saklanır).</p>';

  show(`
    <section class="hero">
      <h1>DLA konuşma sınavına hazırlan</h1>
      <p>Kabin memurları için İngilizce konuşma sınavı provası. Gerçek sınavdaki gibi 15 saniye düşünür, 75 saniye konuşursun; ${SCORING ? 'cevaplarını Claude değerlendirir ve Türkçe geri bildirim verir.' : 'sonra kaydını dinleyip kendini değerlendirirsin. İstersen cevaplarını kopyalayıp kendi yapay zekâ sohbetinde de puanlatabilirsin.'}</p>
    </section>
    <p class="notice">Mikrofonlu bir bilgisayar veya telefon gerekir. En iyi sonuç için Chrome veya Edge kullan. Ses kaydın cihazından çıkmaz; ${SCORING ? 'yalnızca yazıya dökülmüş metin değerlendirme için gönderilir.' : 'hiçbir yere gönderilmez; sonuçların yalnızca bu tarayıcıda saklanır.'}</p>

    <h2 class="section-h" style="margin-top:0">Deneme sınavları</h2>
    <div class="board" role="table" aria-label="Deneme sınavları">
      <div class="board-head" role="row"><span>Kod</span><span>Sınav</span><span>Süre</span><span>Puan</span><span></span></div>
      ${rows}
    </div>
    <p class="cap">Beş sınav sabittir ve birbirinin sorularını tekrar etmez. Her biri gerçek sınav düzenindedir: geri dönüş yok, süre dolunca soru geçer.</p>

    <h2 class="section-h">Bölüm çalışması</h2>
    <div class="gates">${gates}</div>

    <h2 class="section-h">Ayarlar</h2>
    <div class="settings">
      <label><input type="checkbox" id="set-tts" ${settings.tts ? 'checked' : ''}> <span>Soruları sesli oku</span></label>
      <label><input type="checkbox" id="set-passage" ${settings.showPassage ? 'checked' : ''}> <span>Yeniden anlatma metnini konuşurken de göster (gerçek sınavda metnin görünüp görünmediği kesin değil)</span></label>
    </div>

    <h2 class="section-h">Geçmiş</h2>
    ${histHtml}
  `, false);

  root.querySelectorAll('[data-exam]').forEach((b) => b.addEventListener('click', () => {
    const e = D.exams.find((x) => x.id === Number(b.dataset.exam));
    goPrep({ type: 'exam', examId: e.id, label: e.name, items: examItems(e) });
  }));
  root.querySelectorAll('[data-practice]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.practice; const n = Number(b.dataset.n);
    const ids = pickRandom(SECTIONS[key].bank.map((q) => q.id), n);
    goPrep({ type: 'practice', section: key, label: `${SECTIONS[key].label} (${n} soru)`, items: ids.map((i) => makeItem(key, i)) });
  }));
  root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.pick; const id = Number($('#sel-' + key).value);
    goPrep({ type: 'practice', section: key, label: `${SECTIONS[key].label}, soru ${id}`, items: [makeItem(key, id)] });
  }));
  $('#set-tts').addEventListener('change', (e) => { settings.tts = e.target.checked; saveSettings(); });
  $('#set-passage').addEventListener('change', (e) => { settings.showPassage = e.target.checked; saveSettings(); });
  root.querySelectorAll('[data-hist]').forEach((b) => b.addEventListener('click', () => {
    const h = getHistory()[Number(b.dataset.hist)];
    if (h) renderResults(h, { fromHistory: true });
  }));
  const ch = $('#clear-hist');
  if (ch) ch.addEventListener('click', () => { if (confirm('Tüm geçmiş silinsin mi?')) { store.set('dla.history', []); renderHome(); } });
}

/* ---------- views: prep (mic check) ---------- */
function goPrep(session) {
  const isExam = session.type === 'exam';
  const recog = !!SR;
  show(`
    <p><button class="btn link" id="back">Ana sayfaya dön</button></p>
    <h1 style="font-size:clamp(1.8rem,5vw,2.6rem)">${esc(session.label)}</h1>
    <div class="panel">
      <h2>Başlamadan önce</h2>
      <ul>
        <li>${session.items.length} soru var. Her soruda önce soru gösterilir ve okunur, sonra <b>${T.think} saniye</b> düşünürsün, buton yeşile dönünce <b>${T.answer} saniye</b> içinde cevap verirsin.</li>
        <li>Cevabı erken bitirmek için yeşil butona bas. ${isExam ? 'Sınavda geri dönemez ve soruyu tekrarlayamazsın.' : 'Çalışma modunda düşünme süresini atlayabilirsin.'}</li>
        <li>Sessiz bir yerde, mikrofona yakın konuş. Cevapların bittiğinde yazıya dökülen metni düzeltebilir, sonra değerlendirmeye gönderebilirsin.</li>
      </ul>
    </div>
    <div class="panel">
      <h2>Mikrofon kontrolü</h2>
      <p id="mic-status" class="status">Mikrofon henüz açılmadı.</p>
      <div class="meter" aria-hidden="true"><i id="lvl"></i></div>
      <p class="help" id="recog-status">${recog ? 'Konuşma tanıma bu tarayıcıda destekleniyor.' : 'Bu tarayıcıda konuşma tanıma yok. Sesin kaydedilir ama değerlendirme için cevabını yazman gerekir. Konuşma tanıma için Chrome, Edge veya Safari kullan.'}</p>
      <div class="row">
        <button class="btn" id="mic-btn">Mikrofonu aç ve test et</button>
        <button class="btn solid" id="start" disabled>Başla</button>
        <button class="btn link" id="nomic">Mikrofon olmadan, yazarak devam et</button>
      </div>
    </div>
  `);
  $('#back').addEventListener('click', renderHome);
  const status = $('#mic-status'); const startBtn = $('#start');
  const ready = () => { startBtn.disabled = false; startBtn.focus(); };
  $('#mic-btn').addEventListener('click', async () => {
    status.className = 'status'; status.textContent = 'İzin bekleniyor…';
    try {
      await openMic();
      status.className = 'status ok'; status.textContent = 'Mikrofon açık. Bir şeyler söyle; çubuğun hareket ettiğini görmelisin.';
      watchLevel($('#lvl')); ready();
    } catch {
      status.className = 'status warn';
      status.textContent = 'Mikrofona erişilemedi. Tarayıcı adres çubuğundan mikrofon iznini ver ve tekrar dene; ya da yazarak devam et.';
    }
  });
  $('#nomic').addEventListener('click', () => { stream = null; session.noMic = true; startSession(session); });
  startBtn.addEventListener('click', () => startSession(session));
}

/* ---------- views: runner ---------- */
let active = null; // current run controller

async function startSession(session) {
  cancelAnimationFrame(levelRaf);
  const ctl = { cancelled: false, skip: null, finish: null };
  active = ctl;
  session.answers = [];
  const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', guard);
  try {
    for (let i = 0; i < session.items.length; i++) {
      if (ctl.cancelled) return;
      const ans = await runQuestion(session, i, ctl);
      if (ctl.cancelled) return;
      session.answers.push(ans);
    }
  } finally {
    window.removeEventListener('beforeunload', guard);
    stopSpeaking();
  }
  if (!ctl.cancelled) renderReview(session);
}

function countdown(sec, onTick, ctl) {
  return new Promise((resolve) => {
    const end = performance.now() + sec * 1000;
    let id;
    const finish = (why) => { clearInterval(id); ctl.skip = null; ctl.finish = null; resolve(why); };
    ctl.skip = () => finish('skipped');
    ctl.finish = () => finish('skipped');
    onTick(sec);
    id = setInterval(() => {
      if (ctl.cancelled) return finish('cancelled');
      const left = Math.ceil((end - performance.now()) / 1000);
      if (left <= 0) { onTick(0); finish('done'); } else onTick(left);
    }, 200);
  });
}

async function runQuestion(session, idx, ctl) {
  const it = session.items[idx];
  const isExam = session.type === 'exam';
  const segs = session.items.map((_, k) => `<i class="${k < idx ? 'done' : k === idx ? 'now' : ''}"></i>`).join('');
  const sec = SECTIONS[it.section];
  let body = '';
  if (it.section === 'picture') body += `<img class="scene" src="${it.image}" alt="Resim sorusu: resmi İngilizce anlat.">`;
  if (it.section === 'scenario') body += `<p class="situation">${esc(it.situation)}</p>`;
  if (it.section === 'retelling') body += `<div class="passage" id="passage">${esc(it.passage)}</div>`;
  const circ = 2 * Math.PI * 80;

  show(`
    <div class="run-top"><span class="who">${isExam ? esc(session.label) + ', ' : ''}Soru ${idx + 1} / ${session.items.length}</span>
      <button class="btn link" id="quit">Çalışmayı bırak</button></div>
    <div class="segs" aria-hidden="true">${segs}</div>
    <div class="qstage">
      <div class="qtext">
        <div class="tag">${sec.tag}</div>
        ${body}
        <div class="prompt" lang="en">${esc(it.prompt)}</div>
        ${!isExam && HAS_TTS && settings.tts ? '<button class="btn small" id="replay">Soruyu tekrar oku</button>' : ''}
      </div>
      <div class="timer">
        <div class="ring" id="ring"><svg viewBox="0 0 180 180" aria-hidden="true"><circle class="bg" cx="90" cy="90" r="80"/><circle class="fg" id="fg" cx="90" cy="90" r="80" stroke-dasharray="${circ}" stroke-dashoffset="0"/></svg><div class="num" id="secs">&nbsp;</div></div>
        <div class="tctl">
          <div class="phase" id="phase" role="status" aria-live="polite"></div>
          <button class="main-btn" id="main" disabled aria-disabled="true">Bekle…</button>
          <div class="mic"><div class="meter" aria-hidden="true"><i id="lvl"></i></div><small id="miclabel"></small></div>
          <div class="mini"></div>
        </div>
      </div>
    </div>`);

  $('#quit').addEventListener('click', () => {
    if (confirm('Çalışmayı bırakmak istediğine emin misin? Bu denemenin cevapları kaybolur.')) { ctl.cancelled = true; if (ctl.skip) ctl.skip(); stopSpeaking(); renderHome(); }
  });
  const replay = $('#replay');
  if (replay) replay.addEventListener('click', () => speak(it.speak));
  watchLevel($('#lvl'));

  const ring = $('#ring'); const fg = $('#fg'); const secs = $('#secs'); const phase = $('#phase'); const main = $('#main');
  const setRing = (left, total) => { fg.style.strokeDashoffset = String(circ * (1 - left / total)); secs.textContent = String(left); };

  // 1) read the question aloud
  phase.textContent = HAS_TTS && settings.tts ? 'Soruyu dinle' : 'Soruyu oku';
  if (!isExam) { /* practice: allow immediate start of thinking */ }
  if (it.section !== 'retelling' || (HAS_TTS && settings.tts)) await speak(it.speak);
  if (ctl.cancelled) return null;

  // 2) thinking time
  phase.textContent = it.section === 'retelling' ? 'Metni oku ve hazırlan' : 'Düşünme süresi';
  main.textContent = 'Hazırlan…';
  const mini = $('.mini');
  if (!isExam) {
    mini.innerHTML = '<button class="btn small" id="skipthink">Hemen başla</button>';
    $('#skipthink').addEventListener('click', () => ctl.skip && ctl.skip());
  }
  const thinkRes = await countdown(T.think, (l) => setRing(l, T.think), ctl);
  if (thinkRes === 'cancelled' || ctl.cancelled) return null;
  mini.innerHTML = '';

  // 3) answering
  if (it.section === 'retelling' && !settings.showPassage) $('#passage').classList.add('hidden');
  beep(880, 200);
  ring.classList.add('go');
  phase.textContent = 'Konuş';
  main.classList.add('go'); main.disabled = false; main.removeAttribute('aria-disabled');
  main.textContent = 'Cevabı bitir';
  main.focus({ preventScroll: true });
  const recorder = session.noMic ? null : startRecorder();
  const recog = session.noMic ? null : startRecognizer();
  const label = $('#miclabel');
  label.textContent = session.noMic ? 'Yazarak devam: konuşmanı not etmek için sonraki ekranı kullan.' : recog ? 'Kayıt ve konuşma tanıma açık' : 'Kayıt açık (konuşma tanıma yok)';
  const t0 = performance.now();
  main.addEventListener('click', () => ctl.finish && ctl.finish(), { once: true });
  const ansRes = await countdown(T.answer, (l) => setRing(l, T.answer), ctl);
  const t1 = performance.now();
  main.disabled = true; main.classList.remove('go');
  if (ansRes === 'cancelled' || ctl.cancelled) { if (recog) recog.stop(); if (recorder) recorder.stop(); return null; }
  beep(520, 160);
  phase.textContent = 'Kaydediliyor…';
  const [blob] = await Promise.all([recorder ? recorder.stop() : null, recog ? recog.stop() : null]);
  const first = recog && recog.firstSpeechAt;
  const answer = {
    qid: it.qid,
    transcript: recog ? recog.text() : '',
    confidence: recog ? recog.confidence() : undefined,
    latencyMs: first ? Math.round(first - t0) : undefined,
    durationMs: first ? Math.round(t1 - first) : undefined,
    edited: false,
    original: '',
    blob,
    url: blob ? URL.createObjectURL(blob) : null,
    recogError: recog ? recog.error : (SR ? 'unavailable' : 'unsupported'),
  };
  answer.original = answer.transcript;
  await sleep(FAST ? 50 : 500);
  return answer;
}

/* ---------- views: review ---------- */
function renderReview(session) {
  cancelAnimationFrame(levelRaf);
  const cards = session.items.map((it, i) => {
    const a = session.answers[i];
    const noSpeech = !a.transcript;
    return `<div class="card">
      <h3>${i + 1}. ${SECTIONS[it.section].tag}</h3>
      <div class="meta" lang="en">${esc(it.prompt)}${it.situation ? '<br>' + esc(it.situation) : ''}</div>
      ${a.url ? `<audio controls src="${a.url}"></audio>` : ''}
      <label class="help" for="t-${i}">${noSpeech ? 'Konuşman yazıya dökülemedi. Ne söylediğini aşağıya yazabilirsin (yazılan metinde telaffuz değerlendirilemez).' : 'Yazıya dökülen cevabın. Yanlış anlaşılan kelimeleri düzeltebilirsin.'}</label>
      <textarea id="t-${i}" data-i="${i}" lang="en" spellcheck="false">${esc(a.transcript)}</textarea>
      <div class="help" id="wc-${i}">${words(a.transcript)} kelime</div>
    </div>`;
  }).join('');
  show(`
    <h1 style="font-size:clamp(1.8rem,5vw,2.6rem)">Cevaplarını gözden geçir</h1>
    <p class="help">Tarayıcı konuşmanı yazıya döker; hatalı çıkan kelimeler puanını haksız yere düşürmesin diye düzeltebilirsin. Metni değiştirirsen Claude bunu bilir ve telaffuzu yalnızca tahmini değerlendirir.</p>
    ${cards}
    <div class="row">${SCORING ? '<button class="btn solid" id="score">Claude ile değerlendir</button><button class="btn" id="self">Kendim değerlendireyim</button>' : '<button class="btn solid" id="self">Kendimi değerlendir</button>'}<button class="btn" id="copyprompt">Yapay zekâya sormak için metni kopyala</button><button class="btn link" id="discard">Vazgeç ve ana sayfaya dön</button></div>
    <p class="help" id="copied" role="status"></p>
  `);
  root.querySelectorAll('textarea').forEach((ta) => ta.addEventListener('input', () => {
    const i = Number(ta.dataset.i); const a = session.answers[i];
    a.transcript = ta.value; a.edited = ta.value.trim() !== a.original.trim();
    $('#wc-' + i).textContent = words(ta.value) + ' kelime';
  }));
  if (SCORING) $('#score').addEventListener('click', () => submitScore(session));
  $('#self').addEventListener('click', () => renderSelf(session));
  $('#copyprompt').addEventListener('click', () => copyPrompt(session.items.map((it, i) => ({ section: it.section, prompt: it.prompt, context: it.context, transcript: session.answers[i].transcript })), $('#copied')));
  $('#discard').addEventListener('click', () => { if (confirm('Cevapların silinecek. Emin misin?')) renderHome(); });
}

/* ---------- free self-assessment ---------- */
const STOP = new Set('about after again because before being could every first from have into more other said some than that their them then there these they this those were what when where which while will with would your'.split(' '));
function coverage(passage, transcript) {
  const key = [...new Set((passage.toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5)))];
  if (!key.length) return null;
  const said = new Set((transcript.toLowerCase().match(/[a-z]{5,}/g) || []).map((w) => w.slice(0, 5)));
  return Math.round((key.filter((k) => said.has(k)).length / key.length) * 100);
}
function buildPrompt(items) {
  const head = `Sen havayolu kabin memuru adayları için çalışan deneyimli bir İngilizce konuşma sınavı değerlendiricisisin. Aşağıda THY DLA tarzı bir konuşma sınavı denemesine ait soruları ve adayın cevaplarının yazıya dökülmüş hâlini göreceksin. Metinler tarayıcının konuşma tanımasından geldiği için noktalama ve büyük harf yoktur; bunları puanlama.
Her cevabı 0-100 arasında puanla ve şu 5 kriteri ayrıca 0-100 puanla: telaffuz (sadece metinden tahmin, bunu belirt), dil bilgisi, kelime hazinesi, akıcılık, cevabın kapsamı. Genel puan ve tahmini CEFR seviyesi ver. Her cevap için Türkçe, kısa geri bildirim (bir güçlü yan, bir gelişim alanı) ve 60-90 kelimelik B2 seviyesinde örnek cevap yaz. En sonda çalışılacak 3 öncelik öner. Dürüst ol, şişirme.

`;
  const body = items.map((it, i) => `--- Soru ${i + 1} (${SECTIONS[it.section].tag}) ---
Soru: ${it.prompt}
${it.context ? (it.section === 'picture' ? 'Resmin açıklaması: ' : it.section === 'retelling' ? 'Okunan metin: ' : 'Durum: ') + it.context + '\n' : ''}Adayın cevabı: ${it.transcript || '(cevap yok)'}`).join('\n\n');
  return head + body;
}
async function copyPrompt(items, el) {
  const text = buildPrompt(items);
  try { await navigator.clipboard.writeText(text); el.textContent = 'Kopyalandı. Şimdi claude.ai veya başka bir yapay zekâ sohbetine yapıştır.'; }
  catch {
    el.textContent = 'Otomatik kopyalanamadı; metni aşağıdan seçip kopyala.';
    const ta = document.createElement('textarea'); ta.value = text; ta.readOnly = true; ta.style.minHeight = '160px'; el.after(ta); ta.select();
  }
}

function renderSelf(session) {
  const cards = session.items.map((it, i) => {
    const a = session.answers[i];
    const list = [...CHECKS[it.section], ...CHECKS.common];
    const secs = a.durationMs ? Math.round(a.durationMs / 1000) : null;
    const wc = words(a.transcript);
    const wpm = secs && secs > 3 && wc ? Math.round((wc / secs) * 60) : null;
    const cov = it.section === 'retelling' && a.transcript ? coverage(it.passage, a.transcript) : null;
    const facts = [`${wc} kelime`, secs ? `${secs} sn konuştun` : '', wpm ? `dakikada ${wpm} kelime (doğal hız 110-150)` : '', cov != null ? `metindeki anahtar kelimelerin %${cov}'ini kullandın` : '', a.edited ? 'metni sen düzelttin' : ''].filter(Boolean).join(', ');
    return `<fieldset class="card"><legend><b>${i + 1}. ${SECTIONS[it.section].tag}</b></legend>
      <div class="meta" lang="en">${esc(it.prompt)}${it.situation ? '<br>' + esc(it.situation) : ''}</div>
      ${a.url ? `<audio controls src="${a.url}"></audio>` : ''}
      <div class="quote" lang="en">${a.transcript ? esc(a.transcript) : '(cevap kaydedilemedi)'}</div>
      <p class="help">${esc(facts)}</p>
      ${list.map((c, k) => `<label class="chk"><input type="checkbox" data-i="${i}" data-k="${k}"> <span>${esc(c[1])}</span></label>`).join('')}
    </fieldset>`;
  }).join('');
  show(`
    <h1 style="font-size:clamp(1.8rem,5vw,2.6rem)">Kendini değerlendir</h1>
    <p class="help">Kaydını dinle, metne bak ve doğru olan maddeleri işaretle. Dürüst işaretlemek en doğru sonucu verir. Puan, işaretlediklerinin oranıdır.</p>
    ${cards}
    <div class="row"><button class="btn solid" id="finish">Sonucu göster</button><button class="btn link" id="back-review">Cevaplara dön</button></div>`);
  $('#back-review').addEventListener('click', () => renderReview(session));
  $('#finish').addEventListener('click', () => {
    const crit = {}; Object.keys(CRIT).forEach((k) => { crit[k] = { yes: 0, all: 0 }; });
    const items = session.items.map((it, i) => {
      const list = [...CHECKS[it.section], ...CHECKS.common]; let yes = 0;
      list.forEach((c, k) => {
        const on = root.querySelector(`input[data-i="${i}"][data-k="${k}"]`).checked;
        crit[c[0]].all++; if (on) { crit[c[0]].yes++; yes++; }
      });
      return { qid: it.qid, score: Math.round((yes / list.length) * 100), feedback_tr: '', improved_answer_en: '' };
    });
    const criteria = {}; Object.keys(CRIT).forEach((k) => { criteria[k] = { score: crit[k].all ? Math.round((crit[k].yes / crit[k].all) * 100) : 0, comment_tr: '' }; });
    const overall = Math.round(items.reduce((a, x) => a + x.score, 0) / items.length);
    const weakest = Object.keys(criteria).sort((a, b) => criteria[a].score - criteria[b].score).slice(0, 3).map((k) => TIPS[k]);
    const entry = {
      ts: Date.now(), type: session.type, examId: session.examId || null, label: session.label + ' (öz değerlendirme)',
      result: { self: true, overall_score: overall, cefr: '', criteria, items, priorities_tr: weakest, reliability_note_tr: 'Bu puanı sen verdin: işaretlediğin maddelerin oranını gösterir, resmî veya yapay zekâ puanı değildir.' },
      items: session.items.map((it, i) => ({ qid: it.qid, section: it.section, prompt: it.prompt, situation: it.situation || '', context: it.context || '', transcript: session.answers[i].transcript })),
    };
    store.set('dla.history', [entry, ...getHistory()].slice(0, 30));
    renderResults(entry, { session });
  });
}

/* ---------- scoring ---------- */
async function submitScore(session) {
  show(`<h1 style="font-size:clamp(1.8rem,5vw,2.6rem)">Claude değerlendiriyor</h1><div class="spin" role="status" aria-label="Yükleniyor"></div><p class="help">Bu işlem yaklaşık 20 ila 60 saniye sürer. Sayfayı kapatma.</p>`);
  const payload = {
    mode: session.type === 'exam' ? 'exam' : 'practice',
    items: session.items.map((it, i) => {
      const a = session.answers[i];
      return { section: it.section, qid: it.qid, prompt: it.prompt, context: it.context, transcript: a.transcript.trim(), confidence: a.edited ? undefined : a.confidence, latencyMs: a.latencyMs, durationMs: a.durationMs, edited: a.edited };
    }),
  };
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 110000);
    const res = await fetch('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    clearTimeout(to);
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || 'Değerlendirme alınamadı. Lütfen tekrar dene.');
    const entry = {
      ts: Date.now(), type: session.type, examId: session.examId || null, label: session.label, result: data.result,
      items: session.items.map((it, i) => ({ qid: it.qid, section: it.section, prompt: it.prompt, situation: it.situation || '', context: it.context || '', transcript: session.answers[i].transcript })),
    };
    store.set('dla.history', [entry, ...getHistory()].slice(0, 30));
    renderResults(entry, { session });
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Değerlendirme çok uzun sürdü.' : err.message;
    show(`<h1 style="font-size:clamp(1.8rem,5vw,2.6rem)">Değerlendirme yapılamadı</h1>
      <div class="err" role="alert"><p><b>${esc(msg)}</b></p><p class="help">Cevapların hâlâ burada duruyor; sayfayı kapatmadan tekrar deneyebilirsin.</p></div>
      <div class="row"><button class="btn solid" id="retry">Tekrar dene</button><button class="btn" id="back-review">Cevaplara dön</button></div>`);
    $('#retry').addEventListener('click', () => submitScore(session));
    $('#back-review').addEventListener('click', () => renderReview(session));
  }
}

/* ---------- views: results ---------- */
function validityNote(score) {
  if (score >= 85) return 'Resmî olmayan kaynaklara göre bu aralık en uzun geçerlilik süresine denk gelir.';
  if (score >= 70) return 'Resmî olmayan kaynaklara göre bu aralık orta geçerlilik süresine denk gelir.';
  return 'Resmî olmayan kaynaklara göre bu aralıkta sınavı daha sık tekrarlaman gerekebilir.';
}

function renderResults(entry, opts = {}) {
  const r = entry.result; const session = opts.session;
  const bars = Object.keys(CRIT).map((k) => `<div class="bar"><b><span>${CRIT[k]}</span><span>${r.criteria[k].score}</span></b><div class="track"><i style="--w:${r.criteria[k].score}%"></i></div><p>${esc(r.criteria[k].comment_tr)}</p></div>`).join('');
  const items = entry.items.map((it, i) => {
    const ri = r.items.find((x) => x.qid === it.qid) || { score: 0, feedback_tr: '', improved_answer_en: '' };
    const audio = session && session.answers[i] && session.answers[i].url ? `<audio controls src="${session.answers[i].url}"></audio>` : '';
    return `<details class="item"><summary><span>${i + 1}. ${SECTIONS[it.section].tag}</span><span class="sc">${ri.score}</span></summary>
      <p lang="en"><b>${esc(it.prompt)}</b>${it.situation ? '<br>' + esc(it.situation) : ''}</p>
      ${audio}
      <div class="quote" lang="en">${it.transcript ? esc(it.transcript) : '(cevap kaydedilemedi)'}</div>
      ${ri.feedback_tr ? `<p>${esc(ri.feedback_tr)}</p>` : ''}
      ${ri.improved_answer_en ? `<div class="model" lang="en"><b>Örnek cevap:</b> ${esc(ri.improved_answer_en)}</div>` : ''}</details>`;
  }).join('');
  show(`
    <p><button class="btn link" id="home">Ana sayfaya dön</button></p>
    <p class="help">${esc(entry.label)}, ${esc(fmtDate(entry.ts))}</p>
    <div class="score-hero"><div class="big">${r.overall_score}<small>/100</small></div><div>${r.self ? '<p class="help" style="max-width:34ch">Öz değerlendirme puanı: işaretlediğin maddelerin oranı.</p>' : `<span class="cefr">${esc(r.cefr)}</span><p class="help" style="margin-top:8px;max-width:34ch">Tahmini konuşma seviyesi. ${entry.type === 'exam' ? esc(validityNote(r.overall_score)) : ''}</p>`}</div></div>
    <div class="bars">${bars}</div>
    <div class="card"><h3>Önce şunlara çalış</h3><ol class="prio">${r.priorities_tr.map((p) => `<li>${esc(p)}</li>`).join('')}</ol></div>
    <p class="help">${esc(r.reliability_note_tr)}${r.self ? '' : " Puanlar Claude'un tahminidir; THY'nin resmî puanıyla birebir aynı olmayabilir."}</p>
    <div class="row"><button class="btn" id="cp">Cevaplarımı yapay zekâya sormak için kopyala</button></div><p class="help" id="copied" role="status"></p>
    <h2 class="section-h">Soru soru</h2>
    ${items}
    <div class="row"><button class="btn solid" id="again">Yeni çalışma</button></div>
  `);
  $('#home').addEventListener('click', renderHome);
  $('#cp').addEventListener('click', () => copyPrompt(entry.items.map((it) => ({ section: it.section, prompt: it.prompt, context: it.context || it.situation || '', transcript: it.transcript })), $('#copied')));
  $('#again').addEventListener('click', renderHome);
}

renderHome();
})();
