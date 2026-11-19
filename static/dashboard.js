/* FlowLog v2 — Dashboard: Agora · Histórico (Rian e Guilherme; atrás da senha de administrador) */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  // Cores: série única em preto (marca); tipos de entrega nas 3 primeiras cores validadas da paleta de gráficos
  const COR_TIPO = { Entrega: '#2a78d6', Transportadora: '#eb6834', Retira: '#1baf7a' };
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const PERIODOS = [['mes', 'Este mês'], ['3m', 'Últimos 3 meses'], ['6m', 'Últimos 6 meses'], ['ano', 'Este ano']];

  // Filtros: cada um vale só nas seções em que faz sentido
  const FILTROS = [
    { id: 'vendedor', titulo: 'VENDEDOR', opc: 'vendedores' },
    { id: 'tipo', titulo: 'TIPO DE ENTREGA', opc: 'tipos' },
    { id: 'estado', titulo: 'ESTADO', opc: 'estados' },
    { id: 'cliente', titulo: 'CLIENTE', opc: 'clientes', busca: true },
    { id: 'fornecedor', titulo: 'FORNECEDOR DA ZINCAGEM', opc: 'fornecedores' }
  ];
  const VALE = {
    'ag-vend': ['vendedor', 'tipo', 'estado', 'cliente'], 'ag-tipo': ['vendedor', 'tipo', 'estado', 'cliente'], 'ag-lista': ['vendedor', 'tipo', 'estado', 'cliente'],
    'h-pont': ['vendedor', 'tipo', 'estado', 'cliente'], 'h-etapas': ['vendedor', 'tipo', 'estado', 'cliente'], 'h-vendas': ['vendedor', 'estado', 'cliente'],
    'h-zinc': ['fornecedor'], 'h-cob': ['vendedor', 'estado', 'cliente'], 'h-pv': ['vendedor', 'tipo', 'estado', 'cliente'], 'h-fup': ['vendedor', 'tipo', 'estado', 'cliente']
  };
  function notaFiltro(id) {
    const ativos = FILTROS.filter((f) => (st.filtros[f.id] || []).length);
    if (!ativos.length || !VALE[id]) return '';
    const sim = ativos.filter((f) => VALE[id].includes(f.id)), nao = ativos.filter((f) => !VALE[id].includes(f.id));
    return [sim.length ? 'Filtrado' : '', nao.length ? 'sem filtro de ' + nao.map((f) => f.titulo.toLowerCase()).join(', ') : ''].filter(Boolean).join(' · ');
  }

  let el, st;
  const mesTxt = (m) => MESES[Number(m.slice(5, 7)) - 1] + '/' + m.slice(2, 4);
  const pct = (v) => (v == null ? '—' : FL.num(v, v % 1 ? 1 : 0) + '%');
  const dias = (v) => (v == null ? '—' : FL.num(v, v % 1 ? 1 : 0) + (v === 1 ? ' dia' : ' dias'));
  const kg = (v) => (v == null ? '—' : v >= 1000 ? FL.num(v / 1000, 1) + ' t' : FL.num(v, 0) + ' kg');
  function brlCurto(v) {
    if (v == null) return '—';
    if (Math.abs(v) >= 1e6) return 'R$ ' + FL.num(v / 1e6, 2) + ' mi';
    if (Math.abs(v) >= 1e4) return 'R$ ' + FL.num(v / 1e3, 0) + ' mil';
    return FL.brl(v);
  }

  // ------------------------------------------------------------------
  // Gráficos (SVG simples, com dica ao passar o mouse e tabela para quem precisar)
  // ------------------------------------------------------------------
  function tabela(cols, linhas) {
    return `<details class="dash-tab"><summary>Ver tabela</summary><div style="overflow-x:auto"><table class="tabela-interna"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map((l) => `<tr>${l.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  }
  // Colunas verticais (uma série): meses
  function colunas(dados, fmt, opc) {
    opc = opc || {};
    if (!dados.length) return '<p class="dash-vazio">Sem dados no período.</p>';
    const W = 640, H = 200, base = 170, topo = 18, n = dados.length;
    dados = dados.map((d) => Object.assign({}, d, { v: d.v || 0, vazio: d.v == null }));
    const max = Math.max(...dados.map((d) => d.v), 0) || 1;
    const banda = (W - 40) / n, larg = Math.min(24, banda * 0.6);
    const ticks = [0, max / 2, max];
    const barras = dados.map((d, i) => {
      const x = 40 + i * banda + (banda - larg) / 2;
      const h = Math.max(d.v > 0 ? 2 : 0, (d.v / max) * (base - topo));
      const y = base - h;
      const r = Math.min(4, h);
      const path = h ? `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + larg - r} Q${x + larg},${y} ${x + larg},${y + r} V${base} Z` : '';
      return `<g class="dash-alvo" data-tip="${esc(d.r + ': ' + (d.vazio ? '—' : fmt(d.v)))}"><rect x="${40 + i * banda}" y="${topo}" width="${banda}" height="${base - topo}" fill="transparent"></rect>
        <path d="${path}" fill="${opc.cor || '#000'}"></path>
        <text x="${x + larg / 2}" y="${base + 18}" text-anchor="middle" class="dash-eixo">${esc(d.r)}</text></g>`;
    }).join('');
    const ult = dados[n - 1];
    return `<svg viewBox="0 0 ${W} ${H}" class="dash-svg" role="img" aria-label="${esc(opc.rotulo || '')}">
      ${ticks.map((t) => { const y = base - (t / max) * (base - topo); return `<line x1="40" x2="${W}" y1="${y}" y2="${y}" class="dash-grade"></line><text x="34" y="${y + 4}" text-anchor="end" class="dash-eixo">${esc(opc.eixo ? opc.eixo(t) : fmt(t))}</text>`; }).join('')}
      ${barras}
      <text x="${40 + (n - 1) * banda + banda / 2}" y="${base - ((ult.v / max) * (base - topo)) - 6}" text-anchor="middle" class="dash-rot">${esc(fmt(ult.v))}</text>
    </svg>${tabela([opc.colR || 'Mês', opc.colV || 'Valor'], dados.map((d) => [d.r, fmt(d.v)]))}`;
  }
  // Linha de % por mês (uma ou várias séries, 0–100)
  function linhaPct(series, rotulos, opc) {
    opc = opc || {};
    if (!rotulos.length) return '<p class="dash-vazio">Sem dados no período.</p>';
    const W = 640, H = 210, base = 180, topo = 14, esq = 40, n = rotulos.length;
    const passo = n > 1 ? (W - esq - 20) / (n - 1) : 0;
    const X = (i) => esq + 10 + i * passo, Y = (v) => base - (v / 100) * (base - topo);
    const grade = [0, 50, 100].map((t) => `<line x1="${esq}" x2="${W}" y1="${Y(t)}" y2="${Y(t)}" class="dash-grade"></line><text x="${esq - 6}" y="${Y(t) + 4}" text-anchor="end" class="dash-eixo">${t}%</text>`).join('');
    const linhas = series.map((s) => {
      const pts = s.v.map((v, i) => (v == null ? null : [X(i), Y(v)])).filter(Boolean);
      return `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${s.cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
    }).join('');
    const alvos = rotulos.map((r, i) => `<g class="dash-alvo" data-tip="${esc(r + ' · ' + series.map((s) => (series.length > 1 ? s.nome + ' ' : '') + pct(s.v[i])).join(' · '))}">
      <rect x="${X(i) - Math.max(passo, 30) / 2}" y="${topo}" width="${Math.max(passo, 30)}" height="${base - topo}" fill="transparent"></rect>
      ${series.map((s) => (s.v[i] == null ? '' : `<circle cx="${X(i)}" cy="${Y(s.v[i])}" r="4" fill="${s.cor}" stroke="#fff" stroke-width="2"></circle>`)).join('')}
      <text x="${X(i)}" y="${base + 18}" text-anchor="middle" class="dash-eixo">${esc(r)}</text></g>`).join('');
    const leg = series.length > 1 ? `<div class="dash-leg">${series.map((s) => `<span><i style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>` : '';
    return `${leg}<svg viewBox="0 0 ${W} ${H}" class="dash-svg" role="img" aria-label="${esc(opc.rotulo || '')}">${grade}${linhas}${alvos}</svg>
      ${tabela(['Mês'].concat(series.map((s) => s.nome)), rotulos.map((r, i) => [r].concat(series.map((s) => pct(s.v[i])))))}`;
  }
  // Barras horizontais (ranking) com o valor escrito no fim
  function barrasH(dados, fmt, opc) {
    opc = opc || {};
    if (!dados.length) return '<p class="dash-vazio">Sem dados.</p>';
    const max = Math.max(...dados.map((d) => d.v), 0) || 1;
    return `<div class="dash-barras">${dados.map((d) => `<div class="dash-barra dash-alvo" data-tip="${esc(d.r + ': ' + fmt(d.v) + (d.extra ? ' · ' + d.extra : ''))}">
      <span class="n">${esc(d.r)}</span><span class="t"><i style="width:${Math.max(1, (d.v / max) * 100)}%;background:${d.cor || '#000'}"></i></span><b>${esc(fmt(d.v))}</b></div>`).join('')}</div>
      ${opc.semTabela ? '' : tabela([opc.colR || 'Nome', opc.colV || 'Valor'], dados.map((d) => [d.r, fmt(d.v)]))}`;
  }
  const tile = (v, r, s, cor) => `<div class="fl-cartao" style="cursor:default"><span class="v" style="${cor ? 'color:' + cor : ''}">${v}</span><span class="r">${esc(r)}</span>${s ? `<span class="s">${esc(s)}</span>` : ''}</div>`;
  const secao = (id, titulo, corpo, nota) => {
    const f = notaFiltro(id);
    const n = [nota, f].filter(Boolean).join(' · ');
    return `<section class="fl-secao dash-secao" id="${id}"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline"><h2>${esc(titulo)}</h2>${n ? `<span class="dash-nota${f.startsWith('Filtrado') ? ' filtrado' : ''}">${esc(n)}</span>` : ''}</div>${corpo}</section>`;
  };
  const bloco = (titulo, corpo) => `<div class="dash-bloco"><h3>${esc(titulo)}</h3>${corpo}</div>`;

  // ------------------------------------------------------------------
  function desenhar() {
    const cab = `<div class="fl-cabeca fl-entra"><div class="txt"><h1>Dashboard</h1></div>
      ${st.aba === 'hist' ? `<div class="fl-acoes-topo"><div class="seg" role="group" aria-label="Período" style="grid-template-columns:repeat(4,auto)">${PERIODOS.map((p) => `<button type="button" data-periodo="${p[0]}" aria-pressed="${p[0] === st.periodo}">${p[1]}</button>`).join('')}</div></div>` : ''}</div>`;
    const abas = FL.htmlAbas([{ id: 'agora', rotulo: 'Agora' }, { id: 'hist', rotulo: 'Histórico' }], st.aba, 'Abas do dashboard');
    const barra = `<div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px"><div class="fl-barra-abas">${abas}${FL.botaoFiltros(st.filtros)}</div>${FL.htmlChipsAtivos(FILTROS, st.filtros)}</div>`;
    if (!st.d) { el.innerHTML = cab + barra + '<div class="carregando"><div class="esqueleto"></div></div>'; return; }
    el.innerHTML = cab + barra + (st.aba === 'agora' ? agora(st.d.agora) : historico(st.d));
  }

  function agora(a) {
    return `<div class="fl-cartoes fl-entra d1 dash-6">
        ${tile(FL.num(a.atrasados), 'Pedidos atrasados', 'produção', a.atrasados ? 'var(--alerta)' : '')}
        ${tile(FL.num(a.vencem), 'Vencem em 2 dias úteis', 'ainda não faturados')}
        ${tile(FL.num(a.faturados_hoje), 'Faturados hoje', '')}
        ${tile(kg(a.zinc_peso), 'No fornecedor (zincagem)', FL.plural(a.zinc_saidas, 'saída', 'saídas') + ' sem retorno')}
        ${tile(brlCurto(a.boletos_valor), 'Boletos em aberto', FL.plural(a.boletos_qtd, 'boleto', 'boletos'))}
        ${tile(FL.num(a.posvenda_abertos), 'Pós-venda abertos', a.posvenda_vencidos ? a.posvenda_vencidos + ' com prazo vencido' : '', a.posvenda_vencidos ? 'var(--alerta)' : '')}
      </div>
      <div class="dash-grade2 fl-entra d2">
        ${secao('ag-vend', 'Atrasados por vendedor', barrasH(a.atrasados_por_vendedor.map((x) => ({ r: x.nome, v: x.qtd })), (v) => FL.num(v), { colR: 'Vendedor', colV: 'Atrasados' }))}
        ${secao('ag-tipo', 'Atrasados por tipo de entrega', barrasH(a.atrasados_por_tipo.map((x) => ({ r: x.tipo, v: x.qtd, cor: COR_TIPO[x.tipo] })), (v) => FL.num(v), { colR: 'Tipo', colV: 'Atrasados' }))}
      </div>
      ${secao('ag-lista', 'Mais atrasados', a.mais_atrasados.length ? `<div style="overflow-x:auto"><table class="tabela-interna"><thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>Tipo</th><th>Prometida</th><th style="text-align:right">Atraso</th></tr></thead><tbody>
        ${a.mais_atrasados.map((p) => `<tr><td class="nw"><b>${esc(p.pedido)}</b></td><td>${esc(p.cliente)}</td><td>${esc(p.vendedor || '—')}</td><td>${esc(p.tipo)}</td><td class="nw">${FL.data(p.prometida)}</td><td class="nw" style="text-align:right;color:var(--alerta);font-weight:700">${FL.plural(p.dias, 'dia útil', 'dias úteis')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dash-vazio">Nenhum pedido atrasado.</p>')}`;
  }

  function historico(d) {
    const p = d.pontualidade, v = d.vendas, z = d.zincagem, c = d.cobranca, pv = d.posvenda;
    const meses = p.por_mes.map((m) => mesTxt(m.mes));
    const tipos = ['Entrega', 'Transportadora', 'Retira'];
    const atalhos = [['h-pont', 'Pontualidade'], ['h-etapas', 'Tempos'], ['h-vendas', 'Vendas'], ['h-zinc', 'Zincagem'], ['h-cob', 'Cobrança'], ['h-pv', 'Pós-venda'], ['h-fup', 'FUP']];
    return `<div class="chips fl-entra d1">${atalhos.map((a) => `<a class="chip" href="#${a[0]}" data-ir="${a[0]}" style="text-decoration:none">${a[1]}</a>`).join('')}</div>
      <div class="fl-cartoes fl-entra d1 dash-5">
        ${tile(pct(p.pct), 'Pontualidade', (p.pct_ate_data != null ? pct(p.pct_ate_data) + ' até a data prometida · ' : '') + FL.plural(p.pedidos, 'pedido', 'pedidos'))}
        ${tile(brlCurto(v.total), 'Vendas faturadas', FL.plural(v.nfs, 'NF', 'NFs'))}
        ${tile(dias(z.lead_mediana), 'Zincagem (ida e volta)', 'mediana · ' + FL.plural(z.pares, 'par', 'pares'))}
        ${tile(dias(c.atraso_medio_pagamento), 'Atraso médio no pagamento', 'boletos pagos com atraso')}
        ${tile(FL.num(pv.casos), 'Casos de pós-venda', pv.casos ? dias(pv.tempo_medio_solucao) + ' para resolver (média)' : '')}
      </div>
      ${secao('h-pont', 'Pontualidade', `
        <div class="dash-grade2">
          ${bloco('% faturado no prazo, por mês', linhaPct([{ nome: 'Geral', cor: '#000', v: p.por_mes.map((m) => m.pct) }], meses, { rotulo: 'Pontualidade por mês' }))}
          ${bloco('Por tipo de entrega', linhaPct(tipos.map((t) => ({ nome: t, cor: COR_TIPO[t], v: p.por_mes.map((m) => (m.tipos[t] == null ? null : m.tipos[t])) })), meses, { rotulo: 'Pontualidade por tipo' }))}
        </div>
        ${bloco('Por vendedor', `<div style="overflow-x:auto"><table class="tabela-interna"><thead><tr><th>Vendedor</th><th style="text-align:right">Pedidos</th><th style="text-align:right">No prazo</th><th style="text-align:right">Prazo dado (média)</th><th style="text-align:right">Atraso quando atrasa</th></tr></thead><tbody>
          ${p.por_vendedor.map((x) => `<tr><td>${esc(x.nome)}</td><td style="text-align:right">${FL.num(x.pedidos)}</td><td style="text-align:right"><b style="${x.pct < 80 ? 'color:var(--alerta)' : ''}">${pct(x.pct)}</b></td><td style="text-align:right">${FL.plural(x.prazo_medio, 'dia útil', 'dias úteis')}</td><td style="text-align:right">${dias(x.atraso_medio)}</td></tr>`).join('')}</tbody></table></div>`)}
        <p class="dash-nota">Retira: faturado até o dia prometido. Entrega e Transportadora: faturado até 1 dia útil antes.</p>`)}
      ${secao('h-etapas', 'Tempo de cada etapa (mediana)', `<div style="overflow-x:auto"><table class="tabela-interna dash-etapas"><thead><tr><th>Tipo</th><th>Pedido → faturamento</th><th>Faturamento → entrega</th><th>NFs com canhoto</th></tr></thead><tbody>
        ${d.etapas.map((e) => `<tr><td><i class="dash-ponto" style="background:${COR_TIPO[e.tipo]}"></i>${esc(e.tipo)}</td>${['emissao_faturamento', 'faturamento_entrega'].map((k) => `<td><span class="dash-mini"><i style="width:${Math.min(100, (e[k] || 0) / 15 * 100)}%;background:${COR_TIPO[e.tipo]}"></i></span>${dias(e[k])}</td>`).join('')}
          <td><span class="dash-mini"><i style="width:${e.com_canhoto || 0}%;background:${COR_TIPO[e.tipo]}"></i></span>${pct(e.com_canhoto)}</td></tr>`).join('')}</tbody></table></div>`, 'dias úteis')}
      ${secao('h-vendas', 'Vendas', `
        <div class="dash-grade2">
          ${bloco('Faturamento por mês', colunas(v.por_mes.map((m) => ({ r: mesTxt(m.mes), v: m.valor })), brlCurto, { rotulo: 'Faturamento por mês', colV: 'Faturamento' }))}
          ${bloco('Por vendedor', barrasH(v.por_vendedor.map((x) => ({ r: x.nome, v: x.valor })), brlCurto, { colR: 'Vendedor', colV: 'Faturamento' }))}
        </div>
        <div class="dash-grade2">
          ${bloco('10 maiores clientes', barrasH(v.top_clientes.map((x) => ({ r: x.nome, v: x.valor, extra: x.pct + '% do total' })), brlCurto, { colR: 'Cliente', colV: 'Faturamento' }))}
          ${bloco('Por Estado', barrasH(v.por_estado.map((x) => ({ r: x.uf, v: x.valor })), brlCurto, { colR: 'Estado', colV: 'Faturamento' }))}
        </div>
        <div class="dash-grade2">
          ${bloco('Por grupo de estoque', barrasH(v.por_grupo.map((x) => ({ r: x.nome, v: x.valor })), brlCurto, { colR: 'Grupo', colV: 'Faturamento' }))}
        </div>`)}
      ${secao('h-zinc', 'Zincagem', `
        <div class="dash-grade2">
          ${bloco('Peso enviado por mês', colunas(z.por_mes.map((m) => ({ r: mesTxt(m.mes), v: m.peso })), kg, { rotulo: 'Peso enviado por mês', colV: 'Peso' }))}
          ${bloco('Ida e volta por mês (mediana)', colunas(z.por_mes.map((m) => ({ r: mesTxt(m.mes), v: m.lead })), dias, { rotulo: 'Lead time por mês', colV: 'Dias', eixo: (t) => FL.num(t, 0) }))}
        </div>
        ${bloco('Por fornecedor', `<div style="overflow-x:auto"><table class="tabela-interna"><thead><tr><th>Fornecedor</th><th style="text-align:right">Pares</th><th style="text-align:right">Ida e volta</th><th style="text-align:right">Peso</th><th style="text-align:right">R$/kg</th></tr></thead><tbody>
          ${z.por_fornecedor.map((x) => `<tr><td>${esc(x.nome)}</td><td style="text-align:right">${FL.num(x.pares)}</td><td style="text-align:right">${dias(x.lead)}</td><td style="text-align:right">${kg(x.peso)}</td><td style="text-align:right">${x.preco_kg != null ? FL.brl(x.preco_kg) : '—'}</td></tr>`).join('')}</tbody></table></div>`)}`, 'dias corridos')}
      ${secao('h-cob', 'Cobrança', `
        <div class="dash-grade2">
          ${bloco('Em aberto por tempo de atraso', barrasH(c.faixas.map((x) => ({ r: x.faixa, v: x.valor, extra: FL.plural(x.qtd, 'boleto', 'boletos') })), brlCurto, { colR: 'Atraso', colV: 'Em aberto' }))}
          ${bloco('Clientes que mais atrasam', `<div style="overflow-x:auto"><table class="tabela-interna"><thead><tr><th>Cliente</th><th style="text-align:right">Boletos</th><th style="text-align:right">Em aberto</th><th style="text-align:right">Atraso médio</th></tr></thead><tbody>
            ${c.clientes.map((x) => `<tr><td>${esc(x.nome)}</td><td style="text-align:right">${FL.num(x.boletos)}</td><td style="text-align:right">${brlCurto(x.aberto)}</td><td style="text-align:right">${dias(x.atraso_medio)}</td></tr>`).join('')}</tbody></table></div>`)}
        </div>`)}
      ${secao('h-pv', 'Pós-venda', pv.casos ? `
        <div class="dash-grade2">
          ${bloco('Casos por mês', colunas(pv.por_mes.map((m) => ({ r: mesTxt(m.mes), v: m.qtd })), (x) => FL.num(x), { rotulo: 'Casos por mês', colV: 'Casos', eixo: (t) => FL.num(t, 0) }))}
          ${bloco('Por causa', barrasH(pv.por_causa.map((x) => ({ r: x.nome, v: x.qtd })), (x) => FL.num(x), { colR: 'Causa', colV: 'Casos' }))}
        </div>
        <div class="dash-grade2">
          ${bloco('Por problema', barrasH(pv.por_problema.map((x) => ({ r: x.nome, v: x.qtd })), (x) => FL.num(x), { colR: 'Problema', colV: 'Casos' }))}
          ${bloco('Resumo', `<div class="dash-resumo"><span>Abertos agora<b>${FL.num(pv.abertos)}</b></span><span>Tempo médio para resolver<b>${dias(pv.tempo_medio_solucao)}</b></span><span>Abertos fora do prazo de 30 dias<b>${pct(pv.fora_prazo_pct)}</b></span><span>Recusados<b>${pct(pv.recusados_pct)}</b></span></div>`)}
        </div>` : '<p class="dash-vazio">Nenhum caso no período.</p>')}
      ${secao('h-fup', 'Motivos de atraso (FUP)', d.fup.registros ? barrasH(d.fup.motivos.map((x) => ({ r: x.nome, v: x.qtd })), (x) => FL.num(x), { colR: 'Motivo', colV: 'FUPs' }) : '<p class="dash-vazio">Sem FUPs no período.</p>', 'desde 19/11/2026')}`;
  }

  // ------------------------------------------------------------------
  async function carregar() {
    st.d = null; desenhar();
    const q = new URLSearchParams({ periodo: st.periodo });
    FILTROS.forEach((f) => (st.filtros[f.id] || []).forEach((v) => q.append(f.id, v)));
    const r = await FL.api('GET', '/api/v2/dashboard?' + q.toString(), null, { senha: true });
    if (r) { st.d = r; st.opcoes = r.opcoes || st.opcoes; }
    desenhar();
  }
  function abrirFiltros() {
    let m = JSON.parse(JSON.stringify(st.filtros));
    const o = st.opcoes || {};
    const g = FL.gaveta({ sobre: 'DASHBOARD', titulo: 'Filtros', html: '<div data-grupos></div>', semAutor: true, cancelar: 'Fechar', botao: 'Ver resultado',
      aoSalvar: () => { st.filtros = m; carregar(); return true; } });
    const desenharG = () => {
      g.querySelector('[data-grupos]').innerHTML = FILTROS.map((f) => {
        const vals = (o[f.opc] || []).slice();
        (m[f.id] || []).forEach((v) => { if (!vals.includes(v)) vals.push(v); });
        const busca = f.busca ? (g.querySelector('#dfBusca') || {}).value || '' : '';
        const mostra = f.busca && !busca ? vals.filter((v) => (m[f.id] || []).includes(v)) : vals.filter((v) => !busca || FL.semAcento(v).includes(FL.semAcento(busca)));
        return `<section style="display:flex;flex-direction:column;gap:10px;padding:16px 0;border-bottom:1px solid var(--c3)">
          <div style="display:flex;justify-content:space-between"><h3 style="margin:0;font-size:12px;letter-spacing:.06em">${esc(f.titulo)}</h3>
          ${(m[f.id] || []).length ? `<button type="button" class="link" style="font-size:12px" data-limpar-grupo="${f.id}">limpar</button>` : ''}</div>
          ${f.busca ? `<input id="dfBusca" type="search" placeholder="Buscar cliente" value="${esc(busca)}" autocomplete="off">` : ''}
          <div class="chips">${mostra.slice(0, 40).map((v) => `<button type="button" class="chip" data-grupo="${f.id}" data-valor="${esc(v)}" aria-pressed="${(m[f.id] || []).includes(v)}">${esc(v)}</button>`).join('')}</div></section>`;
      }).join('');
    };
    g.addEventListener('click', (e) => {
      const c = e.target.closest('[data-grupo]');
      if (c) { const l = m[c.dataset.grupo] || []; m[c.dataset.grupo] = l.includes(c.dataset.valor) ? l.filter((x) => x !== c.dataset.valor) : l.concat([c.dataset.valor]); desenharG(); return; }
      const lg = e.target.closest('[data-limpar-grupo]');
      if (lg) { m[lg.dataset.limparGrupo] = []; desenharG(); }
    });
    g.addEventListener('input', (e) => {
      if (e.target.id !== 'dfBusca') return;
      const pos = e.target.selectionStart; desenharG();
      const i = g.querySelector('#dfBusca'); i.focus(); i.setSelectionRange(pos, pos);
    });
    desenharG();
  }

  function ligarEventos() {
    el.addEventListener('click', (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; desenhar(); return; }
      if (t.dataset.periodo) { st.periodo = t.dataset.periodo; carregar(); return; }
      if ('abrirFiltros' in t.dataset) { abrirFiltros(); return; }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); carregar(); return; }
      if ('limparFiltros' in t.dataset) { st.filtros = {}; carregar(); return; }
      if (t.dataset.ir) { e.preventDefault(); const s = el.querySelector('#' + t.dataset.ir); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    // dica ao passar o mouse (ou tocar) num ponto, barra ou coluna
    const dica = document.createElement('div');
    dica.className = 'dash-dica'; dica.hidden = true; document.body.appendChild(dica);
    const mostrar = (e) => {
      const a = e.target.closest && e.target.closest('.dash-alvo');
      if (!a) { dica.hidden = true; return; }
      dica.textContent = a.dataset.tip; dica.hidden = false;
      const x = Math.min(window.innerWidth - dica.offsetWidth - 8, e.clientX + 12);
      dica.style.left = x + 'px'; dica.style.top = (e.clientY - dica.offsetHeight - 10) + 'px';
    };
    el.addEventListener('mousemove', mostrar);
    el.addEventListener('mouseleave', () => { dica.hidden = true; });
    el.addEventListener('touchstart', (e) => mostrar(e.touches[0] ? Object.assign({}, e.touches[0], { target: e.target }) : e), { passive: true });
  }

  FL.telas.dashboard = {
    montar: async function (alvo) {
      el = alvo;
      st = { aba: 'agora', periodo: '6m', d: null, filtros: {}, opcoes: null };
      ligarEventos();
      await carregar();
    }
  };
})();
