/* FlowLog v2 — base comum a todas as telas (sem framework, sem build).
   Cada tela se registra em FL.telas[id] = { titulo, montar(el) }. */
(function () {
  'use strict';
  const FL = window.FL = { telas: {}, estado: {} };

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  const esc = FL.esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  FL.num = (v, casas = 0) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  FL.brl = (v) => (v == null || isNaN(v)) ? '—' : 'R$ ' + FL.num(v, 2);
  FL.kg = (v) => (v == null || isNaN(v)) ? '—' : FL.num(v, 1) + ' kg';
  FL.data = (iso) => { if (!iso) return '—'; const s = String(iso).slice(0, 10); return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4); };
  FL.dataCurta = (iso) => { if (!iso) return '—'; const s = String(iso).slice(0, 10); return s.slice(8, 10) + '/' + s.slice(5, 7); };
  FL.dataHora = (iso) => iso ? FL.dataCurta(iso) + ' ' + String(iso).slice(11, 16) : '—';
  FL.hojeISO = () => { const d = new Date(Date.now() - 3 * 3600 * 1000); return d.toISOString().slice(0, 10); };
  FL.diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  FL.somarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  FL.semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  FL.plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  FL.icone = {
    seta: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg>',
    seguir: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>',
    x: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg>',
    ok: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"></path></svg>',
    alerta: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 8v5M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></svg>',
    lixo: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg>',
    lapis: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="m13 7 4 4"></path></svg>',
    enviar: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"></path></svg>',
    baixar: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"></path></svg>',
    filtro: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"></path></svg>',
    cadeado: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="1"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>'
  };

  // ------------------------------------------------------------------
  // Quem está usando (sem login) e senha de administrador
  // ------------------------------------------------------------------
  const lerLocal = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } };
  const lerSessao = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const gravarSessao = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } };
  FL.usuario = () => lerLocal('fl_usuario') || '';
  FL.PESSOAS = ['Rian', 'Silvia', 'Norma', 'Calebe', 'Vitor', 'Elizeu', 'Guilherme'];

  FL.escolherUsuario = function (obrigatorio) {
    return new Promise((resolve) => {
      const atual = FL.usuario();
      const html = `
        <p>O nome aparece nos registros (“Registrado por”).</p>
        <div class="chips" role="group" aria-label="Pessoas">
          ${FL.PESSOAS.map((p) => `<button type="button" class="chip" data-nome="${esc(p)}" aria-pressed="${p === atual}">${esc(p)}</button>`).join('')}
        </div>
        <div class="campo"><label for="flOutroNome">Ou escreva o seu nome</label>
          <input id="flOutroNome" type="text" maxlength="40" value="${FL.PESSOAS.includes(atual) ? '' : esc(atual)}"></div>`;
      const m = FL.modal({ titulo: 'Quem está usando?', icone: 'neutro', html, botao: 'Pronto', semVoltar: obrigatorio,
        aoConfirmar: (el) => {
          const sel = el.querySelector('.chip[aria-pressed="true"]');
          const nome = (el.querySelector('#flOutroNome').value.trim() || (sel && sel.dataset.nome) || '').slice(0, 40);
          if (!nome) { FL.toast('Escolha ou escreva um nome.', { erro: true }); return false; }
          gravarLocal('fl_usuario', nome);
          atualizarUsuarioTopo();
          resolve(nome);
          return true;
        },
        aoFechar: () => resolve(FL.usuario()) });
      m.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
        m.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        m.querySelector('#flOutroNome').value = '';
      }));
    });
  };

  FL.senhaGuardada = () => lerSessao('fl_senha');

  // Tela protegida por senha própria (Cobrança, Pós-venda). A de administrador também abre.
  // Sem senha cadastrada para a tela, ela abre direto. A senha fica guardada até fechar o navegador.
  FL.protegerTela = async function (alvo, tela, nome, montar) {
    const chave = 'fl_senha_tela_' + tela;
    const tentar = async (senha, avisar) => {
      const r = await FL.api('POST', `/api/v2/senha-tela/${tela}/conferir`, { senha: senha || '' }, { silencioso: !avisar });
      if (!r) return false;
      if (r.ok) { if (senha) gravarSessao(chave, senha); return true; }
      if (senha) gravarSessao(chave, null);
      return false;
    };
    if (await tentar(lerSessao(chave) || FL.senhaGuardada() || '', false)) return montar(alvo);
    const novo = alvo.cloneNode(false); alvo.replaceWith(novo);
    novo.innerHTML = `<div class="fl-cabeca fl-entra"><div class="txt"><h1>${esc(nome)}</h1></div></div>
      <section class="fl-secao forte fl-entra d1" style="max-width:420px">
        <span aria-hidden="true" style="width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--r-btn);background:var(--c1)">${FL.icone.cadeado}</span>
        <div class="campo"><label for="telaSenha">Senha</label><input id="telaSenha" type="password" autocomplete="current-password"></div>
        <button type="button" class="btn grande" data-entrar-tela>Entrar</button>
      </section>`;
    const entrar = async () => {
      const i = novo.querySelector('#telaSenha');
      if (!i.value) { i.focus(); return; }
      if (await tentar(i.value, true)) { const limpo = novo.cloneNode(false); novo.replaceWith(limpo); montar(limpo); }
      else { FL.toast('Senha errada.', { erro: true }); i.select(); }
    };
    novo.addEventListener('click', (e) => { if (e.target.closest('[data-entrar-tela]')) entrar(); });
    novo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'telaSenha') entrar(); });
    setTimeout(() => { const i = novo.querySelector('#telaSenha'); if (i) i.focus(); }, 60);
  };
  FL.esquecerSenha = () => gravarSessao('fl_senha', null);

  FL.pedirSenha = function (motivo) {
    return new Promise((resolve) => {
      const html = `<p>${esc(motivo || 'Mexer nas Configurações pede a senha de administrador.')}</p>
        <div class="campo"><label for="flSenha">Senha de administrador</label>
        <input id="flSenha" type="password" autocomplete="current-password"></div>
        `;
      const m = FL.modal({ titulo: 'Senha de administrador', icone: 'neutro', html, botao: 'Continuar',
        aoConfirmar: async (el) => {
          const s = el.querySelector('#flSenha').value;
          if (!s) return false;
          const r = await FL.api('POST', '/api/v2/senha/conferir', { senha: s });
          if (!r) return false; // o aviso de erro (rede, muitas tentativas) já apareceu
          if (!r.definida) { resolve(null); setTimeout(() => FL.definirSenha(), 50); return true; }
          if (!r.ok) { FL.toast('Senha errada.', { erro: true }); return false; }
          gravarSessao('fl_senha', s);
          resolve(s);
          return true;
        },
        aoFechar: () => resolve(null) });
      setTimeout(() => { const i = m.querySelector('#flSenha'); if (i) i.focus(); }, 60);
    });
  };

  FL.definirSenha = function (trocar) {
    return new Promise((resolve) => {
      const html = `<p>${trocar ? 'Troque a senha de administrador.' : 'Nova senha de administrador. Não pode ser recuperada.'}</p>
        ${trocar ? '<div class="campo"><label for="flSenhaAtual">Senha atual</label><input id="flSenhaAtual" type="password" autocomplete="current-password"></div>' : ''}
        <div class="campo"><label for="flSenhaNova">Senha nova <span style="font-weight:400">(mínimo 8 caracteres)</span></label><input id="flSenhaNova" type="password" autocomplete="new-password"></div>
        <div class="campo"><label for="flSenhaNova2">Repita a senha nova</label><input id="flSenhaNova2" type="password" autocomplete="new-password"></div>`;
      FL.modal({ titulo: trocar ? 'Trocar senha' : 'Definir senha de administrador', icone: 'neutro', html, botao: 'Salvar senha',
        aoConfirmar: async (el) => {
          const nova = el.querySelector('#flSenhaNova').value;
          if (nova.length < 8) { FL.toast('A senha precisa ter pelo menos 8 caracteres.', { erro: true }); return false; }
          if (nova !== el.querySelector('#flSenhaNova2').value) { FL.toast('As duas senhas não são iguais.', { erro: true }); return false; }
          const atual = trocar ? el.querySelector('#flSenhaAtual').value : null;
          const r = await FL.api('POST', '/api/v2/senha', { nova, atual });
          if (!r) return false;
          gravarSessao('fl_senha', nova);
          FL.toast(trocar ? 'Senha trocada.' : 'Senha definida.');
          resolve(true);
          return true;
        },
        aoFechar: () => resolve(false) });
    });
  };

  // ------------------------------------------------------------------
  // Comunicação com o servidor
  // ------------------------------------------------------------------
  // opcoes: { senha: true } envia a senha (e pede se faltar);
  //         { form: FormData } envia arquivo; { blob: true } devolve arquivo;
  //         { silencioso: true } não mostra aviso de erro.
  FL.api = async function (metodo, url, corpo, opcoes) {
    opcoes = opcoes || {};
    const cab = {};
    const nome = FL.usuario();
    if (nome) cab['X-Usuario'] = encodeURIComponent(nome);
    if (opcoes.senha) {
      let s = FL.senhaGuardada();
      if (!s) {
        const st = await FL.api('GET', '/api/v2/senha', null, { silencioso: true });
        if (st && !st.definida) { await FL.definirSenha(); s = FL.senhaGuardada(); }
        else s = await FL.pedirSenha();
        if (!s) return null;
      }
      cab['X-Senha'] = encodeURIComponent(s);
    }
    let body;
    if (opcoes.form) body = opcoes.form;
    else if (corpo != null) { cab['Content-Type'] = 'application/json'; body = JSON.stringify(corpo); }
    let res;
    try {
      res = await fetch(url, { method: metodo, headers: cab, body });
    } catch (e) {
      if (!opcoes.silencioso) FL.toast('Sem conexão com o servidor. Tente de novo.', { erro: true });
      return null;
    }
    if (opcoes.senha && res.status === 429) {
      FL.toast('Muitas tentativas de senha errada. Espere 1 minuto e tente de novo.', { erro: true });
      return null;
    }
    if (opcoes.senha && res.status === 401 && !opcoes.repetiu) {
      FL.esquecerSenha();
      FL.toast('Senha errada.', { erro: true });
      return FL.api(metodo, url, corpo, Object.assign({}, opcoes, { repetiu: true }));
    }
    if (opcoes.senha && res.status === 403 && !opcoes.repetiu) {
      if (await FL.definirSenha()) return FL.api(metodo, url, corpo, Object.assign({}, opcoes, { repetiu: true }));
      return null;
    }
    if (!res.ok) {
      let msg = 'Erro ' + res.status;
      try { const d = await res.json(); if (d && d.detail) msg = typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail); } catch (e) { /* sem corpo */ }
      if (!opcoes.silencioso) FL.toast(msg, { erro: true });
      return null;
    }
    if (opcoes.blob) return { blob: await res.blob(), nome: ((res.headers.get('content-disposition') || '').match(/filename="?([^";]+)/) || [])[1] };
    try { return await res.json(); } catch (e) { return {}; }
  };

  FL.baixarArquivo = function (blob, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome || 'arquivo';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  // ------------------------------------------------------------------
  // Aviso no canto (some sozinho), com "Desfazer" opcional
  // ------------------------------------------------------------------
  let timerToast = null;
  FL.toast = function (msg, opcoes) {
    opcoes = opcoes || {};
    const velho = document.querySelector('.fl-toast');
    if (velho) velho.remove();
    const t = document.createElement('div');
    t.className = 'fl-toast' + (opcoes.erro ? ' erro' : '');
    t.setAttribute('role', opcoes.erro ? 'alert' : 'status');
    t.innerHTML = `<span class="ic" aria-hidden="true">${opcoes.erro ? FL.icone.alerta : FL.icone.ok}</span>
      <span class="msg">${esc(msg)}</span>
      ${opcoes.desfazer ? '<button type="button" class="desfazer">Desfazer</button>' : ''}
      <button type="button" class="x" aria-label="Fechar aviso">${FL.icone.x}</button>`;
    document.body.appendChild(t);
    t.querySelector('.x').addEventListener('click', () => t.remove());
    if (opcoes.desfazer) t.querySelector('.desfazer').addEventListener('click', async () => { t.remove(); await opcoes.desfazer(); });
    clearTimeout(timerToast);
    timerToast = setTimeout(() => t.remove(), opcoes.desfazer ? 8000 : (opcoes.erro ? 7000 : 4500));
  };

  // ------------------------------------------------------------------
  // Gaveta lateral (formulários) e modal no meio (confirmações)
  // ------------------------------------------------------------------
  const pilha = [];
  function abrirCamada(el, aoFechar) {
    const anterior = document.activeElement;
    document.body.appendChild(el);
    const fechar = () => {
      if (!el.isConnected) return;
      el.remove();
      const i = pilha.indexOf(fechar); if (i >= 0) pilha.splice(i, 1);
      if (aoFechar) aoFechar();
      if (anterior && anterior.focus) anterior.focus();
    };
    pilha.push(fechar);
    el.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));
    return fechar;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pilha.length) pilha[pilha.length - 1](); });

  // opcoes: { sobre, titulo, sub, html, botao, semAutor, largura, aoSalvar(el) -> bool|Promise<bool>, aoAbrir(el), aoFechar }
  FL.gaveta = function (op) {
    const el = document.createElement('div');
    el.className = 'fl-sobreposicao';
    el.innerHTML = `<button class="fl-fundo" type="button" aria-label="Fechar" data-fechar></button>
      <aside class="fl-gaveta" role="dialog" aria-modal="true" aria-labelledby="gvTitulo" ${op.largura ? `style="width:${op.largura}px"` : ''}>
        <div class="cab"><div><span class="sobre">${esc(op.sobre || '')}</span><h2 id="gvTitulo">${esc(op.titulo)}</h2>${op.sub ? `<p>${esc(op.sub)}</p>` : ''}</div>
          <button type="button" class="btn-fechar" aria-label="Fechar" data-fechar>${FL.icone.x}</button></div>
        <div class="meio">${op.html || ''}<p class="aviso" role="alert" hidden data-erro></p></div>
        <div class="pe">
          ${op.semAutor ? '' : `<span class="autor">Será registrado por <b>${esc(FL.usuario() || '—')}</b> · agora</span>`}
          <div class="botoes">
            <button type="button" class="btn sec grande" data-fechar>${esc(op.cancelar || 'Cancelar')}</button>
            ${op.botao ? `<button type="button" class="btn grande" data-salvar>${esc(op.botao)}</button>` : ''}
          </div>
        </div>
      </aside>`;
    const fechar = abrirCamada(el, op.aoFechar);
    el.fechar = fechar;
    el.erro = (msg) => { const p = el.querySelector('[data-erro]'); p.hidden = !msg; p.textContent = msg || ''; };
    const salvar = el.querySelector('[data-salvar]');
    if (salvar) salvar.addEventListener('click', async () => {
      el.erro('');
      salvar.disabled = true;
      try { if (await op.aoSalvar(el)) fechar(); } finally { salvar.disabled = false; }
    });
    if (op.aoAbrir) op.aoAbrir(el);
    setTimeout(() => { const f = el.querySelector('.meio input, .meio select, .meio textarea, .meio button'); if (f) f.focus(); }, 60);
    return el;
  };

  // opcoes: { titulo, html, botao, perigo, icone ('neutro'|undefined), semVoltar, aoConfirmar(el) -> bool|Promise<bool>, aoFechar }
  FL.modal = function (op) {
    const el = document.createElement('div');
    el.className = 'fl-sobreposicao centro';
    el.innerHTML = `<button class="fl-fundo" type="button" aria-label="Fechar" ${op.semVoltar ? '' : 'data-fechar'}></button>
      <div class="fl-modal" role="alertdialog" aria-modal="true" aria-labelledby="mdTitulo">
        <div class="meio"><span class="icone ${op.icone || ''}" aria-hidden="true">${op.icone === 'neutro' ? FL.icone.cadeado : FL.icone.lixo}</span>
          <h2 id="mdTitulo">${esc(op.titulo)}</h2>${op.html || ''}</div>
        <div class="pe">${op.semVoltar ? '' : '<button type="button" class="btn sec grande" data-fechar>Voltar</button>'}
          <button type="button" class="btn grande ${op.perigo ? 'perigo' : ''}" data-ok>${esc(op.botao || 'Confirmar')}</button></div>
      </div>`;
    const fechar = abrirCamada(el, op.aoFechar);
    el.querySelector('[data-ok]').addEventListener('click', async () => {
      const b = el.querySelector('[data-ok]');
      b.disabled = true;
      let ok = true;
      try { ok = op.aoConfirmar ? await op.aoConfirmar(el) : true; } finally { b.disabled = false; }
      if (ok !== false) { op.aoFechar = null; el.remove(); const i = pilha.indexOf(fechar); if (i >= 0) pilha.splice(i, 1); }
    });
    el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.querySelector('[data-ok]').click(); }));
    return el;
  };

  FL.confirmar = (op) => new Promise((resolve) => {
    FL.modal(Object.assign({}, op, { aoConfirmar: () => { resolve(true); return true; }, aoFechar: () => resolve(false) }));
  });

  // ------------------------------------------------------------------
  // Abas e filtros (mesmo comportamento em todas as telas)
  // ------------------------------------------------------------------
  FL.htmlAbas = (abas, ativa, rotulo) => `<div class="fl-abas" role="group" aria-label="${esc(rotulo || 'Abas')}">${abas.map((a) =>
    `<button type="button" class="fl-aba" data-aba="${esc(a.id)}" aria-pressed="${a.id === ativa}">${esc(a.rotulo)}${a.qtd != null && a.qtd !== '' ? `<span class="qtd ${a.alerta ? 'alerta' : ''}">${esc(a.qtd)}</span>` : ''}</button>`).join('')}</div>`;

  // defs: [{ id, titulo, valor(item) -> [texto], ordem? }]; marcados: { id: [valores] }
  // No mesmo grupo soma (OU); entre grupos cruza (E).
  FL.passaFiltros = (item, defs, marcados, exceto) => defs.every((g) => {
    if (g.id === exceto) return true;
    const m = marcados[g.id] || [];
    return !m.length || g.valor(item).some((v) => m.includes(v));
  });
  FL.htmlChipsAtivos = (defs, marcados) => {
    const ativos = [];
    defs.forEach((g) => (marcados[g.id] || []).forEach((v) => ativos.push({ g, v })));
    if (!ativos.length) return '';
    return `<div class="chips" style="align-items:center"><span style="font-size:13px;font-weight:700">Filtrando por:</span>
      ${ativos.map((a) => `<button type="button" class="chip" style="background:#000;color:#fff;border-color:#000;min-height:32px" data-tirar-filtro="${esc(a.g.id)}" data-valor="${esc(a.v)}" aria-label="Remover filtro ${esc(a.g.titulo)}: ${esc(a.v)}"><span style="color:var(--verde);font-weight:700">${esc(a.g.titulo.charAt(0) + a.g.titulo.slice(1).toLowerCase())}:</span> ${esc(a.v)} ${FL.icone.x}</button>`).join('')}
      <button type="button" class="link" data-limpar-filtros>Limpar tudo</button></div>`;
  };
  FL.qtdFiltros = (marcados) => Object.values(marcados).reduce((s, l) => s + (l ? l.length : 0), 0);
  FL.botaoFiltros = (marcados) => `<button type="button" class="btn sec" data-abrir-filtros style="min-height:40px;margin-bottom:6px">${FL.icone.filtro} Filtros${FL.qtdFiltros(marcados) ? ` <span class="selo ok">${FL.qtdFiltros(marcados)}</span>` : ''}</button>`;

  // Gaveta de filtros. itens = os da aba atual. Devolve via aoMudar(novosMarcados).
  FL.gavetaFiltros = function ({ sobre, defs, itens, marcados, aoMudar, nomeItens, extraHtml }) {
    let m = JSON.parse(JSON.stringify(marcados || {}));
    const g = FL.gaveta({ sobre, titulo: 'Filtros especializados', html: `<div data-extra>${extraHtml || ''}</div><div data-grupos></div>`, semAutor: true, cancelar: 'Fechar', botao: 'Ver resultado', aoSalvar: () => true });
    const desenhar = () => {
      const caixa = g.querySelector('[data-grupos]');
      caixa.innerHTML = defs.map((d) => {  // o período (extraHtml) fica fora: redesenhar não apaga o que foi digitado
        const vals = [];
        itens.forEach((it) => d.valor(it).forEach((v) => { if (v != null && v !== '' && !vals.includes(v)) vals.push(v); }));
        (m[d.id] || []).forEach((v) => { if (!vals.includes(v)) vals.push(v); });
        const ord = d.ordem ? d.ordem.filter((v) => vals.includes(v)).concat(vals.filter((v) => !d.ordem.includes(v)).sort()) : vals.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
        if (!ord.length) return '';
        const base = itens.filter((it) => FL.passaFiltros(it, defs, m, d.id));
        return `<section style="display:flex;flex-direction:column;gap:10px;padding:16px 0;border-bottom:1px solid var(--c3)">
          <div style="display:flex;justify-content:space-between"><h3 style="margin:0;font-size:12px;letter-spacing:.06em">${esc(d.titulo)}</h3>
          ${(m[d.id] || []).length ? `<button type="button" class="link" style="font-size:12px" data-limpar-grupo="${esc(d.id)}">limpar</button>` : ''}</div>
          <div class="chips">${ord.map((v) => `<button type="button" class="chip" data-grupo="${esc(d.id)}" data-valor="${esc(v)}" aria-pressed="${(m[d.id] || []).includes(v)}">${esc(v)} <span class="n">${base.filter((it) => d.valor(it).includes(v)).length}</span></button>`).join('')}</div></section>`;
      }).join('');
      const qtd = itens.filter((it) => FL.passaFiltros(it, defs, m)).length;
      g.querySelector('[data-salvar]').textContent = `Ver ${qtd} ${nomeItens || 'itens'}`;
    };
    g.addEventListener('click', (e) => {
      const c = e.target.closest('[data-grupo]');
      if (c) {
        const lista = m[c.dataset.grupo] || [];
        m[c.dataset.grupo] = lista.includes(c.dataset.valor) ? lista.filter((x) => x !== c.dataset.valor) : lista.concat([c.dataset.valor]);
        desenhar(); aoMudar(m); return;
      }
      const l = e.target.closest('[data-limpar-grupo]');
      if (l) { m[l.dataset.limparGrupo] = []; desenhar(); aoMudar(m); }
    });
    desenhar();
    return g;
  };

  // ------------------------------------------------------------------
  // Busca do topo: filtra as linhas da tabela visível (e Ctrl K foca)
  // ------------------------------------------------------------------
  FL.textoBusca = () => FL.semAcento((document.getElementById('flBuscaTopo') || {}).value || '').trim().replace(/[.\s]/g, '');
  let timerBusca = null;
  FL.aplicarBusca = function () {
    const tela = FL.telas[FL.estado.tela];
    if (tela && tela.buscar) { clearTimeout(timerBusca); timerBusca = setTimeout(() => tela.buscar(FL.textoBusca()), 180); return; }
    const q = FL.textoBusca();
    document.querySelectorAll('main .fl-tabela > tbody > tr').forEach((tr) => {
      if (tr.classList.contains('detalhe')) { tr.style.display = tr.previousElementSibling && tr.previousElementSibling.style.display === 'none' ? 'none' : ''; return; }
      if (tr.querySelector('td.vazio')) return;
      tr.style.display = !q || FL.semAcento(tr.textContent).replace(/[.\s]/g, '').includes(q) ? '' : 'none';
    });
  };

  // ------------------------------------------------------------------
  // Estrutura: menu lateral, topo, rotas
  // ------------------------------------------------------------------
  const MENU = [
    { id: 'pedidos', nome: 'Pedidos', icone: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"></path><path d="M3 7.5 12 12l9-4.5"></path><path d="M12 12v9"></path>' },
    { id: 'avisos', nome: 'Avisos de canhoto', icone: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"></path><path d="M10 21h4"></path>' },
    { id: 'transportadora', nome: 'Transportadora', icone: '<path d="M2 6h12v10H2z"></path><path d="M14 10h4l4 4v2h-8z"></path><circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="18" r="2"></circle>' },
    { id: 'fup', nome: 'FUP', icone: '<path d="M8 3h8v3H8z"></path><path d="M6 4.5H5V21h14V4.5h-1"></path><path d="M8 11h8M8 15h5"></path>' },
    { id: 'posvenda', nome: 'Pós-venda', icone: '<path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"></path>' },
    { id: 'cobranca', nome: 'Cobrança', icone: '<rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="3"></circle>' },
    { id: 'terceirizacao', nome: 'Terceirização', icone: '<path d="M2 21V10l6 4v-4l6 4V6h8v15z"></path>' }
  ];
  const MENU2 = [
    { id: 'dashboard', nome: 'Dashboard', icone: '<path d="M4 20V10M10 20V4M16 20v-7M2 20h20"></path>' },
    { id: 'configuracoes', nome: 'Configurações', icone: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"></path>' }
  ];
  FL.contagens = {};

  function htmlItem(m, atual) {
    const pronta = !!FL.telas[m.id];
    const qtd = FL.contagens[m.id];
    return `<a class="fl-item" href="#${m.id}" ${m.id === atual ? 'aria-current="page"' : ''}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${m.icone}</svg>
      <span class="nome">${esc(m.nome)}</span>${qtd ? `<span class="qtd">${esc(qtd)}</span>` : ''}${pronta ? '' : '<span class="velho" title="Ainda na tela antiga">1.0</span>'}</a>`;
  }
  function desenharMenu(atual) {
    const nav = document.querySelector('.fl-nav');
    nav.querySelector('[data-menu1]').innerHTML = MENU.map((m) => htmlItem(m, atual)).join('');
    nav.querySelector('[data-menu2]').innerHTML = MENU2.map((m) => htmlItem(m, atual)).join('');
  }
  function atualizarUsuarioTopo() {
    const nome = FL.usuario() || 'Quem está usando?';
    const b = document.querySelector('.fl-usuario');
    if (!b) return;
    b.querySelector('.ini').textContent = (FL.usuario() || '?').charAt(0).toUpperCase();
    b.querySelector('b').textContent = nome;
  }
  FL.atualizarContagens = async function () {
    const c = await FL.api('GET', '/api/v2/contagens', null, { silencioso: true });
    if (c) { FL.contagens = c; desenharMenu(FL.estado.tela); }
  };

  function montarEstrutura() {
    const logo = '/static/mubec-logo.svg';
    document.body.innerHTML = `
      <div class="fl-app">
        <nav class="fl-nav" aria-label="Menu principal">
          <a class="fl-marca" href="#pedidos"><img src="${logo}" alt="MUBEC"><span>FLOWLOG</span></a>
          <button type="button" class="fl-hamb" aria-label="Abrir menu" data-hamb>☰</button>
          <div class="fl-menu" data-menu1></div>
          <div class="fl-menu" data-menu2></div>
        </nav>
        <div class="fl-corpo">
          <header class="fl-topo">
            <form class="fl-busca" role="search" onsubmit="return false">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
              <label for="flBuscaTopo" class="oculto">Buscar</label>
              <input id="flBuscaTopo" type="search" placeholder="Buscar pedido, NF ou cliente (com ou sem ponto)">
              <kbd>Ctrl K</kbd>
            </form>
            <button type="button" class="fl-usuario" title="Trocar quem está usando"><span class="ini" aria-hidden="true">?</span><span class="nome"><b>Quem está usando?</b><small>trocar</small></span></button>
          </header>
          <main class="fl-pagina" id="flPagina"></main>
        </div>
      </div>`;
    document.querySelector('[data-hamb]').addEventListener('click', () => document.querySelector('.fl-nav').classList.toggle('aberto'));
    document.querySelector('.fl-usuario').addEventListener('click', () => FL.escolherUsuario(false));
    document.getElementById('flBuscaTopo').addEventListener('input', FL.aplicarBusca);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); const i = document.getElementById('flBuscaTopo'); i.focus(); i.select(); }
    });
    atualizarUsuarioTopo();
  }

  function telaNaoPronta(el, id) {
    const m = MENU.concat(MENU2).find((x) => x.id === id) || { nome: id };
    el.innerHTML = `<div class="fl-cabeca fl-entra"><div class="txt"><h1>${esc(m.nome)}</h1></div></div>
      <div class="fl-secao fl-entra d1" style="max-width:640px"><h2>Enquanto isso, use a tela antiga</h2>
      
      <a class="btn" href="/" style="align-self:flex-start">Abrir o FlowLog 1.0</a></div>`;
  }

  function navegar() {
    const id = (location.hash || '#pedidos').slice(1).split('?')[0] || 'pedidos';
    FL.estado.tela = id;
    desenharMenu(id);
    document.querySelector('.fl-nav').classList.remove('aberto');
    const el = document.getElementById('flPagina');
    const novo = el.cloneNode(false); // tira os eventos da tela anterior
    el.replaceWith(novo);
    const busca = document.getElementById('flBuscaTopo'); if (busca) busca.value = '';
    const tela = FL.telas[id];
    const m = MENU.concat(MENU2).find((x) => x.id === id);
    document.title = 'FlowLog — ' + (m ? m.nome : 'v2');
    window.scrollTo(0, 0);
    if (tela) tela.montar(novo); else telaNaoPronta(novo, id);
  }

  FL.iniciar = function () {
    montarEstrutura();
    window.addEventListener('hashchange', navegar);
    navegar();
    FL.atualizarContagens();
    if (!FL.usuario()) setTimeout(() => FL.escolherUsuario(true), 300);
  };
})();
