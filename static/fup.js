/* FlowLog v2 — FUP: Todos · Para revisar · Histórico */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  const SIT = { ok: 'Ok', previsto_atraso: 'Previsto atraso', atraso: 'Atraso' };
  const SELO_SIT = { ok: 'ok', previsto_atraso: '', atraso: 'alerta' };
  const POR_PAGINA = 200;

  const DEFS = [
    { id: 'status', titulo: 'STATUS', ordem: ['Bloqueado', 'Aprovado'], valor: (p) => [p.status] },
    { id: 'prazo', titulo: 'PRAZO', ordem: ['Atrasado', 'Vence em breve', 'No prazo', 'Sem data prometida'], valor: (p) => [p.prazo.tipo === 'atraso' ? 'Atrasado' : (p.prazo.tipo === 'sem_data' ? 'Sem data prometida' : (p.revisar || p.prazo.n <= st.janela ? 'Vence em breve' : 'No prazo'))] },
    { id: 'ultimo', titulo: 'ÚLTIMO FUP', ordem: ['Sem FUP', 'Ok', 'Previsto atraso', 'Atraso'], valor: (p) => [p.fup ? SIT[p.fup.situacao] : 'Sem FUP'] },
    { id: 'motivo', titulo: 'MOTIVO DO ÚLTIMO FUP', valor: (p) => (p.fup && p.fup.motivo ? [p.fup.motivo] : []) },
    { id: 'vendedor', titulo: 'VENDEDOR', valor: (p) => [p.vendedor || 'Sem vendedor'] },
    { id: 'tipo', titulo: 'TIPO DE ENTREGA', valor: (p) => [p.tipo || 'Desconhecido'] },
    { id: 'cliente', titulo: 'CLIENTE', valor: (p) => [p.cliente || '—'] }
  ];

  let el, st;
  const prazoTxt = (p) => (p.prazo.tipo === 'atraso' ? (p.prazo.n ? FL.plural(p.prazo.n, 'dia útil', 'dias úteis') + ' de atraso' : 'Venceu hoje')
    : (p.prazo.tipo === 'sem_data' ? 'Sem data prometida' : (p.prazo.n === 0 ? 'Vence hoje' : (p.prazo.n === 1 ? 'Vence amanhã' : 'Vence em ' + p.prazo.n + ' dias úteis'))));
  const prazoForte = (p) => p.prazo.tipo === 'atraso' || (p.prazo.tipo === 'vence' && p.prazo.n <= 1);
  const daAba = () => st.dados.filter((p) => (st.aba === 'revisar' ? p.revisar : true));
  const filtrados = () => daAba().filter((p) => FL.passaFiltros(p, DEFS, st.filtros));
  const marcados = () => st.dados.filter((p) => st.sel[p.pedido]);

  function desenhar() {
    const nRev = st.dados.filter((p) => p.revisar).length;
    const abas = [{ id: 'todos', rotulo: 'Todos', qtd: st.dados.length }, { id: 'revisar', rotulo: 'Para revisar', qtd: nRev, alerta: true }, { id: 'hist', rotulo: 'Histórico', qtd: st.hist.length }];
    const sel = marcados();
    let corpo;
    if (st.aba === 'hist') corpo = htmlHistorico();
    else {
      const lista = filtrados();
      const vis = lista.slice(0, st.limite);
      corpo = `
        <div class="fl-secao" style="flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;padding:14px 18px">
          <span style="font-size:14px">${sel.length ? `<b>${FL.plural(sel.length, 'pedido marcado', 'pedidos marcados')}</b> · <button type="button" class="link" data-desmarcar>desmarcar</button>` : 'Marque os pedidos para montar a mensagem ao Calebe e registrar as respostas de uma vez.'}</span>
          <span style="display:flex;flex-wrap:wrap;gap:8px">
            ${nRev ? `<button type="button" class="btn sec" data-marcar-revisar>Marcar os ${nRev} para revisar</button>` : ''}
            <button type="button" class="btn sec" data-mensagem ${sel.length ? '' : 'disabled'}>Mensagem para o Calebe</button>
            <button type="button" class="btn" data-respostas ${sel.length ? '' : 'disabled'}>Registrar respostas${sel.length ? ' (' + sel.length + ')' : ''}</button>
          </span></div>
        <div class="fl-tabela-caixa"><table class="fl-tabela"><thead><tr>
          <th style="width:44px"><span class="oculto">Selecionar</span></th><th>Pedido<small>emissão</small></th><th>Cliente<small>status · vendedor</small></th>
          <th>Entrega<small>prazo</small></th><th>Último FUP<small>motivo · há quanto tempo</small></th><th class="dir">Ações</th></tr></thead><tbody>
          ${!st.carregado ? '<tr><td colspan="6" class="vazio">Carregando…</td></tr>' : (vis.length ? vis.map(linha).join('') : `<tr><td colspan="6" class="vazio">${FL.qtdFiltros(st.filtros) ? 'Nenhum pedido com esses filtros. <button type="button" class="link" data-limpar-filtros>Limpar filtros</button>' : (st.aba === 'revisar' ? 'Nada para revisar agora. Todos os pedidos atrasados ou perto do prazo já têm FUP de hoje.' : 'Nenhum pedido em produção.')}</td></tr>`)}
        </tbody></table></div>
        ${lista.length > st.limite ? `<button type="button" class="btn sec" style="align-self:center" data-mais>Mostrar mais</button>` : ''}`;
    }
    el.innerHTML = `
      <div class="fl-cabeca fl-entra"><div class="txt"><h1>FUP</h1>
        <p>Acompanhamento da produção com o Calebe: quais pedidos vão atrasar e por quê. "Para revisar" = atrasado ou vence em até ${st.janela} dias úteis, ainda sem FUP de hoje.</p></div>
        <div class="fl-acoes-topo"><button type="button" class="btn sec" data-lote>${FL.icone.enviar} Importar FUP em lote</button></div></div>
      <div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px">
        <div class="fl-barra-abas">${FL.htmlAbas(abas, st.aba, 'Abas do FUP')}${st.aba === 'hist' ? '' : FL.botaoFiltros(st.filtros)}</div>
        ${st.aba === 'hist' ? '' : FL.htmlChipsAtivos(DEFS, st.filtros)}
      </div>
      <div class="fl-entra d2" style="display:flex;flex-direction:column;gap:16px">${corpo}</div>`;
    FL.aplicarBusca();
  }

  function linha(p) {
    const on = !!st.sel[p.pedido];
    const f = p.fup;
    const ha = f ? (p.dias_desde_fup === 0 ? 'Hoje' : 'Há ' + FL.plural(p.dias_desde_fup, 'dia útil', 'dias úteis')) + (f.por ? ' · ' + f.por : '') : '';
    return `<tr class="${on ? 'sel' : ''}">
      <td><input type="checkbox" data-marcar="${esc(p.pedido)}" ${on ? 'checked' : ''} aria-label="Marcar o pedido ${esc(p.pedido)}" style="width:20px;height:20px;accent-color:#000"></td>
      <td class="nw"><b>${esc(p.pedido)}</b><span class="sub">Emitido ${FL.dataCurta(p.emissao)}</span></td>
      <td><b>${esc(p.cliente || '—')}</b><span class="sub">${esc(p.status)}${p.vendedor ? ' · ' + esc(p.vendedor) : ''}</span></td>
      <td class="nw">${p.nova_data ? 'Nova ' + FL.data(p.nova_data) + '<span class="sub">prometida ' + FL.data(p.prometida) + '</span>' : (p.prometida ? 'Prometida ' + FL.data(p.prometida) : '—')}
        <span class="sub" style="${prazoForte(p) ? 'color:var(--alerta);font-weight:700' : ''}">${esc(prazoTxt(p))}</span></td>
      <td>${f ? `<span class="selo ${SELO_SIT[f.situacao]}">${esc(SIT[f.situacao])}</span> ${esc(f.motivo || (f.situacao === 'ok' ? 'No prazo' : ''))}<span class="sub" style="${p.revisar ? 'color:var(--alerta);font-weight:700' : ''}">${esc(ha)}</span>` : `<span class="sub" style="${p.revisar ? 'color:var(--alerta);font-weight:700' : ''}">Sem FUP ainda</span>`}</td>
      <td class="dir"><button type="button" class="btn sec" style="min-height:34px;padding:0 12px;font-size:13px" data-um="${esc(p.pedido)}">Registrar FUP</button></td></tr>`;
  }

  function htmlHistorico() {
    const vis = st.hist.slice(0, st.limiteHist);
    return `<div class="fl-tabela-caixa"><table class="fl-tabela"><thead><tr><th>Data</th><th>Pedido · cliente</th><th>Situação</th><th>Motivo · observação</th><th>Registrado por</th></tr></thead><tbody>
      ${vis.length ? vis.map((f) => `<tr><td class="nw">${FL.data(f.data)}</td><td><b>${esc(f.pedido)}</b><span class="sub">${esc(f.cliente || '')}</span></td>
        <td><span class="selo ${SELO_SIT[f.situacao]}">${esc(SIT[f.situacao] || f.situacao)}</span></td><td>${esc(f.motivo || '—')}<span class="sub">${esc(f.observacao || '')}</span></td>
        <td>${esc(f.por || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="vazio">Nenhum FUP registrado ainda.</td></tr>'}
      </tbody></table></div>
      ${st.hist.length > st.limiteHist ? '<button type="button" class="btn sec" style="align-self:center" data-mais-hist>Mostrar mais</button>' : ''}`;
  }

  function mensagem() {
    const ped = marcados();
    const opc = { motivo: true, nova: true };
    const montar = () => {
      const linhas = ped.map((p) => {
        let t = `• ${p.pedido} – ${p.cliente || ''} – prometido ${FL.dataCurta(p.prometida)} (${prazoTxt(p).toLowerCase()})`;
        if (opc.nova && p.nova_data) t += ` – nova data ${FL.dataCurta(p.nova_data)}`;
        if (opc.motivo && p.fup && p.fup.motivo) t += ` – último: ${p.fup.motivo.toLowerCase()}`;
        return t;
      });
      return `Calebe, bom dia! FUP de hoje (${FL.dataCurta(st.hoje)}):\n\n${linhas.join('\n')}\n\nPode me passar a previsão de cada um? Se algum vai atrasar, me diz o motivo.`;
    };
    const g = FL.gaveta({ sobre: 'FUP · ' + FL.plural(ped.length, 'PEDIDO', 'PEDIDOS'), titulo: 'Mensagem para o Calebe', sub: 'Copie e cole no WhatsApp. Quando ele responder, registre tudo de uma vez.', semAutor: true, cancelar: 'Fechar', botao: 'Copiar mensagem',
      html: `<div class="chips" role="group" aria-label="Opções da mensagem"><button type="button" class="chip" data-op="motivo" aria-pressed="true">Incluir último motivo</button><button type="button" class="chip" data-op="nova" aria-pressed="true">Incluir nova data</button></div>
        <div class="campo"><label for="msgTexto">Mensagem <span style="font-weight:400">(dá para editar antes de copiar)</span></label><textarea id="msgTexto" rows="14" style="font-size:14px;line-height:1.5">${esc(montar())}</textarea></div>
        <button type="button" class="link" style="align-self:flex-start" data-ir-respostas>Já tenho as respostas: registrar agora</button>`,
      aoAbrir: (gv) => gv.addEventListener('click', (e) => {
        const b = e.target.closest('[data-op]');
        if (b) { opc[b.dataset.op] = !opc[b.dataset.op]; b.setAttribute('aria-pressed', String(opc[b.dataset.op])); gv.querySelector('#msgTexto').value = montar(); }
        if (e.target.closest('[data-ir-respostas]')) { gv.fechar(); respostas(); }
      }),
      aoSalvar: async (gv) => {
        const texto = gv.querySelector('#msgTexto').value;
        try { await navigator.clipboard.writeText(texto); FL.toast('Mensagem copiada. Cole no WhatsApp do Calebe.'); }
        catch (e) { gv.querySelector('#msgTexto').select(); FL.toast('Não deu para copiar sozinho: o texto ficou selecionado, use Ctrl C.', { erro: true }); return false; }
        return true;
      } });
    return g;
  }

  function respostas(lista) {
    const ped = lista || marcados();
    if (!ped.length) return;
    FL.formFup(ped.map((p) => Object.assign({}, p, { atrasado: p.atrasado, dias_atraso: p.dias_atraso })), async () => { st.sel = {}; await recarregar(); });
  }

  async function lote() {
    const imp = (await FL.api('GET', '/api/v2/importacoes', null, { silencioso: true })) || {};
    const ult = (imp.fup || [])[0];
    const rev = st.dados.filter((p) => p.revisar);
    const g = FL.gaveta({ sobre: 'FUP', titulo: 'Importar FUP em lote', sub: 'Para quando as respostas vierem numa planilha.', semAutor: false, cancelar: 'Fechar',
      html: `<ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:12px;font-size:14px;line-height:1.45">
          <li><b>Baixe a planilha</b> dos pedidos para revisar (${rev.length}) ou dos marcados.
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"><button type="button" class="btn sec" data-baixar="revisar" ${rev.length ? '' : 'disabled'}>Pedidos para revisar</button><button type="button" class="btn sec" data-baixar="marcados" ${marcados().length ? '' : 'disabled'}>Pedidos marcados (${marcados().length})</button></div></li>
          <li><b>Preencha</b> as colunas <b>Situação FUP</b> (Ok, Previsto atraso ou Atraso), <b>FUP</b> (o texto) e, se mudou, <b>Nova Data de Entrega</b>. Célula vazia não mexe em nada.</li>
          <li><b>Envie</b> a planilha preenchida.
            <div style="margin-top:8px"><button type="button" class="btn" data-enviar>${FL.icone.enviar} Enviar planilha preenchida</button><input type="file" id="fupArq" accept=".xlsx,.xls" hidden></div></li></ol>
        <div data-resultado>${ult ? `<div class="cartao-mini"><span class="rotulo-secao">ÚLTIMA IMPORTAÇÃO</span><b style="font-size:13px">${FL.dataHora(ult.quando)} · ${esc(ult.por || '—')}</b><span style="font-size:14px">${esc(ult.resumo || '')}</span>${(ult.avisos || []).map((a) => `<span style="font-size:12px;color:var(--alerta);font-weight:700">${esc(a)}</span>`).join('')}</div>` : ''}</div>`,
      aoAbrir: (gv) => {
        gv.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-baixar]');
          if (b) {
            const lista = b.dataset.baixar === 'revisar' ? rev : marcados();
            const r = await FL.api('POST', '/api/v2/pedidos/exportar', { pedidos: lista.map((p) => p.pedido), nome: 'fup' }, { blob: true });
            if (r) FL.baixarArquivo(r.blob, r.nome || 'flowlog_fup.xlsx');
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
    st.carregado = true;
  }
  async function recarregar() { await carregar(); desenhar(); FL.atualizarContagens(); }

  function ligarEventos() {
    el.addEventListener('click', (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; desenhar(); return; }
      if ('marcarRevisar' in t.dataset) { st.dados.filter((p) => p.revisar).forEach((p) => { st.sel[p.pedido] = true; }); desenhar(); return; }
      if ('desmarcar' in t.dataset) { st.sel = {}; desenhar(); return; }
      if ('mensagem' in t.dataset) { mensagem(); return; }
      if ('respostas' in t.dataset) { respostas(); return; }
      if (t.dataset.um) { respostas([st.dados.find((p) => p.pedido === t.dataset.um)]); return; }
      if ('lote' in t.dataset) { lote(); return; }
      if ('mais' in t.dataset) { st.limite += POR_PAGINA; desenhar(); return; }
      if ('maisHist' in t.dataset) { st.limiteHist += POR_PAGINA; desenhar(); return; }
      if ('abrirFiltros' in t.dataset) { FL.gavetaFiltros({ sobre: 'FUP', defs: DEFS, itens: daAba(), marcados: st.filtros, nomeItens: 'pedidos', aoMudar: (m) => { st.filtros = m; desenhar(); } }); return; }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); desenhar(); return; }
      if ('limparFiltros' in t.dataset) { st.filtros = {}; desenhar(); }
    });
    el.addEventListener('change', (e) => {
      if (e.target.dataset.marcar) { st.sel[e.target.dataset.marcar] = e.target.checked; desenhar(); }
    });
  }

  FL.telas.fup = {
    montar: async function (alvo) {
      el = alvo;
      st = { dados: [], hist: [], carregado: false, aba: 'todos', filtros: {}, sel: {}, limite: POR_PAGINA, limiteHist: POR_PAGINA, hoje: FL.hojeISO(), janela: 2 };
      ligarEventos(); desenhar(); await carregar(); desenhar();
    }
  };
})();
