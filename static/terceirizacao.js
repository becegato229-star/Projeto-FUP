/* FlowLog v2 — Terceirização: Todos · Aguardando retorno · Pares · Saídas · Retornos */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  const POR_PAGINA = 150;
  const ICO_PDF = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"></path><path d="M14 2v6h6"></path><path d="M9 14h6M9 18h4"></path></svg>';
  const ICO_LAPIS = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="m13 7 4 4"></path></svg>';
  const ICO_LIXO = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg>';
  const NOME_TIPO = { saida: 'Saída', retorno: 'Retorno' };
  const SELO_COR = { 'BICRO': 'preto', 'Peso não bate': 'contorno-alerta', 'Sem ligação': 'contorno-alerta', 'Saída não lançada': 'contorno-alerta', 'Item sem peso no catálogo': 'contorno', 'Sem PDF': 'contorno' };

  let el, st;
  const chave = (n) => n.tipo + ':' + n.numero;
  const haTxt = (d) => (d == null ? '' : d === 0 ? 'hoje' : d === 1 ? 'há 1 dia' : 'há ' + d + ' dias');
  const kgTxt = (v) => (v == null ? '—' : FL.num(v, v >= 100 ? 0 : 1) + ' kg');
  const tTxt = (v) => (v >= 1000 ? FL.num(v / 1000, 1) + ' t' : kgTxt(v));
  const selosDe = (n) => n.selos.concat(n.selos.some((s) => SELO_COR[s] === 'contorno-alerta' || s.startsWith('Há mais')) ? [] : (n.tipo === 'saida' && n.situacao === 'Retornou' && !n.selos.length ? ['Tudo certo'] : []));

  const DEFS = [
    { id: 'tipo', titulo: 'TIPO', ordem: ['Saída', 'Retorno'], valor: (n) => [NOME_TIPO[n.tipo]] },
    { id: 'sit', titulo: 'SITUAÇÃO', ordem: ['Aguardando retorno', 'Retorno parcial', 'Retornou', 'Retorno'], valor: (n) => [n.situacao] },
    { id: 'forn', titulo: 'FORNECEDOR', valor: (n) => [n.fornecedor || '—'] },
    { id: 'conf', titulo: 'CONFERÊNCIA', valor: (n) => (n.selos.length ? n.selos.map((s) => (s.startsWith('Há mais') ? 'Há mais de ' + st.diasAlerta + ' dias' : s.match(/^\d+ retornos$/) ? 'Mais de um retorno' : s)) : ['Sem pendência']) },
    { id: 'pdf', titulo: 'ORIGEM', ordem: ['PDF', 'À mão'], valor: (n) => [n.com_pdf ? 'PDF' : 'À mão'] }
  ];

  function passaBusca(n) {
    if (!st.q) return true;
    const alvo = [n.numero, n.fornecedor, n.saida, n.cfop].concat((n.retornos || []).map((r) => r.numero)).map((c) => FL.semAcento(c).replace(/[.\s]/g, '')).join('|');
    return alvo.includes(st.q);
  }
  function passaPeriodo(n) {
    if (!st.periodo.de && !st.periodo.ate) return true;
    return !!n.data && (!st.periodo.de || n.data >= st.periodo.de) && (!st.periodo.ate || n.data <= st.periodo.ate);
  }
  function daAba() {
    const a = st.aba;
    return st.dados.filter((n) => a === 'aguardando' ? (n.tipo === 'saida' && n.situacao !== 'Retornou')
      : a === 'pares' ? (n.tipo === 'retorno' && n.saida_existe)
        : a === 'saidas' ? n.tipo === 'saida' : a === 'retornos' ? n.tipo === 'retorno' : true);
  }
  function filtrados() {
    const l = daAba().filter((n) => passaBusca(n) && passaPeriodo(n) && FL.passaFiltros(n, DEFS, st.filtros));
    const o = st.ordem;
    const k = { nota: (n) => n.numero.padStart(10, '0'), forn: (n) => FL.semAcento(n.fornecedor), data: (n) => (n.data || '') + n.numero.padStart(10, '0'),
      peso: (n) => String(Math.round((n.peso || 0) * 1000)).padStart(14, '0') }[o.campo] || ((n) => n.data || '');
    l.sort((a, b) => { const x = k(a), y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * (o.desc ? -1 : 1); });
    return l;
  }

  // ------------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------------
  function cabecalho() {
    return `<div class="fl-cabeca fl-entra"><div class="txt"><h1>Terceirização</h1>
      <p>Notas de saída para a galvanização e de retorno. Clique na nota para ver os itens e a conferência.</p></div>
      <div class="fl-acoes-topo">
        <button type="button" class="btn" data-importar>${FL.icone.enviar} Importar PDF</button>
        <button type="button" class="btn sec" data-manual>+ Nota à mão</button>
        <button type="button" class="btn sec" data-exportar>${FL.icone.baixar} Exportar Excel</button>
        <input type="file" id="tzArq" accept=".pdf" hidden><input type="file" id="tzArqLote" accept=".pdf" multiple hidden></div></div>`;
  }
  function th(campo, titulo, sub) {
    const on = st.ordem.campo === campo;
    return `<th><button type="button" data-ordenar="${campo}" style="padding:0;border:0;background:transparent;color:#fff;font-weight:700;cursor:pointer;text-align:left" aria-label="Ordenar por ${esc(titulo)}">${esc(titulo)}${on ? (st.ordem.desc ? ' ↓' : ' ↑') : ''}</button><small>${esc(sub)}</small></th>`;
  }

  function desenhar() {
    if (!st.carregado) {
      el.innerHTML = cabecalho() + '<div class="fl-tabela-caixa"><div class="carregando"><div class="esqueleto" style="margin:8px 0"></div><div class="esqueleto" style="margin:8px 0;width:70%"></div></div></div>';
      return;
    }
    const r = st.resumo;
    const lista = filtrados();
    const vis = lista.slice(0, st.limite);
    const temPer = !!(st.periodo.de || st.periodo.ate);
    const abas = [
      { id: 'todos', rotulo: 'Todos', qtd: st.dados.length },
      { id: 'aguardando', rotulo: 'Aguardando retorno', qtd: st.dados.filter((n) => n.tipo === 'saida' && n.situacao !== 'Retornou').length, alerta: r.aguardando_atrasadas > 0 },
      { id: 'pares', rotulo: 'Pares', qtd: st.dados.filter((n) => n.tipo === 'retorno' && n.saida_existe).length },
      { id: 'saidas', rotulo: 'Saídas', qtd: st.dados.filter((n) => n.tipo === 'saida').length },
      { id: 'retornos', rotulo: 'Retornos', qtd: st.dados.filter((n) => n.tipo === 'retorno').length }];
    el.innerHTML = cabecalho() + `
      <div class="fl-cartoes fl-entra d1">
        <button type="button" class="fl-cartao" data-cartao="aguardando"><span class="v" style="color:${r.aguardando_atrasadas ? 'var(--alerta)' : '#000'}">${FL.num(r.aguardando)}</span><span class="r">Aguardando retorno</span><span class="s">${tTxt(r.aguardando_peso)} no fornecedor${r.aguardando_atrasadas ? ' · ' + r.aguardando_atrasadas + ' há mais de ' + st.diasAlerta + ' dias' : ''}</span></button>
        <button type="button" class="fl-cartao" data-cartao="pares"><span class="v">${r.lead_mediana != null ? FL.num(r.lead_mediana, r.lead_mediana % 1 ? 1 : 0) + ' dias' : '—'}</span><span class="r">Lead time (mediana)</span><span class="s">${r.lead_min != null ? 'mín. ' + r.lead_min + ' · máx. ' + r.lead_max + ' dias' : 'nenhum par ainda'}</span></button>
        <button type="button" class="fl-cartao" data-cartao="mes"><span class="v">${FL.num(r.voltaram_mes)}</span><span class="r">Voltaram neste mês</span><span class="s">${tTxt(r.voltaram_mes_peso)} em notas de retorno</span></button>
        <button type="button" class="fl-cartao" data-cartao="pendentes"><span class="v" style="color:${r.pendentes ? 'var(--alerta)' : '#000'}">${FL.num(r.pendentes)}</span><span class="r">Notas com pendência</span><span class="s">sem PDF, sem ligação, peso…</span></button>
      </div>
      <div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px">
        <div class="fl-barra-abas">${FL.htmlAbas(abas, st.aba, 'Abas da terceirização')}${FL.botaoFiltros(Object.assign({}, st.filtros, temPer ? { _p: [1] } : {}))}</div>
        ${chipsHtml()}
      </div>
      <div class="fl-tabela-caixa fl-entra d2"><table class="fl-tabela"><thead><tr>
        ${th('nota', 'Nota', 'tipo · CFOP')}${th('forn', 'Fornecedor', 'origem')}${th('data', 'Data', 'há quantos dias')}${th('peso', 'Peso', 'valor')}
        <th>Ligação<small>lead time</small></th><th>Conferência</th><th class="dir">Ações</th>
      </tr></thead><tbody>
        ${vis.length ? vis.map(linha).join('') : `<tr><td colspan="7" class="vazio">${st.q || FL.qtdFiltros(st.filtros) || temPer ? 'Nenhuma nota com essa busca ou filtros. <button type="button" class="link" data-limpar-filtros>Limpar</button>' : (st.aba === 'aguardando' ? 'Nenhuma saída aguardando retorno.' : 'Nenhuma nota ainda. Use "Importar PDF".')}</td></tr>`}
      </tbody></table></div>
      ${lista.length > st.limite ? `<button type="button" class="btn sec" style="align-self:center" data-mais>Mostrar mais ${Math.min(POR_PAGINA, lista.length - st.limite)}</button>` : ''}`;
  }
  function chipsHtml() {
    let h = FL.htmlChipsAtivos(DEFS, st.filtros);
    if (st.periodo.de || st.periodo.ate) {
      const chip = `<button type="button" class="chip" style="background:#000;color:#fff;border-color:#000;min-height:32px" data-tirar-periodo aria-label="Remover filtro de período"><span style="color:var(--verde);font-weight:700">Período:</span> ${st.periodo.de ? 'de ' + FL.dataCurta(st.periodo.de) : ''} ${st.periodo.ate ? 'até ' + FL.dataCurta(st.periodo.ate) : ''} ${FL.icone.x}</button>`;
      h = h ? h.replace('<button type="button" class="link" data-limpar-filtros>', chip + '<button type="button" class="link" data-limpar-filtros>') : `<div class="chips" style="align-items:center"><span style="font-size:13px;font-weight:700">Filtrando por:</span>${chip}<button type="button" class="link" data-limpar-filtros>Limpar tudo</button></div>`;
    }
    return h;
  }

  function ligacaoHtml(n) {
    if (n.tipo === 'saida') {
      if (!n.retornos.length) return `<span style="color:var(--texto2)">Sem retorno</span><span class="sub" style="${(n.dias || 0) > st.diasAlerta ? 'color:var(--alerta);font-weight:700' : ''}">${n.dias != null ? 'saiu ' + haTxt(n.dias) : ''}</span>`;
      const ult = n.retornos[n.retornos.length - 1];
      return `${n.retornos.map((r) => `<button type="button" class="link" data-ir="retorno:${esc(r.numero)}">${esc(r.numero)}</button>`).join(', ')}<span class="sub">${n.situacao === 'Retorno parcial' ? '<b style="color:var(--alerta)">Retorno parcial</b> · ' : ''}${FL.plural(ult.lead, 'dia', 'dias')}</span>`;
    }
    if (!n.saida) return '<span style="color:var(--alerta);font-weight:700">Sem ligação</span>';
    return `${n.saida_existe ? `<button type="button" class="link" data-ir="saida:${esc(n.saida)}">${esc(n.saida)}</button>` : esc(n.saida)}<span class="sub">${n.lead != null ? FL.plural(n.lead, 'dia', 'dias') : 'saída não lançada'}${n.vinculo_manual ? ' · à mão' : ''}</span>`;
  }
  function linha(n) {
    const k = chave(n);
    const aberto = !!st.abertos[k];
    const selos = selosDe(n);
    return `<tr class="${aberto ? 'aberta' : ''}" data-linha-nota="${esc(k)}">
      <td class="nw"><button type="button" class="fl-link-linha" data-abrir="${esc(k)}" aria-expanded="${aberto}" aria-label="Mostrar itens da nota ${esc(n.numero)}">${FL.icone.seta}${esc(n.numero)}</button><span class="sub" style="padding-left:18px">${NOME_TIPO[n.tipo]}${n.cfop ? ' · ' + esc(n.cfop) : ''}</span></td>
      <td style="max-width:240px"><b>${esc(n.fornecedor || '—')}</b><span class="sub">${n.com_pdf ? 'PDF' : 'À mão'}</span></td>
      <td class="nw">${FL.data(n.data)}<span class="sub">${haTxt(n.dias)}</span></td>
      <td class="nw">${kgTxt(n.peso)}${n.peso_calculado ? ' <span title="Calculado pelo catálogo" style="font-size:11px;color:var(--texto2)">(catálogo)</span>' : ''}<span class="sub">${n.valor != null ? FL.brl(n.valor) : '—'}</span></td>
      <td class="nw">${ligacaoHtml(n)}</td>
      <td style="max-width:260px"><span style="display:flex;flex-wrap:wrap;gap:4px">${selos.map((s) => `<span class="selo ${s === 'Tudo certo' ? 'ok' : (s.startsWith('Há mais') ? 'contorno-alerta' : (SELO_COR[s] || 'contorno'))}">${esc(s)}</span>`).join('') || '<span style="color:var(--texto2)">—</span>'}</span></td>
      <td class="dir nw"><span style="display:inline-flex;gap:6px">
        ${n.com_pdf ? `<a class="btn-icone" href="/api/terceirizacao/${n.tipo}/${encodeURIComponent(n.numero)}/pdf" target="_blank" rel="noopener" title="Abrir o PDF" aria-label="Abrir o PDF da nota ${esc(n.numero)}">${ICO_PDF}</a>` : ''}
        <button type="button" class="btn-icone" data-acao="editar" data-k="${esc(k)}" title="Editar" aria-label="Editar a nota ${esc(n.numero)}">${ICO_LAPIS}</button>
        <button type="button" class="btn-icone" data-acao="apagar" data-k="${esc(k)}" title="Apagar" aria-label="Apagar a nota ${esc(n.numero)}">${ICO_LIXO}</button>
      </span></td></tr>
      ${aberto ? `<tr class="detalhe"><td colspan="7">${detalheHtml(n)}</td></tr>` : ''}`;
  }

  function detalheHtml(n) {
    const d = st.detalhes[chave(n)];
    if (!d) return '<div class="carregando">Carregando itens…</div>';
    const c = d.conferencia;
    const avisos = [];
    if (n.tem_bicro) avisos.push(['aviso preto', n.tipo === 'saida' ? 'Esta saída tem item que precisa voltar BICRO (bicromatizado). O resto volta GE.' : 'A saída ligada tem item que precisa voltar BICRO: confira na coluna "Precisa voltar assim".']);
    if (n.tipo === 'saida' && n.situacao !== 'Retornou' && (n.dias || 0) > st.diasAlerta) avisos.push(['aviso', `Saiu ${haTxt(n.dias)} e ${n.situacao === 'Retorno parcial' ? 'ainda falta voltar parte dos itens' : 'ainda não voltou'}.`]);
    if (c.peso_diverge) avisos.push(['aviso', `O peso da nota (${kgTxt(c.peso_bruto_nota)}) não bate com a soma dos itens pelo catálogo (${kgTxt(c.soma_peso_itens)}).`]);
    if (c.itens_sem_peso) avisos.push(['aviso info', `${FL.plural(c.itens_sem_peso, 'item não tem', 'itens não têm')} peso no catálogo (Configurações › Importar › Catálogo de produtos).`]);
    if (c.valor_diverge) avisos.push(['aviso', `A soma dos itens (${FL.brl(c.soma_valor_itens)}) não bate com o valor dos produtos (${FL.brl(c.valor_total_produtos)}).`]);
    if (n.tipo === 'retorno' && !n.saida) avisos.push(['aviso', 'Retorno sem saída ligada. Use o lápis (Editar) para escolher a saída.']);
    if (n.tipo === 'retorno' && n.saida && !n.saida_existe) avisos.push(['aviso', `A saída ${n.saida} ainda não está no FlowLog. Importe o PDF dela ou lance à mão.`]);
    const its = d.itens;
    let tabela;
    if (!its.length) tabela = '<p style="margin:0;font-size:14px;color:var(--texto2)">Nota lançada à mão: sem itens. Importe o PDF para ver os itens (a data e a ligação não mudam).</p>';
    else if (n.tipo === 'saida') {
      tabela = `<table class="tabela-interna"><thead><tr><th>Código</th><th>Descrição</th><th style="text-align:right">Qtd.</th><th style="text-align:right">Peso</th><th>Acabamento</th><th>Voltou</th></tr></thead><tbody>
        ${its.map((i) => {
          const acab = (i.acabamento || 'GE').toUpperCase();
          const voltou = !n.retornos.length ? '<span style="color:var(--texto2)">—</span>' : (i.falta > 0 ? `<b style="color:var(--alerta)">Faltam ${FL.num(i.falta, i.falta % 1 ? 2 : 0)}</b>` : `<span style="color:var(--verde-escuro,#1E7A52);font-weight:700">✓ ${FL.num(i.voltou, i.voltou % 1 ? 2 : 0)}</span>`);
          return `<tr><td class="nw">${esc(i.codigo_produto)}</td><td>${esc(i.descricao || '—')}</td><td style="text-align:right" class="nw">${FL.num(i.quantidade, (i.quantidade || 0) % 1 ? 2 : 0)} ${esc(i.unidade || '')}</td>
            <td style="text-align:right" class="nw">${kgTxt(i.peso_total)}</td>
            <td><div class="seg" style="grid-template-columns:1fr 1fr;min-width:120px" role="group" aria-label="Acabamento do item ${esc(i.codigo_produto)}">${['GE', 'BICRO'].map((a) => `<button type="button" style="min-height:30px;font-size:12px" data-acab="${a}" data-item="${i.id}" data-k="${esc(chave(n))}" aria-pressed="${a === acab}">${a}</button>`).join('')}</div></td>
            <td class="nw">${voltou}</td></tr>`;
        }).join('')}</tbody></table>`;
    } else {
      tabela = `<table class="tabela-interna"><thead><tr><th>Código</th><th>Descrição</th><th style="text-align:right">Qtd.</th><th style="text-align:right">Peso</th><th>Precisa voltar assim</th><th>Conferência</th><th style="text-align:right">R$/kg</th></tr></thead><tbody>
        ${its.map((i) => `<tr><td class="nw">${esc(i.codigo_produto)}</td><td>${esc(i.descricao || '—')}</td><td style="text-align:right" class="nw">${FL.num(i.quantidade, (i.quantidade || 0) % 1 ? 2 : 0)} ${esc(i.unidade || '')}</td>
          <td style="text-align:right" class="nw">${kgTxt(i.peso_total)}</td>
          <td>${i.precisa_voltar ? `<span class="selo ${i.precisa_voltar.includes('BICRO') ? 'preto' : ''}">${esc(i.precisa_voltar)}</span>` : '—'}</td>
          <td class="nw">${i.estava_na_saida == null ? `<span style="color:var(--texto2)">${i.saida_sem_itens ? 'saída sem itens (à mão)' : 'sem saída ligada'}</span>` : (i.estava_na_saida ? '<span style="color:var(--verde-escuro,#1E7A52);font-weight:700">✓ estava na saída</span>' : '<b style="color:var(--alerta)">Não estava na saída</b>')}</td>
          <td style="text-align:right" class="nw">${i.preco_kg != null ? FL.brl(i.preco_kg) : '—'}</td></tr>`).join('')}</tbody></table>`;
    }
    const nota = d.nota;
    const dados = [['Peso da nota', kgTxt(c.peso_bruto_nota) + (c.peso_calculado_pelos_itens ? ' (fornecedor não informa)' : '')], ['Soma dos itens', kgTxt(c.soma_peso_itens)],
      ['Valor', nota.valor_total_nota != null ? FL.brl(nota.valor_total_nota) : '—'], ['Natureza', nota.natureza_operacao || '—']];
    if (nota.chave_acesso) dados.push(['Chave', nota.chave_acesso]);
    let ligados = '';
    if (n.tipo === 'saida') {
      ligados = `<span class="rotulo-secao">RETORNOS LIGADOS</span>${(d.retornos_vinculados || []).length ? d.retornos_vinculados.map((r) => `<button type="button" class="cartao-mini" style="flex-direction:row;justify-content:space-between;cursor:pointer;text-align:left" data-ir="retorno:${esc(r.numero_nota)}"><b>${esc(r.numero_nota)}</b><span style="font-size:13px">${FL.data(r.data_nota)} · ${FL.plural(r.dias_lead_time, 'dia', 'dias')}</span></button>`).join('') : '<p style="margin:0;font-size:14px;color:var(--texto2)">Nenhum retorno ainda.</p>'}`;
    } else if (d.saida_vinculada) {
      const s = d.saida_vinculada;
      ligados = `<span class="rotulo-secao">SAÍDA LIGADA</span><button type="button" class="cartao-mini" style="flex-direction:row;justify-content:space-between;cursor:pointer;text-align:left" data-ir="saida:${esc(s.numero_nota)}"><b>${esc(s.numero_nota)}</b><span style="font-size:13px">${FL.data(s.data_nota)} · lead time ${FL.plural(s.dias_lead_time, 'dia', 'dias')}</span></button>
        ${nota.informacoes_adicionais ? `<span style="font-size:12px;color:var(--texto2)">Texto da nota: “${esc(nota.informacoes_adicionais.slice(0, 220))}”</span>` : ''}`;
    }
    return `<div style="display:flex;flex-direction:column;gap:14px">
      ${avisos.map((a) => `<p class="${a[0]}"${a[0] === 'aviso preto' ? ' style="background:#000;color:#fff"' : ''}>${esc(a[1])}</p>`).join('')}
      <div style="display:flex;flex-wrap:wrap;gap:6px 24px;font-size:13px;color:var(--texto2)">${dados.map((x) => `<span>${esc(x[0])}: <b style="color:#000;word-break:break-all">${esc(x[1])}</b></span>`).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start">
        <div style="flex:3 1 520px;min-width:0;display:flex;flex-direction:column;gap:8px"><span class="rotulo-secao">ITENS</span><div style="overflow-x:auto">${tabela}</div></div>
        <div style="flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:8px">${ligados}</div>
      </div></div>`;
  }

  // ------------------------------------------------------------------
  async function carregar() {
    const r = await FL.api('GET', '/api/v2/terceirizacao');
    st.carregado = true;
    if (!r) return;
    st.dados = r.notas; st.resumo = r.resumo; st.diasAlerta = r.dias_alerta; st.fornecedores = r.fornecedores; st.hoje = r.hoje;
  }
  async function carregarDetalhe(k) {
    const [tipo, num] = k.split(':');
    const d = await FL.api('GET', `/api/v2/terceirizacao/${tipo}/${encodeURIComponent(num)}`);
    if (d) { st.detalhes[k] = d; desenhar(); }
  }
  async function recarregar() {
    await carregar();
    const abertos = Object.keys(st.abertos).filter((k) => st.abertos[k]);
    st.detalhes = {};
    desenhar();
    for (const k of abertos) await carregarDetalhe(k);
  }
  const achar = (k) => st.dados.find((n) => chave(n) === k);
  function irPara(k) {
    st.abertos[k] = true;
    const n = achar(k);
    if (n && !filtrados().includes(n)) { st.aba = 'todos'; st.filtros = {}; st.periodo = {}; }
    desenhar();
    if (!st.detalhes[k]) carregarDetalhe(k);
    setTimeout(() => { const tr = el.querySelector(`[data-linha-nota="${CSS.escape(k)}"]`); if (tr) tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 80);
  }

  // ------------------------------------------------------------------
  // Importar PDF (uma nota, com conferência)
  // ------------------------------------------------------------------
  const STATUS_IMP = {
    novo: ['ok', 'Nota nova'], enriquecer: ['info', 'Já lançada à mão: o PDF completa (a data e a ligação não mudam)'],
    so_pdf: ['info', 'Já importada, sem o PDF guardado: só o PDF será guardado'], duplicado: ['', 'Já importada (com PDF)'], restaurada: ['info', 'Nota que tinha sido apagada']
  };
  function formImportar() {
    let lido = null, tipo = null, arquivo = null, gvRef = null;
    const g = FL.gaveta({ sobre: 'TERCEIRIZAÇÃO', titulo: 'Importar PDF da nota', sub: 'Saída ou retorno: o FlowLog descobre pelo CFOP. Nada é gravado antes de "Confirmar e gravar".', botao: 'Confirmar e gravar', largura: 620,
      html: `<div class="zona-arquivo" data-escolher-pdf tabindex="0" role="button" style="cursor:pointer"><b>Arraste o PDF da nota aqui, ou clique para escolher</b><span style="font-size:13px;color:var(--texto2)">Um PDF por vez (DANFE).</span></div>
        <div data-lido></div>
        <button type="button" class="link" style="align-self:flex-start" data-lote>Tem vários PDFs? Importar vários de uma vez</button>`,
      aoAbrir: (gv) => {
        gvRef = gv;
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf'; inp.hidden = true; gv.appendChild(inp);
        gv.addEventListener('click', (e) => {
          if (e.target.closest('[data-escolher-pdf]')) inp.click();
          if (e.target.closest('[data-lote]')) { gv.fechar(); el.querySelector('#tzArqLote').click(); }
        });
        const z = gv.querySelector('[data-escolher-pdf]');
        z.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
        z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('arrastando'); });
        z.addEventListener('dragleave', () => z.classList.remove('arrastando'));
        z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('arrastando'); if (e.dataTransfer.files[0]) ler(e.dataTransfer.files[0]); });
        inp.addEventListener('change', () => { if (inp.files[0]) ler(inp.files[0]); inp.value = ''; });
        gv.addEventListener('input', () => atualizarLigacao());
        async function ler(f) {
          arquivo = f;
          gv.erro('');
          gv.querySelector('[data-lido]').innerHTML = '<div class="carregando">Lendo o PDF…</div>';
          const fd = () => { const x = new FormData(); x.append('file', arquivo); return x; };
          let r = await FL.api('POST', '/api/terceirizacao/saida/importar-pdf', null, { form: fd() });
          tipo = 'saida';
          if (r && r.aviso_direcao && /RETORNO/.test(r.aviso_direcao)) { r = await FL.api('POST', '/api/terceirizacao/retorno/importar-pdf', null, { form: fd() }); tipo = 'retorno'; }
          if (!r) { gv.querySelector('[data-lido]').innerHTML = ''; return; }
          if (r.status === 'erro_leitura' || !r.dados) { lido = null; gv.querySelector('[data-lido]').innerHTML = `<p class="aviso">${esc(r.mensagem || 'Não consegui ler este PDF.')} Lance a nota à mão.</p>`; return; }
          lido = r;
          desenharLido(gv);
        }
      },
      aoSalvar: async (gv) => {
        if (!lido) { gv.erro('Escolha o PDF da nota.'); return false; }
        if (lido.status === 'duplicado') { gv.erro('Esta nota já foi importada com o PDF. Nada a gravar.'); return false; }
        const dados = Object.assign({}, lido.dados);
        const dataInp = gv.querySelector('#impData');
        if (dataInp) { if (!dataInp.value) { gv.erro('Escolha a data.'); return false; } dados.data_nota = dataInp.value; }
        if (tipo === 'retorno') { const s = gv.querySelector('#impSaida'); dados.numero_nota_saida = s && s.value.trim() ? s.value.replace(/[.\s]/g, '') : null; }
        const ja = achar(tipo + ':' + dados.numero_nota);
        if (ja && lido.status !== 'novo') { dados.data_nota = ja.data; dados.fornecedor = ja.fornecedor; } // nota já no FlowLog: a data e o fornecedor dela valem
        if (!dados.fornecedor) { gv.erro('O PDF não trouxe o fornecedor: lance esta nota à mão.'); return false; }
        const r = await FL.api('POST', `/api/terceirizacao/${tipo}/confirmar-importacao`, dados);
        if (!r) return false;
        const k = tipo + ':' + dados.numero_nota;
        st.abertos[k] = true;
        await recarregar();
        irPara(k);
        const nome = (tipo === 'saida' ? 'Saída ' : 'Retorno ') + dados.numero_nota;
        FL.toast(`${nome} ${r.status === 'novo' ? 'importada' : r.status === 'so_pdf' ? ': PDF guardado' : r.status === 'restaurada' ? 'voltou para a lista' : 'completada pelo PDF'}.`,
          r.status === 'novo' ? { desfazer: async () => { if (await FL.api('DELETE', `/api/v2/terceirizacao/${tipo}/${encodeURIComponent(dados.numero_nota)}`)) recarregar(); } } : undefined);
        return true;
      } });
    function desenharLido(gv) {
      const d = lido.dados;
      const [cor, txt] = STATUS_IMP[lido.status] || ['', lido.status];
      const cfops = [...new Set((d.itens || []).map((i) => i.cfop).filter(Boolean))].join('/');
      const existente = achar(tipo + ':' + d.numero_nota);
      const podeData = lido.status === 'novo';
      const ligManual = !!(existente && existente.tipo === 'retorno' && existente.vinculo_manual && existente.saida);
      gv.querySelector('[data-lido]').innerHTML = `
        <div class="cartao-mini" style="gap:8px">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b style="font-size:18px">${NOME_TIPO[tipo]} ${esc(d.numero_nota)}</b><span class="selo ${cor === 'ok' ? 'ok' : (cor === 'info' ? 'contorno' : 'contorno-alerta')}">${esc(txt)}</span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px 18px;font-size:13px;color:var(--texto2)">
            <span>CFOP: <b style="color:#000">${esc(cfops || '—')}</b></span><span>Fornecedor: <b style="color:#000">${esc(d.fornecedor || '—')}</b></span>
            <span>Data impressa: <b style="color:#000">${FL.data(d.data_nota)}</b></span><span>Peso: <b style="color:#000">${kgTxt(d.peso_bruto)}</b></span>
            <span>Valor: <b style="color:#000">${d.valor_total_nota != null ? FL.brl(d.valor_total_nota) : '—'}</b></span><span>Itens: <b style="color:#000">${(d.itens || []).length}</b></span></div>
          ${d.chave_acesso ? `<span style="font-size:12px;color:var(--texto2);word-break:break-all">Chave ${esc(d.chave_acesso)}</span>` : ''}
        </div>
        ${[lido.aviso_direcao, lido.mensagem].concat(lido.avisos_leitura || []).filter(Boolean).map((a) => `<p class="aviso">${esc(a)}</p>`).join('')}
        ${podeData ? `<div class="campo"><label for="impData">Data ${tipo === 'saida' ? 'de saída' : 'de volta'} (a real)</label><input id="impData" type="date" value="${esc(d.data_nota || '')}">
          <span class="dica" data-dica-data></span></div>` : (existente ? `<p class="aviso info">A data fica a que já está no FlowLog: ${FL.data(existente.data)}.</p>` : '')}
        ${tipo === 'retorno' && lido.status !== 'duplicado' && lido.status !== 'so_pdf' ? `<div class="campo"><label for="impSaida">Nota de saída ligada</label><input id="impSaida" type="text" inputmode="numeric" value="${esc(ligManual ? existente.saida : (d.numero_nota_saida || ''))}" ${ligManual ? 'readonly' : ''} placeholder="Número da saída (com ou sem ponto)">
          ${ligManual ? '<span class="dica"><b>Ligação escolhida à mão: fica como está.</b> Para mudar, use o lápis (Editar).</span>' : ''}
          <span class="dica" data-dica-saida></span>
          ${d.informacoes_complementares ? `<span class="dica">Texto da nota: “${esc(d.informacoes_complementares.slice(0, 260))}”</span>` : ''}</div>` : ''}
        ${(d.itens || []).length ? `<details><summary style="cursor:pointer;font-weight:700;font-size:13px">ITENS LIDOS (${d.itens.length})</summary><div style="overflow-x:auto;margin-top:8px"><table class="tabela-interna"><thead><tr><th>Código</th><th>Descrição</th><th style="text-align:right">Qtd.</th><th style="text-align:right">Valor</th></tr></thead><tbody>
          ${d.itens.map((i) => `<tr><td>${esc(i.codigo_produto)}</td><td>${esc(i.descricao || '')}</td><td style="text-align:right">${FL.num(i.quantidade, (i.quantidade || 0) % 1 ? 2 : 0)}</td><td style="text-align:right">${FL.brl(i.valor_total)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
      atualizarLigacao();
    }
    function atualizarLigacao() {
      if (!lido) return;
      const gv = gvRef;
      if (!gv) return;
      const d = lido.dados;
      const di = gv.querySelector('#impData'), dd = gv.querySelector('[data-dica-data]');
      if (di && dd) dd.textContent = di.value && di.value !== d.data_nota ? `A nota diz ${FL.data(d.data_nota)}; vai ficar ${FL.data(di.value)}.` : 'Igual à data impressa. Mude se a nota saiu ou voltou em outro dia.';
      const si = gv.querySelector('#impSaida'), sd = gv.querySelector('[data-dica-saida]');
      if (si && sd) {
        const num = si.value.replace(/[.\s]/g, '');
        const s = num && achar('saida:' + num);
        const dataRet = (di && di.value) || d.data_nota;
        if (!num) sd.textContent = 'Sem ligação. Dá para ligar depois pelo lápis (Editar).';
        else if (s) sd.innerHTML = `Saída ${esc(num)} de ${FL.data(s.data)} · lead time ${FL.plural(Math.round((new Date(dataRet + 'T12:00:00') - new Date(s.data + 'T12:00:00')) / 864e5), 'dia', 'dias')}${si.readOnly ? '' : (num !== (d.vinculo_detectado_automaticamente || '') ? ' · <b>ligação escolhida à mão</b> (nunca é trocada por outra importação)' : ' · achada no texto da nota')}`;
        else sd.innerHTML = `<b style="color:var(--alerta)">A saída ${esc(num)} não está no FlowLog.</b> O retorno fica ligado a ela e aparece "Saída não lançada" até ela ser importada.`;
      }
    }
    return g;
  }

  async function importarLote(arquivos) {
    if (!arquivos.length) return;
    const fd = new FormData();
    [...arquivos].forEach((f) => fd.append('files', f));
    FL.toast('Lendo ' + FL.plural(arquivos.length, 'PDF', 'PDFs') + '…');
    const r = await FL.api('POST', '/api/terceirizacao/importar-pdfs-lote', null, { form: fd });
    if (!r) return;
    // Nota antiga que só ganhou o PDF agora: relê os itens com o leitor atual (o antigo pulava linhas, ex.: "4641.")
    if (r.resultados.some((x) => x.resultado === 'pdf_guardado')) {
      const rp = await FL.api('POST', '/api/terceirizacao/reprocessar-pdfs', null, { silencioso: true });
      const mudou = rp ? rp.detalhes.filter((x) => x.itens_antes != null) : [];
      if (mudou.length) r.resultados.unshift({ arquivo: 'Releitura dos PDFs guardados', resultado: 'completada', mensagem: mudou.map((x) => `${NOME_TIPO[x.tipo]} ${x.numero_nota}: ${x.itens_antes} → ${x.itens_depois} itens`).join(' · '), avisos: [] });
    }
    const NOME = { criada: 'Nota nova', completada: 'Completada pelo PDF', pdf_guardado: 'Só o PDF guardado', restaurada: 'Voltou para a lista', ignorada: 'Pulada', erro: 'Não importada' };
    FL.gaveta({ sobre: 'RESULTADO DA IMPORTAÇÃO', titulo: FL.plural(r.total, 'PDF', 'PDFs'), semAutor: true, cancelar: 'Fechar',
      html: r.resultados.map((x) => `<div class="cartao-mini" style="border-left:4px solid ${['criada', 'completada', 'pdf_guardado', 'restaurada'].includes(x.resultado) ? 'var(--verde)' : 'var(--c3)'}">
        <span style="font-size:13px;color:var(--texto2)">${esc(x.arquivo)}</span>
        <b>${esc(NOME[x.resultado] || x.resultado)}${x.numero_nota ? ' · ' + (NOME_TIPO[x.tipo] || '') + ' ' + esc(x.numero_nota) : ''}${x.vinculo ? ' · ligada à saída ' + esc(x.vinculo) : ''}</b>
        <span style="font-size:14px">${esc(x.mensagem || '')}</span>
        ${(x.avisos || []).map((a) => `<p class="aviso" style="margin-top:6px">${esc(a)}</p>`).join('')}</div>`).join('') });
    await recarregar();
  }

  // ------------------------------------------------------------------
  // Nota à mão · Editar · Apagar
  // ------------------------------------------------------------------
  function campoFornecedor(id, valor) {
    return `<div class="campo"><label for="${id}">Fornecedor</label><input id="${id}" type="text" list="${id}Lista" maxlength="120" value="${esc(valor || '')}">
      <datalist id="${id}Lista">${st.fornecedores.map((f) => `<option value="${esc(f)}">`).join('')}</datalist></div>`;
  }
  function formManual() {
    let tipo = 'saida';
    FL.gaveta({ sobre: 'TERCEIRIZAÇÃO', titulo: 'Nota à mão', sub: 'Para nota sem PDF. Quando o PDF chegar, ele completa a nota sem mudar a data nem a ligação.', botao: 'Gravar nota',
      html: `<div class="campo"><span class="rot" id="nmTipoRot">Tipo</span><div class="seg" style="grid-template-columns:1fr 1fr" role="group" aria-labelledby="nmTipoRot">
          <button type="button" data-tipo="saida" aria-pressed="true">Saída</button><button type="button" data-tipo="retorno" aria-pressed="false">Retorno</button></div></div>
        <div class="campo"><label for="nmNum">Número da nota <span style="font-weight:400">(obrigatório)</span></label><input id="nmNum" type="text" inputmode="numeric" placeholder="Com ou sem ponto: 118.098 ou 118098"></div>
        <div class="campo"><label for="nmData">Data (a real de saída ou de volta)</label><input id="nmData" type="date" value="${FL.hojeISO()}"></div>
        ${campoFornecedor('nmForn', st.fornecedores[0] || '')}
        <div class="campo" data-so-retorno hidden><label for="nmSaida">Nota de saída ligada <span style="font-weight:400">(opcional)</span></label><input id="nmSaida" type="text" inputmode="numeric">
          <span class="dica">Ligação escolhida à mão nunca é trocada por uma importação de PDF.</span></div>`,
      aoAbrir: (g) => g.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tipo]');
        if (!b) return;
        tipo = b.dataset.tipo;
        g.querySelectorAll('[data-tipo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        g.querySelector('[data-so-retorno]').hidden = tipo !== 'retorno';
      }),
      aoSalvar: async (g) => {
        const numero = g.querySelector('#nmNum').value.trim(), data = g.querySelector('#nmData').value;
        if (!numero) { g.erro('Digite o número da nota.'); return false; }
        if (!data) { g.erro('Escolha a data.'); return false; }
        const r = await FL.api('POST', '/api/v2/terceirizacao/manual', { tipo, numero, data, fornecedor: g.querySelector('#nmForn').value, saida: tipo === 'retorno' ? g.querySelector('#nmSaida').value.trim() || null : null });
        if (!r) return false;
        await recarregar();
        irPara(tipo + ':' + r.numero);
        FL.toast(`${NOME_TIPO[tipo]} ${r.numero} lançada à mão.`, { desfazer: async () => { if (await FL.api('DELETE', `/api/v2/terceirizacao/${tipo}/${encodeURIComponent(r.numero)}`)) recarregar(); } });
        return true;
      } });
  }

  async function formEditar(n) {
    const d = st.detalhes[chave(n)] || await FL.api('GET', `/api/v2/terceirizacao/${n.tipo}/${encodeURIComponent(n.numero)}`);
    if (!d) return;
    const nota = d.nota;
    FL.gaveta({ sobre: NOME_TIPO[n.tipo].toUpperCase() + ' ' + n.numero, titulo: 'Editar nota', sub: 'A data é a real de saída ou de volta; importar o PDF de novo nunca troca.', botao: 'Salvar',
      html: `<div class="campo"><label for="edData">Data</label><input id="edData" type="date" value="${esc(nota.data_nota || '')}"></div>
        ${campoFornecedor('edForn', nota.fornecedor)}
        ${n.tipo === 'retorno' ? `<div class="campo"><label for="edSaida">Nota de saída ligada</label><input id="edSaida" type="text" inputmode="numeric" value="${esc(nota.numero_nota_saida || '')}" placeholder="Vazio = sem ligação">
          <span class="dica">Ligação escolhida à mão nunca é trocada por uma importação de PDF.</span></div>` : ''}`,
      aoSalvar: async (g) => {
        const data = g.querySelector('#edData').value, forn = g.querySelector('#edForn').value.trim();
        if (!data) { g.erro('Escolha a data.'); return false; }
        if (!forn) { g.erro('Digite o fornecedor.'); return false; }
        const url = `/api/terceirizacao/${n.tipo}/${encodeURIComponent(n.numero)}`;
        const antes = { numero_nota: n.numero, data_nota: nota.data_nota, fornecedor: nota.fornecedor };
        const corpo = { numero_nota: n.numero, data_nota: data, fornecedor: forn };
        if (n.tipo === 'retorno') {
          const s = g.querySelector('#edSaida').value.replace(/[.\s]/g, '');
          corpo.numero_nota_saida = s || null; corpo.informacoes_adicionais = nota.informacoes_adicionais;
          antes.numero_nota_saida = nota.numero_nota_saida; antes.informacoes_adicionais = nota.informacoes_adicionais;
        }
        if (!(await FL.api('PUT', url, corpo))) return false;
        await recarregar();
        FL.toast(`Nota ${n.numero} salva.`, { desfazer: async () => { if (await FL.api('PUT', url, antes)) recarregar(); } });
        return true;
      } });
  }

  function formApagar(n) {
    let efeito = 'Ela sai das listas e dos números da tela.';
    if (n.tipo === 'retorno' && n.saida_existe) efeito = `A saída ${n.saida} volta para "Aguardando retorno"${n.dias != null ? '' : ''} e entra de novo no alerta da zincagem por e-mail.`;
    if (n.tipo === 'saida' && n.retornos.length) efeito = `${FL.plural(n.retornos.length, 'O retorno ligado', 'Os retornos ligados')} (${n.retornos.map((r) => r.numero).join(', ')}) ficam como "Saída não lançada".`;
    FL.modal({ titulo: `Apagar a nota ${n.numero}?`, perigo: true, botao: 'Apagar nota',
      html: `<p>${NOME_TIPO[n.tipo]} · ${esc(n.fornecedor || '')} · ${FL.data(n.data)}. ${esc(efeito)} Os itens e o PDF ficam guardados: logo depois aparece um botão <b>Desfazer</b>, e importar o PDF de novo também traz a nota de volta.</p>`,
      aoConfirmar: async () => {
        if (!(await FL.api('DELETE', `/api/v2/terceirizacao/${n.tipo}/${encodeURIComponent(n.numero)}`))) return false;
        delete st.abertos[chave(n)];
        await recarregar();
        FL.toast(`Nota ${n.numero} apagada.`, { desfazer: async () => { if (await FL.api('POST', `/api/v2/terceirizacao/${n.tipo}/${encodeURIComponent(n.numero)}/restaurar`)) recarregar(); } });
        return true;
      } });
  }

  async function marcarAcabamento(itemId, acab, k) {
    const d = st.detalhes[k];
    const it = d && d.itens.find((i) => String(i.id) === String(itemId));
    const antes = (it && it.acabamento) || 'GE';
    if (antes.toUpperCase() === acab) return;
    if (!(await FL.api('PUT', `/api/terceirizacao/item/${itemId}/acabamento`, { acabamento: acab }))) return;
    await recarregar();
    FL.toast(`Item ${it ? it.codigo_produto : ''} volta ${acab}.`, { desfazer: async () => { if (await FL.api('PUT', `/api/terceirizacao/item/${itemId}/acabamento`, { acabamento: antes.toUpperCase() })) recarregar(); } });
  }

  function abrirFiltros() {
    const per = Object.assign({}, st.periodo);
    const extra = `<section style="display:flex;flex-direction:column;gap:10px;padding:16px 0;border-bottom:1px solid var(--c3)">
      <h3 style="margin:0;font-size:12px;letter-spacing:.06em">PERÍODO (DATA DA NOTA)</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="campo"><label for="tzDe">De</label><input id="tzDe" type="date" value="${esc(per.de || '')}"></div>
      <div class="campo"><label for="tzAte">Até</label><input id="tzAte" type="date" value="${esc(per.ate || '')}"></div></div></section>`;
    const g = FL.gavetaFiltros({ sobre: 'TERCEIRIZAÇÃO', defs: DEFS, itens: daAba().filter(passaBusca), marcados: st.filtros, nomeItens: 'notas', extraHtml: extra,
      aoMudar: (m) => { st.filtros = m; st.limite = POR_PAGINA; desenhar(); } });
    g.addEventListener('change', (e) => {
      if (!['tzDe', 'tzAte'].includes(e.target.id)) return;
      st.periodo = { de: g.querySelector('#tzDe').value, ate: g.querySelector('#tzAte').value };
      desenhar();
    });
  }

  async function exportar() {
    const fs = st.filtros.forn || [];
    FL.toast('Gerando a planilha…');
    const r = await FL.api('GET', '/api/terceirizacao/exportar' + (fs.length === 1 ? '?fornecedor=' + encodeURIComponent(fs[0]) : ''), null, { blob: true });
    if (r) FL.baixarArquivo(r.blob, r.nome || 'flowlog_terceirizacao.xlsx');
  }

  // ------------------------------------------------------------------
  function ligarEventos() {
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; st.limite = POR_PAGINA; desenhar(); return; }
      if (t.dataset.cartao) {
        const c = t.dataset.cartao;
        if (c === 'aguardando') st.aba = 'aguardando';
        else if (c === 'pares') st.aba = 'pares';
        else if (c === 'mes') { st.aba = 'retornos'; st.periodo = { de: st.hoje.slice(0, 8) + '01', ate: '' }; }
        else if (c === 'pendentes') { st.aba = 'todos'; st.filtros = Object.assign({}, st.filtros, { conf: ['Sem PDF', 'Sem ligação', 'Saída não lançada', 'Peso não bate', 'Item sem peso no catálogo', 'Há mais de ' + st.diasAlerta + ' dias'] }); }
        st.limite = POR_PAGINA; desenhar(); return;
      }
      if (t.dataset.abrir) { const k = t.dataset.abrir; st.abertos[k] = !st.abertos[k]; desenhar(); if (st.abertos[k] && !st.detalhes[k]) carregarDetalhe(k); return; }
      if (t.dataset.ir) { irPara(t.dataset.ir); return; }
      if (t.dataset.acab) { marcarAcabamento(t.dataset.item, t.dataset.acab, t.dataset.k); return; }
      if (t.dataset.ordenar) { const c = t.dataset.ordenar; st.ordem = st.ordem.campo === c ? { campo: c, desc: !st.ordem.desc } : { campo: c, desc: c === 'data' || c === 'peso' }; desenhar(); return; }
      if (t.dataset.acao) {
        const n = achar(t.dataset.k);
        if (!n) return;
        if (t.dataset.acao === 'editar') formEditar(n);
        if (t.dataset.acao === 'apagar') formApagar(n);
        return;
      }
      if ('importar' in t.dataset) { formImportar(); return; }
      if ('manual' in t.dataset) { formManual(); return; }
      if ('exportar' in t.dataset) { exportar(); return; }
      if ('mais' in t.dataset) { st.limite += POR_PAGINA; desenhar(); return; }
      if ('abrirFiltros' in t.dataset) { abrirFiltros(); return; }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); desenhar(); return; }
      if ('tirarPeriodo' in t.dataset) { st.periodo = {}; desenhar(); return; }
      if ('limparFiltros' in t.dataset) { st.filtros = {}; st.periodo = {}; st.q = ''; const bq = document.getElementById('flBuscaTopo'); if (bq) bq.value = ''; desenhar(); }
    });
    el.addEventListener('change', (e) => { if (e.target.id === 'tzArqLote') { importarLote(e.target.files); e.target.value = ''; } });
  }

  FL.telas.terceirizacao = {
    montar: async function (alvo) {
      el = alvo;
      st = { aba: 'todos', filtros: {}, periodo: {}, q: '', abertos: {}, detalhes: {}, ordem: { campo: 'data', desc: true }, limite: POR_PAGINA,
        dados: [], resumo: {}, diasAlerta: 5, fornecedores: [], carregado: false, hoje: FL.hojeISO() };
      ligarEventos();
      desenhar();
      await carregar();
      desenhar();
    },
    buscar: function (q) { if (!st) return; st.q = q; st.limite = POR_PAGINA; desenhar(); }
  };
})();
