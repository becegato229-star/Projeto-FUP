/* FlowLog v2 — Avisos de canhoto (uma linha por NF sem canhoto) */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  const NOME_SIT = { atencao: 'Precisa de atenção', acomp: 'Em acompanhamento', hist: 'Canhoto recebido' };

  // Atalhos "amanhã / sexta / segunda" para verificar de novo
  FL.atalhosVerificar = function (hoje) {
    const d = new Date(hoje + 'T12:00:00');
    const iso = (x) => x.toISOString().slice(0, 10);
    const amanha = new Date(d); amanha.setDate(d.getDate() + 1);
    const sexta = new Date(d); sexta.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
    const segunda = new Date(d); segunda.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7));
    const lista = [['Amanhã', amanha], ['Sexta', sexta], ['Segunda', segunda]].map(([n, x]) => [n + ' · ' + FL.dataCurta(iso(x)), iso(x)]);
    return lista.filter((a, i) => lista.findIndex((b) => b[1] === a[1]) === i);
  };

  const DEFS = [
    { id: 'sit', titulo: 'SITUAÇÃO', ordem: ['Precisa de atenção', 'Em acompanhamento', 'Canhoto recebido'], valor: (a) => [NOME_SIT[a.situacao]] },
    { id: 'tipo', titulo: 'TIPO DE ENTREGA', ordem: ['Entrega', 'Transportadora', 'Retira'], valor: (a) => [a.tipo] },
    { id: 'vendedor', titulo: 'VENDEDOR', valor: (a) => [a.vendedor || 'Sem vendedor'] },
    { id: 'dias', titulo: 'DIAS ÚTEIS SEM CANHOTO', ordem: ['Até o prazo', '6 a 9', '10 ou mais'], valor: (a) => (a.canhoto ? [] : [a.dias >= 10 ? '10 ou mais' : (a.dias >= 6 ? '6 a 9' : 'Até o prazo')]) },
    { id: 'transp', titulo: 'TRANSPORTADORA', valor: (a) => (a.transportadora && a.tipo === 'Transportadora' ? [a.transportadora] : []) },
    { id: 'parcial', titulo: 'ENTREGA PARCIAL', ordem: ['Só NFs de entrega parcial'], valor: (a) => (a.parcial ? ['Só NFs de entrega parcial'] : []) },
    { id: 'cliente', titulo: 'CLIENTE', valor: (a) => [a.cliente || '—'] }
  ];

  let el, st;
  const chave = (a) => a.pedido + '|' + (a.nf || '');
  const nfTxt = (a) => (a.nf ? 'NF ' + a.nf : 'sem NF legível');
  const daAba = () => st.dados.filter((a) => st.aba === 'todos' || a.situacao === st.aba);
  const filtrados = () => daAba().filter((a) => FL.passaFiltros(a, DEFS, st.filtros));

  function desenhar() {
    const abas = [
      { id: 'todos', rotulo: 'Todos', qtd: st.dados.length },
      { id: 'atencao', rotulo: 'Precisam de atenção', qtd: st.dados.filter((a) => a.situacao === 'atencao').length, alerta: true },
      { id: 'acomp', rotulo: 'Em acompanhamento', qtd: st.dados.filter((a) => a.situacao === 'acomp').length },
      { id: 'hist', rotulo: 'Histórico', qtd: st.dados.filter((a) => a.situacao === 'hist').length }
    ];
    const lista = filtrados();
    const sel = lista.find((a) => chave(a) === st.sel) || lista[0] || null;
    if (sel) st.sel = chave(sel);
    el.innerHTML = `
      <div class="fl-cabeca fl-entra"><div class="txt"><h1>Avisos de canhoto</h1></div></div>
      <div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px">
        <div class="fl-barra-abas">${FL.htmlAbas(abas, st.aba, 'Abas dos avisos')}${FL.botaoFiltros(st.filtros)}</div>
        ${FL.htmlChipsAtivos(DEFS, st.filtros)}
      </div>
      <div class="fl-tab-painel fl-entra d2">
        <div class="fl-tabela-caixa alta"><table class="fl-tabela"><thead><tr>
          <th>Pedido<small>NF sem canhoto</small></th><th>Cliente<small>tipo de entrega</small></th><th>Faturado<small>dias úteis sem canhoto</small></th>
          <th>Situação<small>próxima verificação</small></th><th>Último acompanhamento</th></tr></thead><tbody>
          ${!st.carregado ? '<tr><td colspan="5" class="vazio">Carregando…</td></tr>' : (lista.length ? lista.map((a) => linha(a, sel)).join('') : `<tr><td colspan="5" class="vazio">${FL.qtdFiltros(st.filtros) ? 'Nenhum aviso com esses filtros. <button type="button" class="link" data-limpar-filtros>Limpar filtros</button>' : (st.aba === 'atencao' ? 'Nenhum aviso precisando de atenção. Tudo em dia.' : 'Nada por aqui.')}</td></tr>`)}
        </tbody></table></div>
        ${painel(sel)}
      </div>`;
    FL.aplicarBusca();
  }

  function proximaTxt(a) {
    const ult = a.registros[a.registros.length - 1];
    if (a.situacao === 'hist') return a.canhoto ? 'Canhoto recebido' : 'Pedido cancelado';
    if (a.situacao === 'acomp') return ult.proxima ? 'Verificar ' + FL.dataCurta(ult.proxima) : 'Tratado (sem data para verificar)';
    if (ult && ult.proxima) return 'Venceu ' + FL.dataCurta(ult.proxima);
    return 'Sem acompanhamento';
  }

  function linha(a, sel) {
    const ult = a.registros[a.registros.length - 1];
    const selo = { atencao: 'alerta', acomp: '', hist: 'ok' }[a.situacao];
    return `<tr class="${sel && chave(sel) === chave(a) ? 'sel' : ''}">
      <td><button type="button" class="fl-link-linha" data-sel="${esc(chave(a))}" aria-label="Ver acompanhamentos do pedido ${esc(a.pedido)} ${esc(nfTxt(a))}">${esc(a.pedido)}</button><span class="sub">${esc(nfTxt(a))}${a.parcial ? ' · parcial' : ''}</span></td>
      <td><b>${esc(a.cliente || '—')}</b><span class="sub">${esc(a.tipo)}${a.tipo === 'Transportadora' && a.transportadora ? ' · ' + esc(a.transportadora) : ''}</span></td>
      <td class="nw">${FL.dataCurta(a.faturamento)}<span class="sub" style="${a.situacao === 'atencao' ? 'color:var(--alerta);font-weight:700' : ''}">${a.canhoto ? 'Canhoto recebido' : FL.plural(a.dias, 'dia útil', 'dias úteis')}</span></td>
      <td><span class="selo ${selo}">${esc(NOME_SIT[a.situacao] === 'Canhoto recebido' && !a.canhoto ? 'Histórico' : NOME_SIT[a.situacao])}</span><span class="sub" style="margin-top:4px">${esc(proximaTxt(a))}</span></td>
      <td style="max-width:280px"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ult ? ult.texto : '—')}</span><span class="sub">${ult ? FL.dataCurta(ult.data) + (ult.por ? ' · ' + esc(ult.por) : '') : ''}</span></td></tr>`;
  }

  function painel(a) {
    if (!a) return `<aside class="fl-painel"><div class="cab"><span class="sobre">AVISOS</span><h2>Nenhum aviso selecionado</h2></div><div class="meio"><p style="margin:0;color:var(--texto2)">Nenhum aviso selecionado.</p></div></aside>`;
    const ult = a.registros[a.registros.length - 1];
    let alerta = '', info = '';
    if (a.situacao === 'atencao' && !ult) alerta = `Sem canhoto há ${FL.plural(a.dias, 'dia útil', 'dias úteis')} (prazo: ${a.prazo}). Sem acompanhamento registrado.`;
    else if (a.situacao === 'atencao') alerta = `A data para verificar de novo (${FL.dataCurta(ult.proxima)}) passou e o canhoto não chegou.`;
    else if (a.situacao === 'acomp') info = ult.proxima ? `Em acompanhamento até ${FL.dataCurta(ult.proxima)}. Se o canhoto não chegar até lá, volta para Precisam de atenção.` : 'Marcado como tratado na tela antiga, sem data para verificar de novo. Registre um acompanhamento com data para voltar a controlar.';
    else info = a.canhoto ? 'Canhoto recebido. O aviso fica só no histórico.' : 'Pedido cancelado. O aviso fica só no histórico.';
    const regs = a.registros.slice().reverse();
    return `<aside class="fl-painel" aria-labelledby="avTit"><div class="cab"><span class="sobre">PEDIDO ${esc(a.pedido)} · ${esc(nfTxt(a).toUpperCase())}</span>
        <h2 id="avTit">${esc(a.cliente || '—')}</h2><span style="font-size:14px">${esc(a.tipo)}${a.transportadora && a.tipo === 'Transportadora' ? ' · ' + esc(a.transportadora) : ''} · faturado ${FL.dataCurta(a.faturamento)}</span>${a.nf ? '' : '<span style="font-size:13px">A planilha da expedição não tem uma NF legível para este pedido.</span>'}
        <span style="font-size:14px">Vendedor: ${esc(a.vendedor || 'não informado')}</span></div>
      <div class="meio">
        ${alerta ? `<p class="aviso">${esc(alerta)}</p>` : ''}${info ? `<p class="aviso info">${esc(info)}</p>` : ''}
        ${a.parcial ? `<p style="margin:0;font-size:14px;line-height:1.4"><b>Entrega parcial:</b> ${esc(a.parcial)}</p>` : ''}
        ${a.tipo === 'Transportadora' ? `<a href="#transportadora" style="font-size:14px;font-weight:700">Ver a coleta na Transportadora ${FL.icone.seguir}</a>` : ''}
        <div style="display:flex;flex-direction:column;gap:10px"><span class="rotulo-secao">ACOMPANHAMENTOS</span>
          ${regs.length ? regs.map((g, i) => {
            const venceu = a.situacao !== 'hist' && i === 0 && g.proxima && g.proxima <= st.hoje;
            return `<div class="cartao-mini"><b style="font-size:13px">${FL.dataCurta(g.data)}${g.por ? ' · ' + esc(g.por) : ''}</b><span style="font-size:14px;line-height:1.4">${esc(g.texto)}</span>
              ${g.proxima ? `<span style="font-size:12px;${venceu ? 'color:var(--alerta);font-weight:700' : 'color:var(--texto2)'}">Verificar de novo em ${FL.dataCurta(g.proxima)}${venceu ? ' · venceu' : ''}</span>` : ''}
              ${g.pode_desfazer ? `<button type="button" class="link" style="align-self:flex-start;font-size:13px" data-desfazer="${g.id}">Desfazer</button>` : ''}</div>`;
          }).join('') : '<p style="margin:0;font-size:14px;color:var(--texto2)">Sem registros.</p>'}
        </div></div>
      <div class="pe">${a.situacao !== 'hist' ? '<button type="button" class="btn grande" data-registrar>Registrar acompanhamento</button>' : ''}
        <span style="font-size:12px;color:var(--texto2);line-height:1.4">${a.situacao === 'hist' ? 'Saiu dos avisos quando o canhoto entrou na importação.' : 'O aviso sai daqui sozinho quando o canhoto entrar na importação.'}</span></div></aside>`;
  }

  function registrar(a) {
    let prox = '';
    const atalhos = FL.atalhosVerificar(st.hoje);
    FL.gaveta({ sobre: `PEDIDO ${a.pedido} · ${nfTxt(a).toUpperCase()}`, titulo: 'Registrar acompanhamento', sub: `${a.cliente || ''} · ${FL.plural(a.dias, 'dia útil', 'dias úteis')} sem canhoto (prazo ${a.prazo})`, botao: 'Registrar',
      html: `<div class="campo"><label for="avTexto">O que foi feito <span style="font-weight:400">(obrigatório)</span></label><textarea id="avTexto" rows="4" maxlength="500" placeholder="Ex.: liguei na transportadora, disseram que o canhoto vem no malote de sexta"></textarea></div>
        <div class="campo"><span class="rot" id="avProxRot">Verificar de novo em <span style="font-weight:400">(obrigatório)</span></span>
          <div class="chips" role="group" aria-labelledby="avProxRot">${atalhos.map((x) => `<button type="button" class="chip" data-prox="${x[1]}" aria-pressed="false">${esc(x[0])}</button>`).join('')}</div>
          <label for="avOutra" style="font-size:13px;padding-top:4px">Ou escolha outra data</label><input id="avOutra" type="date" min="${FL.somarDias(st.hoje, 1)}">
          </div>`,
      aoAbrir: (g) => {
        g.addEventListener('click', (e) => { const b = e.target.closest('[data-prox]'); if (!b) return; prox = b.dataset.prox; g.querySelector('#avOutra').value = ''; g.querySelectorAll('[data-prox]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
        g.querySelector('#avOutra').addEventListener('change', (e) => { prox = e.target.value; g.querySelectorAll('[data-prox]').forEach((x) => x.setAttribute('aria-pressed', 'false')); });
      },
      aoSalvar: async (g) => {
        const texto = g.querySelector('#avTexto').value.trim();
        if (!texto) { g.erro('Escreva o que foi feito.'); return false; }
        if (!prox || prox <= st.hoje) { g.erro('Escolha quando verificar de novo (a partir de amanhã).'); return false; }
        const r = await FL.api('POST', '/api/v2/avisos/registros', { pedido: a.pedido, nf: a.nf, texto, proxima: prox });
        if (!r) return false;
        await recarregar();
        FL.toast(`Acompanhamento registrado. Verificar de novo em ${FL.dataCurta(prox)}.`, { desfazer: async () => { if (await FL.api('DELETE', '/api/v2/avisos/registros/' + r.id)) recarregar(); } });
        return true;
      } });
  }

  async function carregar() {
    const [r, p] = await Promise.all([FL.api('GET', '/api/v2/avisos'), FL.api('GET', '/api/v2/prazos', null, { silencioso: true })]);
    if (r) { st.dados = r.avisos; st.hoje = r.hoje; }
    if (p) st.prazos = p.prazos;
    st.carregado = true;
  }
  async function recarregar() { await carregar(); desenhar(); FL.atualizarContagens(); }

  function ligarEventos() {
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; desenhar(); return; }
      if (t.dataset.sel) { st.sel = t.dataset.sel; desenhar(); return; }
      const a = st.dados.find((x) => chave(x) === st.sel);
      if ('registrar' in t.dataset && a) { registrar(a); return; }
      if (t.dataset.desfazer) { if (await FL.api('DELETE', '/api/v2/avisos/registros/' + t.dataset.desfazer)) { await recarregar(); FL.toast('Acompanhamento desfeito.'); } return; }
      if ('abrirFiltros' in t.dataset) { FL.gavetaFiltros({ sobre: 'AVISOS DE CANHOTO', defs: DEFS, itens: daAba(), marcados: st.filtros, nomeItens: 'avisos', aoMudar: (m) => { st.filtros = m; desenhar(); } }); return; }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); desenhar(); return; }
      if ('limparFiltros' in t.dataset) { st.filtros = {}; desenhar(); }
    });
  }

  FL.telas.avisos = {
    montar: async function (alvo) {
      el = alvo;
      st = { dados: [], carregado: false, aba: 'todos', filtros: {}, sel: null, hoje: FL.hojeISO(), prazos: null };
      ligarEventos(); desenhar(); await carregar(); desenhar();
    }
  };
})();
