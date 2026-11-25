/* FlowLog v2 — FUP: Follow-up · Histórico */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  const SIT = { ok: 'Ok', previsto_atraso: 'Previsto atraso', atraso: 'Atraso' };
  const SELO_SIT = { ok: 'ok', previsto_atraso: '', atraso: 'alerta' };
  const POR_PAGINA = 200;

  const DEFS = [
    { id: 'revisar', titulo: 'PARA REVISAR', ordem: ['Sim', 'Não'], valor: (p) => [p.revisar ? 'Sim' : 'Não'] },
    { id: 'status', titulo: 'STATUS', ordem: ['Bloqueado', 'Aprovado'], valor: (p) => [p.status] },
    { id: 'prazo', titulo: 'PRAZO', ordem: ['Atrasado', 'Vence em breve', 'No prazo', 'Sem data prometida', 'Aguardando cliente'], valor: (p) => [p.prazo.tipo === 'aguardando' ? 'Aguardando cliente' : p.prazo.tipo === 'atraso' ? 'Atrasado' : (p.prazo.tipo === 'sem_data' ? 'Sem data prometida' : (p.revisar || p.prazo.n <= st.janela ? 'Vence em breve' : 'No prazo'))] },
    { id: 'ultimo', titulo: 'ÚLTIMO FUP', ordem: ['Sem FUP', 'Ok', 'Previsto atraso', 'Atraso'], valor: (p) => [p.fup ? SIT[p.fup.situacao] : 'Sem FUP'] },
    { id: 'motivo', titulo: 'MOTIVO DO ÚLTIMO FUP', valor: (p) => (p.fup && p.fup.motivo ? [p.fup.motivo] : []) },
    { id: 'vendedor', titulo: 'VENDEDOR', valor: (p) => [p.vendedor || 'Sem vendedor'] },
    { id: 'tipo', titulo: 'TIPO DE ENTREGA', valor: (p) => [p.tipo || 'Desconhecido'] },
    { id: 'transp', titulo: 'TRANSPORTADORA', valor: (p) => (p.transportadora && p.tipo === 'Transportadora' ? [p.transportadora] : []) },
    { id: 'uf', titulo: 'ESTADO', valor: (p) => [p.uf || 'Sem Estado'] },
    { id: 'cliente', titulo: 'CLIENTE', valor: (p) => [p.cliente || '—'] }
  ];
  const CAMPOS_PERIODO = [['prometida', 'Entrega prometida'], ['emissao', 'Emissão'], ['fup', 'Data do último FUP']];

  let el, st;
  const prazoTxt = (p) => (p.prazo.tipo === 'aguardando' ? 'Aguardando cliente' : p.prazo.tipo === 'atraso' ? (p.prazo.n ? FL.plural(p.prazo.n, 'dia útil', 'dias úteis') + ' de atraso' : 'Venceu hoje')
    : (p.prazo.tipo === 'sem_data' ? 'Sem data prometida' : (p.prazo.n === 0 ? 'Vence hoje' : (p.prazo.n === 1 ? 'Vence amanhã' : 'Vence em ' + p.prazo.n + ' dias úteis'))));
  const prazoForte = (p) => p.prazo.tipo === 'atraso' || (p.prazo.tipo === 'vence' && p.prazo.n <= 1);
  const daAba = () => st.dados;
  function passaPeriodo(p) {
    const per = st.periodo;
    if (!per.de && !per.ate) return true;
    const v = per.campo === 'fup' ? (p.fup && p.fup.data) : p[per.campo];
    return !!v && (!per.de || v >= per.de) && (!per.ate || v <= per.ate);
  }
  const CHAVE_ORDEM = {
    pedido: (p) => p.pedido.padStart(10, '0'), cliente: (p) => FL.semAcento(p.cliente), emissao: (p) => p.emissao || '',
    entrega: (p) => p.nova_data || p.prometida || '9999',
    prazo: (p) => (p.prazo.tipo === 'atraso' ? 'a' + String(9999 - p.prazo.n).padStart(5, '0') : p.prazo.tipo === 'vence' ? 'b' + String(p.prazo.n).padStart(5, '0') : 'c'),
    ultimo: (p) => (p.fup ? p.fup.data : '0000'), vendedor: (p) => FL.semAcento(p.vendedor || 'zzz')
  };
  function filtrados() {
    const l = daAba().filter((p) => FL.passaFiltros(p, DEFS, st.filtros) && passaPeriodo(p) && passaBusca(p));
    if (st.ordem.campo) {
      const k = CHAVE_ORDEM[st.ordem.campo];
      l.sort((a, b) => { const x = k(a), y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * (st.ordem.desc ? -1 : 1); });
    }
    return l;
  }
  function passaBusca(p) {
    if (!st.q) return true;
    return [p.pedido, p.oe, p.cliente, p.vendedor].map((c) => FL.semAcento(c).replace(/[.\s]/g, '')).join('|').includes(st.q);
  }
  function th(campo, titulo, sub, extra) {
    const on = st.ordem.campo === campo;
    return `<th${extra || ''}><button type="button" data-ordenar="${campo}" style="padding:0;border:0;background:transparent;color:#fff;font-weight:700;cursor:pointer;text-align:left" aria-label="Ordenar por ${esc(titulo)}">${esc(titulo)}${on ? (st.ordem.desc ? ' ↓' : ' ↑') : ''}</button>${sub ? `<small>${esc(sub)}</small>` : ''}</th>`;
  }
  function detalheLinha(p, cols) {
    if (!st.abertos[p.pedido]) return '';
    const d = st.detalhes[p.pedido];
    return `<tr class="detalhe"><td colspan="${cols}">${d && d.linha && FL.htmlDetalhePedido ? FL.htmlDetalhePedido(d.linha, d) : '<div class="carregando">Carregando o pedido…</div>'}</td></tr>`;
  }
  const botaoPedido = (p) => `<button type="button" class="fl-link-linha" data-abrir="${esc(p.pedido)}" aria-expanded="${!!st.abertos[p.pedido]}" aria-label="Mostrar o pedido ${esc(p.pedido)}">${FL.icone.seta}${esc(p.pedido)}</button>`;

  function desenhar() {
    const abas = [{ id: 'fu', rotulo: 'Follow-up', qtd: st.dados.length }, { id: 'hist', rotulo: 'Histórico', qtd: st.hist.length }];
    const corpo = st.aba === 'hist' ? htmlHistorico() : htmlFollowup();
    el.innerHTML = `
      <div class="fl-cabeca fl-entra"><div class="txt"><h1>FUP</h1></div>
        <div class="fl-acoes-topo"><button type="button" class="btn sec" data-lote>${FL.icone.enviar} Importar FUP em lote</button></div></div>
      <div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px">
        <div class="fl-barra-abas">${FL.htmlAbas(abas, st.aba, 'Abas do FUP')}${st.aba === 'hist' ? '' : FL.botaoFiltros(Object.assign({}, st.filtros, st.periodo.de || st.periodo.ate ? { _p: [1] } : {}))}</div>
        ${st.aba === 'hist' ? '' : chipsAtivos()}
      </div>
      <div class="fl-entra d2" style="display:flex;flex-direction:column;gap:16px">${corpo}</div>`;
  }

  // ------------------------------------------------------------------
  // Follow-up: todos os pedidos em produção numa tabela editável (como a planilha),
  // com o último FUP para repetir. O rascunho fica guardado no navegador até salvar.
  // ------------------------------------------------------------------
  const chaveRascunho = () => 'fl_fup_dia_' + st.hoje;
  function lerRascunho() { try { return JSON.parse(localStorage.getItem(chaveRascunho()) || '{}'); } catch (e) { return {}; } }
  function gravarRascunho() { try { localStorage.setItem(chaveRascunho(), JSON.stringify(st.rasc)); } catch (e) { /* sem armazenamento */ } }
  const linhasDia = () => filtrados();
  const preenchida = (r) => r && r.sit;
  const ICO_DATA = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="1"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>';

  function htmlFollowup() {
    const ls = linhasDia();
    const vis = ls.slice(0, st.limite);
    const feitos = ls.filter((p) => preenchida(st.rasc[p.pedido])).length;
    const opMot = (sel) => `<option value="">Motivo…</option>${st.motivos.map((m) => `<option ${m === sel ? 'selected' : ''}>${esc(m)}</option>`).join('')}`;
    return `
      <div class="fl-secao" style="flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;padding:14px 18px">
        <span style="font-size:14px"><b data-progresso>${feitos} de ${ls.length}</b> preenchidos</span>
        <span style="display:flex;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn sec" data-baixar-filtrados ${ls.length ? '' : 'disabled'}>${FL.icone.baixar} Baixar planilha</button>
          <button type="button" class="btn sec" data-repetir-todos ${ls.length ? '' : 'disabled'}>Repetir o último FUP nos vazios</button>
          <button type="button" class="btn sec" data-limpar-dia>Limpar</button>
          <button type="button" class="btn" data-salvar-dia>Salvar FUP</button>
        </span></div>
      <div class="fl-tabela-caixa"><table class="fl-tabela fup-dia" style="table-layout:fixed"><colgroup><col style="width:96px"><col style="width:13%"><col style="width:118px"><col style="width:12%"><col style="width:166px"><col style="width:128px"><col><col style="width:96px"></colgroup><thead><tr>
        ${th('pedido', 'Pedido', 'emissão')}${th('cliente', 'Cliente', '')}${th('prazo', 'Entrega', 'prazo')}${th('ultimo', 'Último FUP', '')}<th>Situação</th><th>Motivo</th><th>Observação</th><th class="dir"><span class="oculto">Ações</span></th></tr></thead><tbody>
        ${!st.carregado ? '<tr><td colspan="8" class="vazio">Carregando…</td></tr>' : (vis.length ? vis.map((p) => {
          const r = st.rasc[p.pedido] || {};
          const f = p.fup;
          return `<tr data-linha-dia="${esc(p.pedido)}" class="${preenchida(r) ? 'sel' : ''}">
            <td class="nw">${botaoPedido(p)}<span class="sub" style="padding-left:18px">${FL.dataCurta(p.emissao)}</span></td>
            <td><b style="font-size:13px">${esc(p.cliente || '—')}</b></td>
            <td>${p.nova_data ? 'Nova ' + FL.dataCurta(p.nova_data) : (p.prometida ? FL.dataCurta(p.prometida) : '—')}<span class="sub" style="${prazoForte(p) ? 'color:var(--alerta);font-weight:700' : ''}">${esc(prazoTxt(p))}</span>
              <span class="sub" data-nova-txt style="color:#000;font-weight:700">${r.nova ? '→ ' + FL.dataCurta(r.nova) + (r.quem ? ' (' + esc(r.quem) + ')' : '') : ''}</span></td>
            <td title="${f && f.observacao ? esc(f.observacao) : ''}">${f ? `<span class="selo ${SELO_SIT[f.situacao]}">${esc(SIT[f.situacao])}</span><span class="sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.motivo || '')}</span><span class="sub">${FL.dataCurta(f.data)}</span>` : '<span class="sub">Sem FUP</span>'}</td>
            <td><div class="seg" style="grid-template-columns:auto auto auto" role="group" aria-label="Situação do pedido ${esc(p.pedido)}">
              ${[['ok', 'Ok'], ['previsto_atraso', 'Prev.'], ['atraso', 'Atraso']].map((x) => `<button type="button" style="min-height:32px;font-size:12px;padding:0 7px" data-sit-dia="${x[0]}" aria-pressed="${r.sit === x[0]}" title="${SIT[x[0]]}">${x[1]}</button>`).join('')}</div></td>
            <td><select data-campo="motivo" ${r.sit === 'ok' ? 'disabled' : ''} title="${esc(r.motivo || '')}" style="min-height:34px;width:100%;font-size:13px">${opMot(r.motivo)}</select></td>
            <td><input type="text" data-campo="obs" maxlength="500" value="${esc(r.obs || '')}" placeholder="${r.motivo === 'Outro' ? 'Obrigatória com Outro' : ''}" style="min-height:34px;width:100%;font-size:13px"></td>
            <td class="dir nw"><span style="display:inline-flex;gap:4px">
              <button type="button" class="btn-icone" data-nova-data="${esc(p.pedido)}" title="${r.nova ? 'Nova data: ' + FL.data(r.nova) : 'Nova data'}" aria-label="Nova data do pedido ${esc(p.pedido)}" ${r.nova ? 'style="background:#000;color:#fff;border-color:#000"' : ''}>${ICO_DATA}</button>
              ${f ? `<button type="button" class="btn-icone" data-repetir="${esc(p.pedido)}" title="Repetir o último FUP" aria-label="Repetir o último FUP do pedido ${esc(p.pedido)}">↺</button>` : ''}</span></td></tr>${detalheLinha(p, 8)}`;
        }).join('') : `<tr><td colspan="8" class="vazio">${FL.qtdFiltros(st.filtros) || st.periodo.de || st.periodo.ate ? 'Nenhum pedido com esses filtros. <button type="button" class="link" data-limpar-filtros>Limpar filtros</button>' : 'Nenhum pedido em produção.'}</td></tr>`)}
      </tbody></table></div>
      ${ls.length > st.limite ? `<button type="button" class="btn sec" style="align-self:center" data-mais>Mostrar mais ${Math.min(POR_PAGINA, ls.length - st.limite)}</button>` : ''}`;
  }
  function formNovaData(n) {
    const p = st.dados.find((x) => x.pedido === n);
    const r = st.rasc[n] || {};
    let quem = r.quem || '';
    FL.gaveta({ sobre: 'PEDIDO ' + n + ' · ' + (p.cliente || ''), titulo: 'Nova data', botao: 'Ok', semAutor: true,
      html: `<p style="margin:0;font-size:14px">Prometida ${FL.data(p.prometida)}${p.nova_data ? ' · nova atual ' + FL.data(p.nova_data) : ''}</p>
        <div class="campo"><label for="ndFup">Nova data</label><input id="ndFup" type="date" value="${esc(r.nova || '')}"></div>
        <div class="campo"><span class="rot" id="ndQuemFup">Quem pediu</span><div class="seg" style="grid-template-columns:1fr 1fr" role="group" aria-labelledby="ndQuemFup">${['Cliente', 'MUBEC'].map((q) => `<button type="button" data-quem-fup="${q}" aria-pressed="${q === quem}">${q}</button>`).join('')}</div></div>
        ${r.nova ? '<button type="button" class="link" style="align-self:flex-start" data-tirar-nova>Tirar a nova data</button>' : ''}`,
      aoAbrir: (m) => m.addEventListener('click', (e) => {
        const b = e.target.closest('[data-quem-fup]');
        if (b) { quem = b.dataset.quemFup; m.querySelectorAll('[data-quem-fup]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
        if (e.target.closest('[data-tirar-nova]')) { const x = st.rasc[n] = Object.assign({}, st.rasc[n]); x.nova = ''; x.quem = ''; gravarRascunho(); m.fechar(); desenhar(); }
      }),
      aoSalvar: (m) => {
        const d = m.querySelector('#ndFup').value;
        if (d && !quem) { FL.toast('Diga quem pediu a nova data.', { erro: true }); return false; }
        const x = st.rasc[n] = Object.assign({}, st.rasc[n]); x.nova = d; x.quem = d ? quem : '';
        gravarRascunho(); desenhar();
        return true;
      } });
  }
  function atualizarLinhaDia(n) {
    const tr = el.querySelector(`[data-linha-dia="${CSS.escape(n)}"]`);
    const r = st.rasc[n] || {};
    if (tr) {
      tr.classList.toggle('sel', !!preenchida(r));
      tr.querySelectorAll('[data-sit-dia]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sitDia === r.sit)));
      const m = tr.querySelector('[data-campo="motivo"]'); m.disabled = r.sit === 'ok'; m.value = r.motivo || ''; m.title = r.motivo || '';
      tr.querySelector('[data-campo="obs"]').value = r.obs || '';
      tr.querySelector('[data-campo="obs"]').placeholder = r.motivo === 'Outro' ? 'Obrigatória com Outro' : '';
    }
    const ls = linhasDia();
    const prog = el.querySelector('[data-progresso]');
    if (prog) prog.textContent = `${ls.filter((p) => preenchida(st.rasc[p.pedido])).length} de ${ls.length}`;
    gravarRascunho();
  }
  function repetir(p) {
    if (!p.fup) return;
    const r = st.rasc[p.pedido] = Object.assign({}, st.rasc[p.pedido]);
    r.sit = p.fup.situacao; r.motivo = p.fup.situacao === 'ok' ? '' : (p.fup.motivo || '');
    if (r.motivo === 'Outro') r.obs = r.obs || p.fup.observacao || '';
    atualizarLinhaDia(p.pedido);
  }
  async function salvarDia() {
    const ls = linhasDia().filter((p) => preenchida(st.rasc[p.pedido]) || (st.rasc[p.pedido] || {}).nova);
    if (!ls.length) { FL.toast('Preencha a situação de pelo menos um pedido.', { erro: true }); return; }
    for (const p of ls) {
      const r = st.rasc[p.pedido];
      const foco = (campo) => { const tr = el.querySelector(`[data-linha-dia="${CSS.escape(p.pedido)}"]`); const i = tr && tr.querySelector(`[data-campo="${campo}"]`); if (i) i.focus(); };
      if (!r.sit) { FL.toast(`Pedido ${p.pedido}: escolha a situação.`, { erro: true }); return; }
      if (r.sit !== 'ok' && !r.motivo) { FL.toast(`Pedido ${p.pedido}: escolha o motivo.`, { erro: true }); foco('motivo'); return; }
      if (r.sit !== 'ok' && r.motivo === 'Outro' && !(r.obs || '').trim()) { FL.toast(`Pedido ${p.pedido}: com "Outro", escreva a observação.`, { erro: true }); foco('obs'); return; }
      if (r.nova && !r.quem) { FL.toast(`Pedido ${p.pedido}: diga quem pediu a nova data.`, { erro: true }); return; }
    }
    const itens = ls.map((p) => { const r = st.rasc[p.pedido]; return { pedido: p.pedido, situacao: r.sit, motivo: r.sit === 'ok' ? null : r.motivo, observacao: (r.obs || '').trim() || null }; });
    const r = await FL.api('POST', '/api/v2/fup', { data: st.hoje, itens });
    if (!r) return;
    const antesDatas = [];
    for (const p of ls) {
      const x = st.rasc[p.pedido];
      if (x.nova && x.nova !== p.nova_data) {
        const rn = await FL.api('PUT', `/api/v2/pedidos/${encodeURIComponent(p.pedido)}/nova-data`, { data: x.nova, quem: x.quem, motivo: (x.obs || '').trim() || null });
        if (rn) antesDatas.push([p.pedido, rn.antes]);
      }
    }
    ls.forEach((p) => { delete st.rasc[p.pedido]; });
    gravarRascunho();
    await recarregar();
    FL.toast(`${FL.plural(itens.length, 'FUP registrado', 'FUPs registrados')}${antesDatas.length ? ' · ' + FL.plural(antesDatas.length, 'nova data', 'novas datas') : ''}.`, { desfazer: async () => {
      for (const id of r.ids) await FL.api('DELETE', '/api/v2/fup/' + id);
      for (const [n, antes] of antesDatas) await FL.api('PUT', `/api/v2/pedidos/${encodeURIComponent(n)}/nova-data`, antes);
      await recarregar();
    } });
  }

  function htmlHistorico() {
    const vis = st.hist.slice(0, st.limiteHist);
    return `<div class="fl-tabela-caixa"><table class="fl-tabela"><thead><tr><th>Data</th><th>Pedido · cliente</th><th>Situação</th><th>Motivo · observação</th><th>Registrado por</th></tr></thead><tbody>
      ${vis.length ? vis.map((f) => `<tr><td class="nw">${FL.data(f.data)}</td><td><b>${esc(f.pedido)}</b><span class="sub">${esc(f.cliente || '')}</span></td>
        <td><span class="selo ${SELO_SIT[f.situacao]}">${esc(SIT[f.situacao] || f.situacao)}</span></td><td>${esc(f.motivo || '—')}<span class="sub">${esc(f.observacao || '')}</span></td>
        <td>${esc(f.por || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="vazio">Nenhum FUP registrado.</td></tr>'}
      </tbody></table></div>
      ${st.hist.length > st.limiteHist ? '<button type="button" class="btn sec" style="align-self:center" data-mais-hist>Mostrar mais</button>' : ''}`;
  }

  async function baixarFiltrados() {
    const lista = filtrados();
    if (!lista.length) return;
    const r = await FL.api('POST', '/api/v2/pedidos/exportar', { pedidos: lista.map((p) => p.pedido), nome: 'fup' }, { blob: true });
    if (r) FL.baixarArquivo(r.blob, r.nome || 'flowlog_fup.xlsx');
  }

  async function lote() {
    const imp = (await FL.api('GET', '/api/v2/importacoes', null, { silencioso: true })) || {};
    const ult = (imp.fup || [])[0];
    const g = FL.gaveta({ sobre: 'FUP', titulo: 'Importar FUP em lote', semAutor: false, cancelar: 'Fechar',
      html: `<ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:12px;font-size:14px;line-height:1.45">
          <li><b>Baixe a planilha</b> dos pedidos filtrados na tela (${filtrados().length}).
            <div style="margin-top:8px"><button type="button" class="btn sec" data-baixar="filtrados" ${filtrados().length ? '' : 'disabled'}>${FL.icone.baixar} Baixar planilha</button></div></li>
          <li><b>Preencha</b> as colunas <b>Situação FUP</b> (Ok, Previsto atraso ou Atraso), <b>FUP</b> (o texto) e, se mudou, <b>Nova Data de Entrega</b>. Célula vazia não mexe em nada.</li>
          <li><b>Envie</b> a planilha preenchida.
            <div style="margin-top:8px"><button type="button" class="btn" data-enviar>${FL.icone.enviar} Enviar planilha preenchida</button><input type="file" id="fupArq" accept=".xlsx,.xls" hidden></div></li></ol>
        <div data-resultado>${ult ? `<div class="cartao-mini"><span class="rotulo-secao">ÚLTIMA IMPORTAÇÃO</span><b style="font-size:13px">${FL.dataHora(ult.quando)} · ${esc(ult.por || '—')}</b><span style="font-size:14px">${esc(ult.resumo || '')}</span>${(ult.avisos || []).map((a) => `<span style="font-size:12px;color:var(--alerta);font-weight:700">${esc(a)}</span>`).join('')}</div>` : ''}</div>`,
      aoAbrir: (gv) => {
        gv.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-baixar]');
          if (b) {
            baixarFiltrados();
          }
          if (e.target.closest('[data-enviar]')) gv.querySelector('#fupArq').click();
        });
        gv.querySelector('#fupArq').addEventListener('change', async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const fd = new FormData(); fd.append('file', f);
          const r = await FL.api('POST', '/api/importar-fup-lote', null, { form: fd });
          e.target.value = '';
          if (!r) return;
          gv.querySelector('[data-resultado]').innerHTML = `<div class="cartao-mini" style="border-left:4px solid var(--verde)"><span class="rotulo-secao">RESULTADO</span>
            <b>${FL.plural(r.fups_criados, 'FUP registrado', 'FUPs registrados')} · ${FL.plural(r.datas_atualizadas, 'data mudada', 'datas mudadas')}</b>
            ${r.pedidos_nao_encontrados.length ? `<p class="aviso">Pedidos não encontrados (linhas não importadas): ${esc(r.pedidos_nao_encontrados.join(', '))}</p>` : '<span style="font-size:14px;color:var(--sucesso);font-weight:700">Todas as linhas preenchidas foram importadas.</span>'}</div>`;
          await recarregar();
        });
      } });
    return g;
  }

  async function carregar() {
    const r = await FL.api('GET', '/api/v2/fup');
    if (r) { st.dados = r.pedidos; st.hist = r.historico; st.hoje = r.hoje; st.janela = r.janela; }
    if (!st.motivos.length) st.motivos = (await FL.api('GET', '/api/v2/listas/motivos/ativas', null, { silencioso: true })) || [];
    st.rasc = lerRascunho();
    st.carregado = true;
  }
  async function recarregar() { await carregar(); desenhar(); FL.atualizarContagens(); }

  function abrirFiltros() {
    const per = Object.assign({}, st.periodo);
    const extra = `<section style="display:flex;flex-direction:column;gap:10px;padding:16px 0;border-bottom:1px solid var(--c3)">
      <h3 style="margin:0;font-size:12px;letter-spacing:.06em">PERÍODO</h3>
      <div class="campo"><label for="fuCampo">Filtrar pela data de</label><select id="fuCampo">${CAMPOS_PERIODO.map((c) => `<option value="${c[0]}" ${c[0] === per.campo ? 'selected' : ''}>${c[1]}</option>`).join('')}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="campo"><label for="fuDe">De</label><input id="fuDe" type="date" value="${esc(per.de || '')}"></div>
      <div class="campo"><label for="fuAte">Até</label><input id="fuAte" type="date" value="${esc(per.ate || '')}"></div></div></section>`;
    const g = FL.gavetaFiltros({ sobre: 'FUP', defs: DEFS, itens: daAba(), marcados: st.filtros, nomeItens: 'pedidos', extraHtml: extra, aoMudar: (m) => { st.filtros = m; desenhar(); } });
    g.addEventListener('change', (e) => {
      if (!['fuCampo', 'fuDe', 'fuAte'].includes(e.target.id)) return;
      st.periodo = { campo: g.querySelector('#fuCampo').value, de: g.querySelector('#fuDe').value, ate: g.querySelector('#fuAte').value };
      desenhar();
    });
  }
  function chipsAtivos() {
    let h = FL.htmlChipsAtivos(DEFS, st.filtros);
    if (st.periodo.de || st.periodo.ate) {
      const nome = CAMPOS_PERIODO.find((c) => c[0] === st.periodo.campo)[1];
      const chip = `<button type="button" class="chip" style="background:#000;color:#fff;border-color:#000;min-height:32px" data-tirar-periodo aria-label="Remover filtro de período"><span style="color:var(--verde);font-weight:700">Período:</span> ${esc(nome)} ${st.periodo.de ? 'de ' + FL.dataCurta(st.periodo.de) : ''} ${st.periodo.ate ? 'até ' + FL.dataCurta(st.periodo.ate) : ''} ${FL.icone.x}</button>`;
      h = h ? h.replace('<button type="button" class="link" data-limpar-filtros>', chip + '<button type="button" class="link" data-limpar-filtros>') : `<div class="chips" style="align-items:center"><span style="font-size:13px;font-weight:700">Filtrando por:</span>${chip}<button type="button" class="link" data-limpar-filtros>Limpar tudo</button></div>`;
    }
    return h;
  }

  function ligarEventos() {
    el.addEventListener('click', (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; desenhar(); return; }
      if ('lote' in t.dataset) { lote(); return; }
      if (t.dataset.sitDia) { const n = t.closest('[data-linha-dia]').dataset.linhaDia; const r = st.rasc[n] = Object.assign({}, st.rasc[n]); r.sit = t.dataset.sitDia; if (r.sit === 'ok') r.motivo = ''; else if (!r.motivo) { const p = st.dados.find((x) => x.pedido === n); if (p && p.fup && p.fup.motivo) r.motivo = p.fup.motivo; } atualizarLinhaDia(n); return; }
      if (t.dataset.repetir) { repetir(st.dados.find((p) => p.pedido === t.dataset.repetir)); return; }
      if ('repetirTodos' in t.dataset) { linhasDia().filter((p) => !preenchida(st.rasc[p.pedido])).forEach(repetir); return; }
      if ('limparDia' in t.dataset) { FL.modal({ titulo: 'Limpar o que foi preenchido?', botao: 'Limpar', html: '<p>Apaga o que foi preenchido e ainda não foi salvo.</p>', aoConfirmar: () => { st.rasc = {}; gravarRascunho(); desenhar(); return true; } }); return; }
      if ('salvarDia' in t.dataset) { salvarDia(); return; }
      if (t.dataset.novaData) { formNovaData(t.dataset.novaData); return; }
      if ('baixarFiltrados' in t.dataset) { baixarFiltrados(); return; }
      if ('mais' in t.dataset) { st.limite += POR_PAGINA; desenhar(); return; }
      if ('maisHist' in t.dataset) { st.limiteHist += POR_PAGINA; desenhar(); return; }
      if ('abrirFiltros' in t.dataset) { abrirFiltros(); return; }
      if (t.dataset.ordenar) { const c = t.dataset.ordenar; st.ordem = st.ordem.campo === c ? { campo: c, desc: !st.ordem.desc } : { campo: c, desc: c === 'ultimo' }; desenhar(); return; }
      if (t.dataset.abrir) {
        const n = t.dataset.abrir; st.abertos[n] = !st.abertos[n]; desenhar();
        if (st.abertos[n] && !st.detalhes[n]) FL.api('GET', '/api/v2/pedidos/' + encodeURIComponent(n)).then((d) => { if (d) { st.detalhes[n] = d; desenhar(); } });
        return;
      }
      if ('tirarPeriodo' in t.dataset) { st.periodo = { campo: st.periodo.campo }; desenhar(); return; }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); desenhar(); return; }
      if ('limparFiltros' in t.dataset) { st.filtros = {}; st.periodo = { campo: 'prometida' }; desenhar(); }
    });
    const campoDia = (e) => {
      const c = e.target.dataset.campo; const tr = e.target.closest('[data-linha-dia]');
      if (!c || !tr) return false;
      const n = tr.dataset.linhaDia; const r = st.rasc[n] = Object.assign({}, st.rasc[n]);
      r[c] = e.target.value;
      if (c === 'motivo' && r.motivo && !r.sit) r.sit = 'atraso';
      atualizarLinhaDia(n);
      return true;
    };
    el.addEventListener('input', (e) => { if (e.target.dataset.campo === 'obs') campoDia(e); });
    el.addEventListener('keydown', (e) => {
      // Enter na observação: vai para a observação da próxima linha (como na planilha)
      if (e.key !== 'Enter' || !e.target.closest('[data-linha-dia]') || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      const tr = e.target.closest('[data-linha-dia]').nextElementSibling;
      const i = tr && tr.querySelector(`[data-campo="${e.target.dataset.campo || 'obs'}"]`);
      if (i) i.focus();
    });
    el.addEventListener('change', (e) => {
      if (e.target.dataset.campo) { campoDia(e); return; }
    });
  }

  FL.telas.fup = {
    montar: async function (alvo) {
      el = alvo;
      st = { dados: [], hist: [], carregado: false, aba: 'fu', filtros: {}, limite: POR_PAGINA, limiteHist: POR_PAGINA, hoje: FL.hojeISO(), janela: 2,
        motivos: [], rasc: {}, periodo: { campo: 'prometida' }, ordem: { campo: null, desc: false }, abertos: {}, detalhes: {}, q: '' };
      ligarEventos(); desenhar(); await carregar(); desenhar();
    },
    buscar: function (q) {
      if (!st) return;
      st.q = q; desenhar();
      if (st.aba === 'hist') el.querySelectorAll('.fl-tabela > tbody > tr').forEach((tr) => { tr.style.display = !q || FL.semAcento(tr.textContent).replace(/[.\s]/g, '').includes(q) ? '' : 'none'; });
    }
  };
})();
