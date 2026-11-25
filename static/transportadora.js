/* FlowLog v2 — Transportadora (uma linha por NF de pedido Transportadora) */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  const NOME = { chamar: 'Chamar coleta', chamada: 'Coleta chamada', coletado: 'Coletado', encerrado: 'Encerrado' };
  const ABA_DA_ETAPA = { chamar: 'pend', chamada: 'pend', coletado: 'col', encerrado: 'hist' };

  const DEFS = [
    { id: 'vendedor', titulo: 'VENDEDOR', valor: (d) => [d.vendedor || 'Sem vendedor'] },
    { id: 'etapa', titulo: 'ETAPA', ordem: ['Chamar coleta', 'Coleta chamada', 'Coletado', 'Encerrado'], valor: (d) => [NOME[d.etapa]] },
    { id: 'transp', titulo: 'TRANSPORTADORA', valor: (d) => [d.transportadora || 'Não informada'] },
    { id: 'quem', titulo: 'QUEM CHAMOU', valor: (d) => [d.chamada ? (d.chamada.quem || 'Não informado') : 'Ainda não chamada'] },
    { id: 'codigo', titulo: 'CÓDIGO DE COLETA', ordem: ['Com código', 'Sem código'], valor: (d) => (d.chamada ? [d.chamada.codigo ? 'Com código' : 'Sem código'] : []) },
    { id: 'alerta', titulo: 'ALERTA', ordem: ['Atrasado para chamar'], valor: (d) => (d.alerta ? ['Atrasado para chamar'] : []) },
    { id: 'cliente', titulo: 'CLIENTE', valor: (d) => [d.cliente || '—'] }
  ];

  let el, st;
  const chave = (d) => d.pedido + '|' + (d.nf || '');
  const nfTxt = (d) => (d.nf ? 'NF ' + d.nf : 'sem NF legível');
  const daAba = () => st.dados.filter((d) => st.aba === 'todos' || ABA_DA_ETAPA[d.etapa] === st.aba);
  const filtrados = () => daAba().filter((d) => FL.passaFiltros(d, DEFS, st.filtros));

  function dataEtapa(d) {
    if (d.etapa === 'encerrado') return d.canhoto_em ? 'Canhoto ' + FL.dataCurta(d.canhoto_em) : 'Canhoto recebido';
    if (d.etapa === 'coletado') return 'Coletado ' + FL.dataCurta(d.coleta.data);
    if (d.etapa === 'chamada') return d.chamada.previsao ? 'Previsão ' + FL.dataCurta(d.chamada.previsao) : 'Chamada ' + FL.dataCurta(d.chamada.data);
    return d.dias ? 'Faturado há ' + FL.plural(d.dias, 'dia útil', 'dias úteis') : 'Faturado hoje';
  }

  function desenhar() {
    const conta = (aba) => st.dados.filter((d) => ABA_DA_ETAPA[d.etapa] === aba).length;
    const abas = [{ id: 'todos', rotulo: 'Todos', qtd: st.dados.length }, { id: 'pend', rotulo: 'Pendentes', qtd: conta('pend'), alerta: true },
      { id: 'col', rotulo: 'Coletados', qtd: conta('col') }, { id: 'hist', rotulo: 'Histórico', qtd: conta('hist') }];
    const lista = filtrados();
    const sel = lista.find((d) => chave(d) === st.sel) || lista[0] || null;
    if (sel) st.sel = chave(sel);
    el.innerHTML = `
      <div class="fl-cabeca fl-entra"><div class="txt"><h1>Transportadora</h1></div></div>
      <div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px">
        <div class="fl-barra-abas">${FL.htmlAbas(abas, st.aba, 'Abas da transportadora')}${FL.botaoFiltros(st.filtros)}</div>
        ${FL.htmlChipsAtivos(DEFS, st.filtros)}
      </div>
      <div class="fl-tab-painel fl-entra d2">
        <div class="fl-tabela-caixa alta"><table class="fl-tabela"><thead><tr>
          <th>Pedido<small>NF</small></th><th>Cliente<small>transportadora</small></th><th>Faturado</th><th>Etapa<small>data</small></th><th>Coleta<small>código · quem chamou</small></th></tr></thead><tbody>
          ${!st.carregado ? '<tr><td colspan="5" class="vazio">Carregando…</td></tr>' : (lista.length ? lista.slice(0, FL.textoBusca() ? lista.length : st.limite).map((d) => linha(d, sel)).join('') : `<tr><td colspan="5" class="vazio">${FL.qtdFiltros(st.filtros) ? 'Nada com esses filtros. <button type="button" class="link" data-limpar-filtros>Limpar filtros</button>' : (st.aba === 'pend' ? 'Nenhuma coleta pendente.' : 'Nada por aqui.')}</td></tr>`)}
        </tbody></table></div>
        ${painel(sel)}
      </div>
      ${!FL.textoBusca() && lista.length > st.limite ? `<button type="button" class="btn sec" style="align-self:center" data-mais>Mostrar mais ${Math.min(150, lista.length - st.limite)} (de ${FL.num(lista.length - st.limite)} restantes)</button>` : ''}`;
    filtrarPelaBusca();
  }
  // Busca do topo: filtra as linhas desenhadas (com busca, todas as linhas são desenhadas)
  function filtrarPelaBusca() {
    const q = FL.textoBusca();
    el.querySelectorAll('.fl-tabela > tbody > tr').forEach((tr) => {
      if (tr.querySelector('td.vazio')) return;
      tr.style.display = !q || FL.semAcento(tr.textContent).replace(/[.\s]/g, '').includes(q) ? '' : 'none';
    });
  }

  function linha(d, sel) {
    const selo = { chamar: 'alerta', chamada: '', coletado: 'ok', encerrado: 'preto' }[d.etapa];
    return `<tr class="${sel && chave(sel) === chave(d) ? 'sel' : ''}">
      <td><button type="button" class="fl-link-linha" data-sel="${esc(chave(d))}" aria-label="Ver a coleta do pedido ${esc(d.pedido)} ${esc(nfTxt(d))}">${esc(d.pedido)}</button><span class="sub">${esc(nfTxt(d))}</span></td>
      <td><b>${esc(d.cliente || '—')}</b><span class="sub">${esc(d.transportadora || 'Transportadora não informada')}</span></td>
      <td class="nw">${FL.dataCurta(d.faturamento)}</td>
      <td><span class="selo ${selo}">${esc(NOME[d.etapa])}</span><span class="sub" style="margin-top:4px;${d.alerta ? 'color:var(--alerta);font-weight:700' : ''}">${esc(dataEtapa(d))}</span></td>
      <td>${d.chamada ? esc(d.chamada.codigo || 'Sem código') : '—'}<span class="sub">${d.chamada ? 'Chamou: ' + esc(d.chamada.quem || '—') : 'Ainda não chamada'}</span></td></tr>`;
  }

  function painel(d) {
    if (!d) return `<aside class="fl-painel"><div class="cab"><span class="sobre">TRANSPORTADORA</span><h2>Nada selecionado</h2></div><div class="meio"><p style="margin:0;color:var(--texto2)">Nenhuma nota selecionada.</p></div></aside>`;
    const est = { chamar: 1, chamada: 2, coletado: 4, encerrado: 5 }[d.etapa];
    const ch = d.chamada, co = d.coleta;
    const passos = [
      ['Faturado', FL.dataCurta(d.faturamento), nfTxt(d)],
      ['Coleta chamada', ch ? FL.dataCurta(ch.data) + (ch.hora ? ' · ' + ch.hora : '') : 'Ainda não chamada', ch ? 'Quem chamou: ' + (ch.quem || '—') + (ch.por ? ' · registrado por ' + ch.por : '') + (ch.codigo ? ' · código ' + ch.codigo : ' · sem código de coleta') : 'Ligar ou mandar e-mail para a ' + (d.transportadora || 'transportadora')],
      ['Previsão de retirada', ch && ch.previsao ? FL.dataCurta(ch.previsao) : 'Sem previsão', 'Informada pela transportadora'],
      ['Coletado', co ? FL.dataCurta(co.data) : 'Aguardando', co ? (co.obs || 'Marcado') + (co.por ? ' · registrado por ' + co.por : '') : 'Marcar quando a transportadora retirar'],
      ['Canhoto recebido', d.etapa === 'encerrado' ? (d.canhoto_em ? FL.dataCurta(d.canhoto_em) : 'Recebido') : 'Aguardando', 'Assinado pela transportadora na coleta · encerra o pedido']
    ];
    const tempo = `<ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column">${passos.map((p, i) => {
      const feito = i < est, atual = i === est;
      return `<li style="position:relative;display:flex;flex-direction:column;gap:2px;padding:0 0 16px 30px">
        <span aria-hidden="true" style="position:absolute;left:0;top:2px;width:16px;height:16px;box-sizing:border-box;border-radius:50%;border:2px solid ${feito || atual ? '#000' : 'var(--c3)'};background:${feito ? '#000' : (atual ? 'var(--verde)' : '#fff')}"></span>
        ${i < passos.length - 1 ? `<span aria-hidden="true" style="position:absolute;left:7px;top:20px;bottom:-2px;width:2px;background:${feito ? '#000' : 'var(--c3)'}"></span>` : ''}
        <b style="font-size:14px;color:${feito || atual ? '#000' : 'var(--texto2)'}">${esc(p[0])}${atual ? ' <span class="selo ok" style="margin-left:4px">agora</span>' : ''}</b>
        <span style="font-size:13px">${esc(p[1])}</span><span style="font-size:12px;color:var(--texto2)">${esc(p[2])}</span></li>`;
    }).join('')}</ol>`;
    const desfaziveis = d.registros.filter((r) => r.pode_desfazer);
    return `<aside class="fl-painel" aria-labelledby="trTit"><div class="cab"><span class="sobre">PEDIDO ${esc(d.pedido)} · ${esc(nfTxt(d).toUpperCase())}</span>
        <h2 id="trTit">${esc(d.cliente || '—')}</h2><span style="font-size:14px">${esc(d.transportadora || 'Transportadora não informada')} · faturado ${FL.dataCurta(d.faturamento)}</span>
        <span style="font-size:14px">Vendedor: ${esc(d.vendedor || 'não informado')}</span>${(d.fotos || []).length ? `<span>${FL.verCanhoto(d.fotos)}</span>` : ''}</div>
      <div class="meio">
        ${d.alerta ? `<p class="aviso">Faturado há ${FL.plural(d.dias, 'dia útil', 'dias úteis')} e a coleta ainda não foi chamada.</p>` : ''}
        ${ch && ch.obs ? `<p class="aviso info">${esc(ch.obs)}</p>` : ''}
        ${tempo}
        ${desfaziveis.map((r) => `<button type="button" class="link" style="align-self:flex-start;font-size:13px" data-desfazer="${r.id}">Desfazer o registro de ${r.evento === 'coletado' ? 'coletado' : 'coleta chamada'} (${FL.dataCurta(r.data)})</button>`).join('')}
      </div>
      <div class="pe">
        ${d.etapa === 'chamar' ? '<button type="button" class="btn grande" data-acao="chamada">Registrar coleta chamada</button>' : ''}
        ${d.etapa === 'chamada' ? '<button type="button" class="btn grande" data-acao="coletado">Marcar como coletado</button><button type="button" class="link" style="align-self:flex-start;font-size:13px" data-acao="chamada">Registrar outra chamada</button>' : ''}
        <span style="font-size:12px;color:var(--texto2);line-height:1.4">${d.etapa === 'encerrado' ? 'Encerrado: canhoto recebido.' : 'O pedido só encerra quando o canhoto chegar (planilha ou foto no Drive).'}</span>
      </div></aside>`;
  }

  async function formChamada(d) {
    const quems = (await FL.api('GET', '/api/v2/listas/quemchama/ativas', null, { silencioso: true })) || ['Rian', 'Elizeu', 'Outro'];
    const eu = FL.usuario();
    let quem = quems.includes(eu) ? eu : '';
    const agora = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(11, 16);
    FL.gaveta({ sobre: `PEDIDO ${d.pedido} · ${nfTxt(d).toUpperCase()}`, titulo: 'Registrar coleta chamada', sub: (d.cliente || '') + ' · ' + (d.transportadora || 'transportadora não informada'), botao: 'Registrar',
      html: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="campo"><label for="chData">Data</label><input id="chData" type="date" value="${st.hoje}" max="${st.hoje}"></div>
          <div class="campo"><label for="chHora">Hora</label><input id="chHora" type="time" value="${agora}"></div></div>
        <div class="campo"><span class="rot" id="chQuemRot">Quem chamou <span style="font-weight:400">(obrigatório)</span></span>
          <div class="chips" role="group" aria-labelledby="chQuemRot">${quems.map((q) => `<button type="button" class="chip" data-quem="${esc(q)}" aria-pressed="${q === quem}">${esc(q)}</button>`).join('')}</div></div>
        <div class="campo"><label for="chCod">Código de coleta <span style="font-weight:400">(opcional · nem toda transportadora dá)</span></label><input id="chCod" type="text" maxlength="40"></div>
        <div class="campo"><label for="chPrev">Previsão de retirada <span style="font-weight:400">(opcional)</span></label><input id="chPrev" type="date" min="${st.hoje}"></div>
        <div class="campo"><label for="chObs">Observação <span style="font-weight:400">(opcional)</span></label><textarea id="chObs" rows="2" maxlength="500"></textarea></div>`,
      aoAbrir: (g) => g.addEventListener('click', (e) => { const b = e.target.closest('[data-quem]'); if (!b) return; quem = b.dataset.quem; g.querySelectorAll('[data-quem]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }),
      aoSalvar: async (g) => {
        if (!quem) { g.erro('Diga quem chamou a coleta.'); return false; }
        const corpo = { pedido: d.pedido, nf: d.nf, evento: 'chamada', data: g.querySelector('#chData').value || st.hoje, hora: g.querySelector('#chHora').value || null,
          quem, codigo: g.querySelector('#chCod').value, previsao: g.querySelector('#chPrev').value || null, obs: g.querySelector('#chObs').value };
        return salvar(corpo, 'Coleta chamada registrada.');
      } });
  }

  function formColetado(d) {
    FL.gaveta({ sobre: `PEDIDO ${d.pedido} · ${nfTxt(d).toUpperCase()}`, titulo: 'Marcar como coletado', botao: 'Marcar como coletado',
      html: `<div class="campo"><label for="coData">Data da coleta</label><input id="coData" type="date" value="${st.hoje}" max="${st.hoje}"></div>
        <div class="campo"><label for="coObs">Observação <span style="font-weight:400">(opcional)</span></label><textarea id="coObs" rows="2" maxlength="500" placeholder="Ex.: conferido no controle do Elizeu"></textarea></div>`,
      aoSalvar: async (g) => salvar({ pedido: d.pedido, nf: d.nf, evento: 'coletado', data: g.querySelector('#coData').value || st.hoje, obs: g.querySelector('#coObs').value }, 'Marcado como coletado.') });
  }

  async function salvar(corpo, msg) {
    const r = await FL.api('POST', '/api/v2/transportadora/registros', corpo);
    if (!r) return false;
    await recarregar();
    FL.toast(msg, { desfazer: async () => { if (await FL.api('DELETE', '/api/v2/transportadora/registros/' + r.id)) recarregar(); } });
    return true;
  }

  async function carregar() {
    const r = await FL.api('GET', '/api/v2/transportadora');
    if (r) { st.dados = r.itens; st.hoje = r.hoje; }
    st.carregado = true;
  }
  async function recarregar() { await carregar(); desenhar(); FL.atualizarContagens(); }

  function ligarEventos() {
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; st.limite = 150; desenhar(); return; }
      if ('mais' in t.dataset) { st.limite += 150; desenhar(); return; }
      if (t.dataset.sel) { st.sel = t.dataset.sel; desenhar(); return; }
      const d = st.dados.find((x) => chave(x) === st.sel);
      if (t.dataset.acao === 'chamada' && d) { formChamada(d); return; }
      if (t.dataset.acao === 'coletado' && d) { formColetado(d); return; }
      if (t.dataset.desfazer) { if (await FL.api('DELETE', '/api/v2/transportadora/registros/' + t.dataset.desfazer)) { await recarregar(); FL.toast('Registro desfeito.'); } return; }
      if ('abrirFiltros' in t.dataset) { FL.gavetaFiltros({ sobre: 'TRANSPORTADORA', defs: DEFS, itens: daAba(), marcados: st.filtros, nomeItens: 'notas', aoMudar: (m) => { st.filtros = m; desenhar(); } }); return; }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); desenhar(); return; }
      if ('limparFiltros' in t.dataset) { st.filtros = {}; desenhar(); }
    });
  }

  FL.telas.transportadora = {
    montar: async function (alvo) {
      el = alvo;
      st = { dados: [], carregado: false, aba: 'todos', filtros: {}, sel: null, hoje: FL.hojeISO(), limite: 150 };
      ligarEventos(); desenhar(); await carregar(); desenhar();
    },
    // com busca, desenha todas as linhas (sem o limite de 150) e filtra
    buscar: function () { if (st && st.carregado) desenhar(); }
  };
})();
