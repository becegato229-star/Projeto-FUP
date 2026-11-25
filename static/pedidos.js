/* FlowLog v2 — Pedidos (tela inicial): Todos · Atrasados */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  const POR_PAGINA = 150;
  const SIT_FUP = { ok: 'Ok', previsto_atraso: 'Previsto atraso', atraso: 'Atraso' };
  const CAMPOS_PERIODO = [['prometida', 'Entrega prometida'], ['emissao', 'Emissão'], ['entrega_efetiva', 'Entrega efetiva'], ['faturamento', 'Faturamento (1ª NF)']];
  const ICO_DATA = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="1"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>';
  const ICO_FUP = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8v3H8z"></path><path d="M6 4.5H5V21h14V4.5h-1"></path><path d="M8 11h8M8 15h5"></path></svg>';
  const ICO_CANC = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"></path></svg>';

  const ICO_ESPERA = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>';
  const MOTIVOS_ESPERA = ['Retira: cliente não agendou', 'Cliente pediu para segurar', 'Aguardando pagamento do cliente', 'Outro'];

  let el, st;

  // ------------------------------------------------------------------
  // Regras de exibição
  // ------------------------------------------------------------------
  const nfsValidas = (p) => p.nfs.filter((n) => !n.cancelada);
  function entregaQueVale(p) {
    if (p.entrega_efetiva) {
      const v = nfsValidas(p);
      const completa = (!v.length || v.every((n) => n.entrega)) && !p.itens_na_carteira;
      return [completa ? 'Entregue' : 'Parcial', p.entrega_efetiva];
    }
    if (p.nova_data) return ['Nova', p.nova_data];
    return ['Prometida', p.prometida];
  }
  function valorPeriodo(p, campo) {
    if (campo === 'faturamento') { const f = nfsValidas(p).map((n) => n.faturamento).filter(Boolean).sort(); return f[0] || null; }
    return p[campo] || null;
  }
  const DEFS = [
    { id: 'vendedor', titulo: 'VENDEDOR', valor: (p) => [p.vendedor || 'Sem vendedor'] },
    { id: 'uf', titulo: 'ESTADO', valor: (p) => [p.uf || 'Sem Estado'] },
    { id: 'status', titulo: 'STATUS', ordem: ['Bloqueado', 'Aprovado', 'Faturado', 'Encerrado', 'Cancelado'], valor: (p) => [p.status || 'Indefinido'] },
    { id: 'tipo', titulo: 'TIPO DE ENTREGA', ordem: ['Entrega', 'Transportadora', 'Retira', 'Desconhecido'], valor: (p) => [p.tipo] },
    { id: 'atraso', titulo: 'ATRASO', ordem: ['Atrasado', 'Sem atraso', 'Aguardando cliente', 'Com aviso de canhoto'], valor: (p) => [p.atrasado ? 'Atrasado' : 'Sem atraso'].concat(p.aguardando ? ['Aguardando cliente'] : []).concat(p.aviso ? ['Com aviso de canhoto'] : []) },
    { id: 'motivo', titulo: 'MOTIVO DO FUP', valor: (p) => [!p.fup ? 'Sem FUP' : (p.fup.situacao === 'ok' ? 'Ok' : (p.fup.motivo || 'Sem motivo'))] },
    { id: 'nfs', titulo: 'NOTAS FISCAIS', ordem: ['Sem NF', 'Uma NF', 'Várias NFs', 'Com NF cancelada'], valor: (p) => {
      const v = nfsValidas(p).length;
      return [v === 0 ? 'Sem NF' : (v === 1 ? 'Uma NF' : 'Várias NFs')].concat(p.nfs.some((n) => n.cancelada) ? ['Com NF cancelada'] : []);
    } },
    { id: 'canhoto', titulo: 'CANHOTO', ordem: ['Falta canhoto', 'Canhoto completo'], valor: (p) => { const v = nfsValidas(p); return v.length ? [v.every((n) => n.canhoto) ? 'Canhoto completo' : 'Falta canhoto'] : []; } },
    { id: 'transp', titulo: 'TRANSPORTADORA', valor: (p) => (p.transportadora && p.tipo === 'Transportadora' ? [p.transportadora] : []) },
    { id: 'pv', titulo: 'PÓS-VENDA', ordem: ['Com caso aberto'], valor: (p) => (p.posvenda_aberto ? ['Com caso aberto'] : []) },
    { id: 'cliente', titulo: 'CLIENTE', valor: (p) => [p.cliente || '—'] }
  ];

  function passaPeriodo(p) {
    const per = st.periodo;
    if (!per.de && !per.ate) return true;
    const v = valorPeriodo(p, per.campo);
    if (!v) return false;
    return (!per.de || v >= per.de) && (!per.ate || v <= per.ate);
  }
  function passaBusca(p) {
    if (!st.q) return true;
    // cada campo separado por | para "117" + "555" de campos diferentes não virar "117555"
    const alvo = [p.pedido, p.oe, p.cliente, p.cod_cliente, p.vendedor].concat(p.nfs.map((n) => n.nf)).map((c) => FL.semAcento(c).replace(/[.\s]/g, '')).join('|');
    return alvo.includes(st.q);
  }
  const daAba = () => st.dados.filter((p) => (st.aba === 'atrasados' ? p.atrasado : true));
  function filtrados() {
    const lista = daAba().filter((p) => passaBusca(p) && passaPeriodo(p) && FL.passaFiltros(p, DEFS, st.filtros));
    const o = st.ordem;
    const chave = {
      pedido: (p) => p.pedido.padStart(10, '0'), cliente: (p) => FL.semAcento(p.cliente), emissao: (p) => p.emissao || '',
      entrega: (p) => entregaQueVale(p)[1] || '', status: (p) => String(9999 - (p.dias_atraso || 0)).padStart(5, '0') + (p.status || '')
    }[o.campo] || ((p) => p.emissao || '');
    lista.sort((a, b) => { const x = chave(a), y = chave(b); return (x < y ? -1 : x > y ? 1 : 0) * (o.desc ? -1 : 1); });
    return lista;
  }

  // ------------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------------
  function desenhar() {
    if (!st.carregado) {
      el.innerHTML = cabecalho() + '<div class="fl-tabela-caixa">' + '<div class="carregando"><div class="esqueleto" style="margin:8px 0"></div><div class="esqueleto" style="margin:8px 0;width:80%"></div><div class="esqueleto" style="margin:8px 0;width:60%"></div></div></div>';
      return;
    }
    const lista = filtrados();
    const atras = lista.filter((p) => p.atrasado).length;
    const avisos = lista.filter((p) => p.aviso).length;
    const encerr = lista.filter((p) => p.status === 'Encerrado').length;
    const temPer = !!(st.periodo.de || st.periodo.ate);
    const abas = [{ id: 'todos', rotulo: 'Todos', qtd: st.dados.length }, { id: 'atrasados', rotulo: 'Atrasados', qtd: st.dados.filter((p) => p.atrasado).length, alerta: true }];
    const visiveis = lista.slice(0, st.limite);
    el.innerHTML = cabecalho() + `
      <div class="fl-cartoes fl-entra d1">
        <button type="button" class="fl-cartao" data-cartao="todos"><span class="v">${FL.num(lista.length)}</span><span class="r">Pedidos no filtro</span><span class="s">de ${FL.num(st.dados.length)} no total</span></button>
        <button type="button" class="fl-cartao" data-cartao="atrasados"><span class="v" style="color:${atras ? 'var(--alerta)' : '#000'}">${FL.num(atras)}</span><span class="r">Atraso de produção</span><span class="s">não faturado após a data prometida</span></button>
        <button type="button" class="fl-cartao" data-cartao="avisos"><span class="v" style="color:${avisos ? 'var(--alerta)' : '#000'}">${FL.num(avisos)}</span><span class="r">Avisos (sem canhoto)</span><span class="s">NF sem canhoto após o prazo</span></button>
        <button type="button" class="fl-cartao" data-cartao="encerrados"><span class="v">${FL.num(encerr)}</span><span class="r">Encerrados</span><span class="s">canhoto em todas as NFs</span></button>
      </div>
      <div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px">
        <div class="fl-barra-abas">${FL.htmlAbas(abas, st.aba, 'Abas dos pedidos')}${FL.botaoFiltros(Object.assign({}, st.filtros, temPer ? { _p: [1] } : {}))}</div>
        ${filtrosAtivosHtml()}
      </div>
      <div class="fl-tabela-caixa fl-entra d2"><table class="fl-tabela"><thead><tr>
        ${th('pedido', 'Pedido', 'emissão')}${th('cliente', 'Cliente', 'tipo de entrega')}${th('entrega', 'Entrega', 'a que vale · original')}
        ${th('status', 'Status', 'atraso')}<th>OE<small>NF</small></th><th>Motivo (FUP)<small>último registro</small></th><th class="dir">Ações</th>
      </tr></thead><tbody>
        ${visiveis.length ? visiveis.map(linha).join('') : `<tr><td colspan="7" class="vazio">${st.q || FL.qtdFiltros(st.filtros) || temPer ? 'Nenhum pedido com essa busca ou filtros. <button type="button" class="link" data-limpar-tudo>Limpar</button>' : (st.aba === 'atrasados' ? 'Nenhum pedido atrasado. Tudo em dia.' : 'Nenhum pedido ainda. Importe as planilhas em Configurações › Importar.')}</td></tr>`}
      </tbody></table></div>
      ${lista.length > st.limite ? `<button type="button" class="btn sec" style="align-self:center" data-mais>Mostrar mais ${Math.min(POR_PAGINA, lista.length - st.limite)} (de ${FL.num(lista.length - st.limite)} restantes)</button>` : ''}`;
  }

  function cabecalho() {
    return `<div class="fl-cabeca fl-entra"><div class="txt"><h1>Pedidos</h1></div>
      <div class="fl-acoes-topo"><a class="btn sec" href="#configuracoes?aba=importar">${FL.icone.enviar} Importar planilhas</a>
      <button type="button" class="btn" data-exportar>${FL.icone.baixar} Exportar Excel</button></div></div>`;
  }
  function th(campo, titulo, sub) {
    const on = st.ordem.campo === campo;
    return `<th><button type="button" data-ordenar="${campo}" style="padding:0;border:0;background:transparent;color:#fff;font-weight:700;cursor:pointer;text-align:left" aria-label="Ordenar por ${esc(titulo)}">${esc(titulo)}${on ? (st.ordem.desc ? ' ↓' : ' ↑') : ''}</button><small>${esc(sub)}</small></th>`;
  }
  function filtrosAtivosHtml() {
    let h = FL.htmlChipsAtivos(DEFS, st.filtros);
    if (st.periodo.de || st.periodo.ate) {
      const nome = CAMPOS_PERIODO.find((c) => c[0] === st.periodo.campo)[1];
      const chip = `<button type="button" class="chip" style="background:#000;color:#fff;border-color:#000;min-height:32px" data-tirar-periodo aria-label="Remover filtro de período"><span style="color:var(--verde);font-weight:700">Período:</span> ${esc(nome)} ${st.periodo.de ? 'de ' + FL.dataCurta(st.periodo.de) : ''} ${st.periodo.ate ? 'até ' + FL.dataCurta(st.periodo.ate) : ''} ${FL.icone.x}</button>`;
      h = h ? h.replace('<button type="button" class="link" data-limpar-filtros>', chip + '<button type="button" class="link" data-limpar-filtros>') : `<div class="chips" style="align-items:center"><span style="font-size:13px;font-weight:700">Filtrando por:</span>${chip}<button type="button" class="link" data-limpar-filtros>Limpar tudo</button></div>`;
    }
    return h;
  }

  function linha(p) {
    const aberto = !!st.abertos[p.pedido];
    const [rot, data] = entregaQueVale(p);
    const nfs = p.nfs;
    let statusSub = '—', corSub = 'var(--texto2)', peso = '400';
    if (p.atrasado) { statusSub = p.dias_atraso ? FL.plural(p.dias_atraso, 'dia útil', 'dias úteis') + ' de atraso' : 'Venceu hoje'; corSub = 'var(--alerta)'; peso = '700'; }
    else if (p.aviso) { statusSub = 'NF sem canhoto há ' + FL.plural(p.dias_sem_canhoto, 'dia útil', 'dias úteis'); corSub = 'var(--alerta)'; peso = '700'; }
    else if (p.status === 'Faturado' && p.itens_na_carteira) statusSub = 'Entrega parcial';
    else if (p.aguardando && ['Bloqueado', 'Aprovado'].includes(p.status)) statusSub = 'Aguardando cliente';
    const selo = { Encerrado: 'ok', Cancelado: 'contorno-alerta', Bloqueado: 'contorno', Faturado: 'preto' }[p.status] || '';
    const fup = p.fup;
    const ultFup = fup ? FL.dataCurta(fup.data) + (fup.por ? ' · ' + fup.por : '') : '';
    const podeMexer = p.status !== 'Cancelado';
    return `<tr class="${aberto ? 'aberta' : ''}">
      <td class="nw"><button type="button" class="fl-link-linha" data-abrir="${esc(p.pedido)}" aria-expanded="${aberto}" aria-label="Mostrar itens e notas do pedido ${esc(p.pedido)}">${FL.icone.seta}${esc(p.pedido)}</button><span class="sub" style="padding-left:18px">Emitido ${FL.dataCurta(p.emissao)}</span></td>
      <td><b>${esc(p.cliente || '—')}</b><span class="sub">${esc(p.tipo)}${p.tipo === 'Transportadora' && p.transportadora ? ' · ' + esc(p.transportadora) : ''}</span></td>
      <td class="nw">${data ? `<span style="font-size:12px;color:var(--texto2)">${rot}</span> <b>${FL.data(data)}</b>` : '—'}<span class="sub">${rot !== 'Prometida' && p.prometida ? 'Original ' + FL.data(p.prometida) : (p.nova_data && rot === 'Entregue' ? 'Nova ' + FL.data(p.nova_data) : '')}</span></td>
      <td><span class="selo ${selo}">${esc(p.status || '—')}</span>${p.posvenda_aberto ? ' <span class="selo contorno-alerta" title="Caso de pós-venda aberto">Pós-venda</span>' : ''}<span class="sub" style="color:${corSub};font-weight:${peso};margin-top:4px">${esc(statusSub)}</span></td>
      <td class="nw">${p.oe ? 'OE ' + esc(p.oe) : '—'}<span class="sub">${nfs.length ? nfs.map((n) => `<span style="${n.cancelada ? 'text-decoration:line-through' : ''}">${esc(n.nf)}</span>`).join(', ') : 'sem NF'}</span></td>
      <td style="max-width:260px">${esc(p.motivo_fup || '—')}<span class="sub">${esc(ultFup)}</span></td>
      <td class="dir nw"><span style="display:inline-flex;gap:6px">
        ${podeMexer ? `<button type="button" class="btn-icone" data-acao="nova" data-p="${esc(p.pedido)}" title="Nova data de entrega" aria-label="Nova data de entrega do pedido ${esc(p.pedido)}">${ICO_DATA}</button>
        <button type="button" class="btn-icone" data-acao="fup" data-p="${esc(p.pedido)}" title="Registrar FUP" aria-label="Registrar FUP do pedido ${esc(p.pedido)}">${ICO_FUP}</button>
        ${['Bloqueado', 'Aprovado'].includes(p.status) ? `<button type="button" class="btn-icone" data-acao="espera" data-p="${esc(p.pedido)}" title="${p.aguardando ? 'Aguardando cliente (desmarcar)' : 'Aguardando cliente'}" aria-label="Aguardando cliente: pedido ${esc(p.pedido)}" ${p.aguardando ? 'style="background:#000;color:#fff;border-color:#000"' : ''}>${ICO_ESPERA}</button>` : ''}
        <button type="button" class="btn-icone" data-acao="cancelar" data-p="${esc(p.pedido)}" title="Cancelar pedido" aria-label="Cancelar o pedido ${esc(p.pedido)}">${ICO_CANC}</button>` : '<span style="font-size:12px;color:var(--texto2)">cancelado</span>'}
        ${p.nfs.length ? `<button type="button" class="btn-icone" data-acao="posvenda" data-p="${esc(p.pedido)}" title="Abrir caso de pós-venda" aria-label="Abrir caso de pós-venda do pedido ${esc(p.pedido)}" style="font-size:18px;font-weight:700">+</button>` : ''}
      </span></td></tr>
      ${aberto ? `<tr class="detalhe"><td colspan="7">${detalheHtml(p)}</td></tr>` : ''}`;
  }

  function detalheHtml(p) {
    const d = st.detalhes[p.pedido];
    if (!d) return '<div class="carregando">Carregando itens e notas…</div>';
    return detalheCorpo(p, d, {});
  }
  // Também usado pela tela FUP (só leitura, com todos os FUPs)
  FL.htmlDetalhePedido = (p, d) => detalheCorpo(p, d, { leitura: true });
  function detalheCorpo(p, d, opc) {
    const validas = nfsValidas(p);
    const avisos = [];
    if (p.status === 'Cancelado') avisos.push(['aviso', `Pedido cancelado${d.data_cancelamento ? ' em ' + FL.data(d.data_cancelamento) : ''}${d.cancelado_por ? ' por ' + d.cancelado_por : ''}: ${p.motivo_cancelamento || (p.cancelado ? '—' : 'cancelado no Mega')}`]);
    if (validas.length > 1 || (validas.length && p.itens_na_carteira)) avisos.push(['aviso info', `Entrega parcial: ${FL.plural(validas.length, 'NF', 'NFs')}${p.itens_na_carteira ? ' e ' + FL.plural(p.itens_na_carteira, 'item ainda na carteira', 'itens ainda na carteira') : ''}`]);
    if (p.aguardando) avisos.push(['aviso info', `Aguardando cliente desde ${FL.data(p.aguardando.desde)}${p.aguardando.por ? ' (' + p.aguardando.por + ')' : ''}: ${p.aguardando.motivo}. Não conta como atraso.`]);
    if (p.nova_data) avisos.push(['aviso info', `Nova data ${FL.data(p.nova_data)}${d.nova_data_quem ? ' · pedida por: ' + d.nova_data_quem : ''}${d.nova_data_motivo ? ' · ' + d.nova_data_motivo : ''}${d.nova_data_por ? ' · registrada por ' + d.nova_data_por : ''}`]);
    const dados = [['Vendedor', d.vendedor || 'não informado (vem da Carteira de pedidos ou do Dashboard de vendas)'], ['Transportadora', d.transportadora || (p.tipo === 'Transportadora' ? 'não informada' : p.tipo)], ['Situação no Mega', p.situacao_erp || '—']];
    if (d.uf) dados.push(['Estado', d.uf + (d.municipio ? ' · ' + d.municipio : '')]);
    if (opc.leitura) dados.unshift(['Cliente', p.cliente || '—'], ['Emissão', FL.data(p.emissao)], ['Prometida', FL.data(p.prometida)], ['Tipo', p.tipo || '—'], ['OE', p.oe || '—'], ['Status', p.status || '—']);
    const fat = d.itens_faturados || [];
    const faturados = fat.length ? `<table class="tabela-interna"><thead><tr><th>NF</th><th>Código</th><th>Descrição</th><th class="dir" style="text-align:right">Qtd.</th><th>Un.</th><th>Emissão</th></tr></thead><tbody>
      ${fat.map((i) => `<tr><td class="nw"><b>${esc(i.nf)}</b></td><td class="nw">${esc(i.codigo || '—')}</td><td>${esc(i.descricao || '—')}</td><td style="text-align:right" class="nw">${FL.num(i.quantidade, i.quantidade % 1 ? 2 : 0)}</td><td>${esc(i.unidade || '')}</td><td class="nw">${FL.dataCurta(i.emissao)}</td></tr>`).join('')}</tbody></table>` : '';
    const itens = d.itens.length ? `<table class="tabela-interna"><thead><tr><th>Código</th><th>Descrição</th><th class="dir" style="text-align:right">Qtd.</th><th>Un.</th><th>Entrega</th><th>Situação</th></tr></thead><tbody>
      ${d.itens.map((i) => `<tr><td class="nw">${esc(i.codigo || '—')}</td><td>${esc(i.descricao || '—')}</td><td style="text-align:right" class="nw">${FL.num(i.quantidade, i.quantidade % 1 ? 2 : 0)}</td><td>${esc(i.unidade || '')}</td><td class="nw">${FL.dataCurta(i.entrega)}</td>
        <td>${i.na_carteira ? '<span class="selo">Na carteira</span>' : '<span class="selo ok">Saiu da carteira</span>'}</td></tr>`).join('')}</tbody></table>`
      : (fat.length ? '<p style="margin:0;font-size:14px;color:var(--texto2)">Sem itens na Carteira.</p>'
        : '<p class="aviso info">Os itens aparecem quando a Carteira de pedidos (itens pendentes) ou o Dashboard de vendas (itens faturados) for importado (Configurações › Importar).</p>');
    const nfs = d.nfs.length ? `<table class="tabela-interna"><thead><tr><th>NF</th><th>Faturamento</th><th>Entrega</th><th>Canhoto</th><th></th></tr></thead><tbody>
      ${d.nfs.map((n) => `<tr><td class="nw" style="${n.cancelada ? 'text-decoration:line-through;color:var(--texto2)' : ''}"><b>${esc(n.nf)}</b>${n.cancelada ? ` <span class="selo contorno-alerta" style="text-decoration:none">cancelada</span>` : ''}</td>
        <td class="nw">${FL.data(n.faturamento)}</td><td class="nw">${FL.data(n.entrega)}</td>
        <td>${n.cancelada ? `<span style="font-size:12px;color:var(--texto2)">${esc(n.cancelada_motivo || '')}${n.cancelada_por ? ' · ' + esc(n.cancelada_por) : ''}</span>` : (n.canhoto ? '<span class="selo ok">Recebido</span>' : '<span class="selo alerta">Falta</span>')}${(n.fotos || []).length ? ' ' + FL.verCanhoto(n.fotos) : ''}</td>
        <td class="nw" style="text-align:right">${n.fora_da_planilha ? '<span style="font-size:12px;color:var(--texto2)">não veio na última planilha</span>' : ''}<button type="button" class="link" style="font-size:12px;${n.fora_da_planilha || opc.leitura ? 'display:none' : ''}" data-nf-cancelar="${esc(n.nf)}" data-p="${esc(p.pedido)}" data-desfazer="${n.cancelada ? '1' : ''}" title="${n.cancelada ? 'Esta NF não está cancelada' : 'Marcar esta NF como cancelada'}">${n.cancelada ? 'desmarcar' : 'cancelada?'}</button></td></tr>`).join('')}</tbody></table>`
      : '<p style="margin:0;font-size:14px;color:var(--texto2)">Sem NF.</p>';
    const fups = opc.leitura ? d.fups : d.fups.slice(0, 3);
    return `<div style="display:flex;flex-direction:column;gap:14px">
      ${avisos.map((a) => `<p class="${a[0]}">${esc(a[1])}</p>`).join('')}
      ${p.cancelado && !opc.leitura ? `<button type="button" class="link" style="align-self:flex-start" data-descancelar="${esc(p.pedido)}">Foi engano? Desfazer o cancelamento (pede a senha de administrador)</button>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px 24px;font-size:13px;color:var(--texto2)">${dados.map((x) => `<span>${esc(x[0])}: <b style="color:#000">${esc(x[1])}</b></span>`).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start">
        <div style="flex:2 1 460px;min-width:0;display:flex;flex-direction:column;gap:8px"><span class="rotulo-secao">ITENS DO PEDIDO</span><div style="overflow-x:auto">${itens}</div>
          ${faturados ? `<span class="rotulo-secao" style="margin-top:8px">ITENS FATURADOS (DASHBOARD DE VENDAS)</span><div style="overflow-x:auto">${faturados}</div>` : ''}</div>
        <div style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:8px"><span class="rotulo-secao">NOTAS FISCAIS</span><div style="overflow-x:auto">${nfs}</div>
          ${(d.posvenda || []).length ? `<span class="rotulo-secao" style="margin-top:8px">PÓS-VENDA</span>
            ${d.posvenda.map((c) => `<div class="cartao-mini" style="gap:4px">
              <span style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b style="font-size:14px">${esc(c.numero)} · ${esc(c.problema || '')}</b><span class="selo ${{ 'Resolvido': 'ok', 'Recusado': 'preto', 'Encontrar solução': 'contorno-alerta' }[c.status] || ''}">${esc(c.status)}</span></span>
              <span style="font-size:12px;color:var(--texto2)">Aberto ${FL.dataCurta(c.aberto_em)}${c.nf ? ' · NF ' + esc(c.nf) : ''}${c.responsavel ? ' · ' + esc(c.responsavel) : ''}${c.prazo && ['Encontrar solução', 'Em andamento'].includes(c.status) ? ' · prazo ' + FL.dataCurta(c.prazo) : ''}${c.solucao ? ' · ' + esc(c.solucao) : ''}</span>
              ${c.ultima ? `<span style="font-size:13px">${FL.dataCurta(c.ultima.data)}${c.ultima.por ? ' · ' + esc(c.ultima.por) : ''}: ${esc(c.ultima.texto)}</span>` : ''}</div>`).join('')}` : ''}
          <span class="rotulo-secao" style="margin-top:8px">${opc.leitura ? 'HISTÓRICO DE FUPS' : 'ÚLTIMOS FUPS'}</span>
          ${fups.length ? `<ol class="linha-tempo">${fups.map((f) => `<li><b style="font-size:13px">${FL.dataCurta(f.data)}${f.por ? ' · ' + esc(f.por) : ''} · ${esc(SIT_FUP[f.situacao] || f.situacao)}</b><span style="font-size:14px">${esc([f.motivo, f.observacao].filter(Boolean).join(' — ') || '—')}</span></li>`).join('')}</ol>` : '<p style="margin:0;font-size:14px;color:var(--texto2)">Nenhum FUP ainda.</p>'}
        </div>
      </div></div>`;
  }

  // ------------------------------------------------------------------
  // Dados
  // ------------------------------------------------------------------
  async function carregar() {
    const r = await FL.api('GET', '/api/v2/pedidos');
    if (!r) { st.carregado = true; st.dados = st.dados || []; return; }
    st.dados = r.pedidos;
    st.hoje = r.hoje;
    st.carregado = true;
  }
  async function carregarDetalhe(numero) {
    const d = await FL.api('GET', '/api/v2/pedidos/' + encodeURIComponent(numero));
    if (d) { st.detalhes[numero] = d; desenhar(); }
  }
  async function recarregar(numero) {
    await carregar();
    if (numero) { delete st.detalhes[numero]; if (st.abertos[numero]) carregarDetalhe(numero); }
    desenhar();
    FL.atualizarContagens();
  }
  const achar = (n) => st.dados.find((p) => p.pedido === n);

  // ------------------------------------------------------------------
  // Formulários
  // ------------------------------------------------------------------
  function formNovaData(p) {
    let quem = p.nova_data_quem || '';
    FL.gaveta({ sobre: 'PEDIDO ' + p.pedido + ' · ' + (p.cliente || ''), titulo: 'Nova data de entrega', sub: 'Informativa: não tira o pedido dos atrasados.', botao: 'Salvar nova data',
      html: `<div style="display:flex;gap:24px;font-size:14px"><span>Original: <b>${FL.data(p.prometida)}</b></span><span>Nova atual: <b>${p.nova_data ? FL.data(p.nova_data) : '—'}</b></span></div>
        <div class="campo"><label for="ndData">Nova data <span style="font-weight:400">(obrigatório)</span></label><input id="ndData" type="date" value="${esc(p.nova_data || '')}"></div>
        <div class="campo"><span class="rot" id="ndQuemRot">Quem pediu a mudança <span style="font-weight:400">(obrigatório)</span></span>
          <div class="seg" style="grid-template-columns:1fr 1fr" role="group" aria-labelledby="ndQuemRot">${['Cliente', 'MUBEC'].map((q) => `<button type="button" data-quem="${q}" aria-pressed="${q === quem}">${q}</button>`).join('')}</div>
          </div>
        <div class="campo"><label for="ndMotivo">Motivo <span style="font-weight:400">(opcional)</span></label><input id="ndMotivo" type="text" maxlength="200" placeholder="Ex.: cliente pediu para entregar depois do inventário"></div>
        ${p.nova_data ? '<button type="button" class="link" style="align-self:flex-start" data-limpar-nova>Tirar a nova data (voltar ao prazo original)</button>' : ''}`,
      aoAbrir: (g) => {
        g.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-quem]');
          if (b) { quem = b.dataset.quem; g.querySelectorAll('[data-quem]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); g.erro(''); }
          if (e.target.closest('[data-limpar-nova]')) { g.fechar(); salvarNovaData(p, { data: null }); }
        });
      },
      aoSalvar: async (g) => {
        const data = g.querySelector('#ndData').value;
        if (!data) { g.erro('Escolha a nova data.'); return false; }
        if (!quem) { g.erro('Diga quem pediu a mudança: Cliente ou MUBEC.'); return false; }
        return salvarNovaData(p, { data, quem, motivo: g.querySelector('#ndMotivo').value });
      } });
  }
  async function salvarNovaData(p, corpo) {
    const r = await FL.api('PUT', `/api/v2/pedidos/${encodeURIComponent(p.pedido)}/nova-data`, corpo);
    if (!r) return false;
    await recarregar(p.pedido);
    FL.toast(corpo.data ? `Nova data ${FL.data(corpo.data)} registrada no pedido ${p.pedido}.` : `Pedido ${p.pedido} voltou ao prazo original.`, { desfazer: async () => {
      if (await FL.api('PUT', `/api/v2/pedidos/${encodeURIComponent(p.pedido)}/nova-data`, r.antes)) recarregar(p.pedido);
    } });
    return true;
  }

  // Também usado pela tela FUP (FL.formFup)
  FL.formFup = async function (pedidos, aoTerminar) {
    const motivos = (await FL.api('GET', '/api/v2/listas/motivos/ativas')) || [];
    const um = pedidos.length === 1;
    const p0 = pedidos[0];
    let det = null;
    if (um) det = await FL.api('GET', '/api/v2/pedidos/' + encodeURIComponent(p0.pedido), null, { silencioso: true });
    const linhaPedido = (p, i) => {
      const ult = p.fup;
      const motivoIni = ult && ult.situacao !== 'ok' ? (ult.motivo || '') : '';
      return `<div class="cartao-mini" data-linha="${i}" style="gap:10px">
        ${um ? '' : `<b>${esc(p.pedido)} · ${esc(p.cliente || '')}</b><span style="font-size:12px;color:var(--texto2)">${ult ? 'Último: ' + esc(SIT_FUP[ult.situacao] || '') + (ult.motivo ? ' · ' + esc(ult.motivo) : '') + ' · ' + FL.dataCurta(ult.data) : 'Sem FUP anterior'}</span>`}
        <div class="seg" style="grid-template-columns:repeat(3,1fr)" role="group" aria-label="Situação do pedido ${esc(p.pedido)}">
          ${[['ok', 'Ok'], ['previsto_atraso', 'Previsto atraso'], ['atraso', 'Atraso']].map((s) => `<button type="button" data-sit="${s[0]}" aria-pressed="false">${s[1]}</button>`).join('')}</div>
        <div class="campo" data-motivo-caixa hidden><label for="fupMot${i}">Motivo <span style="font-weight:400">(obrigatório)</span></label>
          <select id="fupMot${i}"><option value="">Escolha…</option>${motivos.map((m) => `<option ${m === motivoIni ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
        <div class="campo"><label for="fupObs${i}">Observação <span data-obs-obrig style="font-weight:400">(opcional)</span></label><textarea id="fupObs${i}" rows="2" maxlength="500"></textarea></div>
      </div>`;
    };
    const anteriores = um && det && det.fups.length ? `<div style="display:flex;flex-direction:column;gap:8px"><span class="rotulo-secao">FUPS ANTERIORES</span><ol class="linha-tempo">${det.fups.slice(0, 5).map((f) => `<li><b style="font-size:13px">${FL.dataCurta(f.data)}${f.por ? ' · ' + esc(f.por) : ''} · ${esc(SIT_FUP[f.situacao] || '')}</b><span style="font-size:14px">${esc([f.motivo, f.observacao].filter(Boolean).join(' — ') || '—')}</span></li>`).join('')}</ol></div>` : '';
    FL.gaveta({ sobre: um ? 'PEDIDO ' + p0.pedido + ' · ' + (p0.cliente || '') : FL.plural(pedidos.length, 'PEDIDO', 'PEDIDOS'),
      titulo: um ? 'Registrar FUP' : 'Registrar respostas', sub: um ? (p0.atrasado ? FL.plural(p0.dias_atraso, 'dia útil', 'dias úteis') + ' de atraso' : 'Prometido ' + FL.data(p0.prometida)) : 'Uma situação por pedido. O motivo já vem igual ao último FUP.',
      botao: um ? 'Registrar FUP' : 'Registrar ' + FL.plural(pedidos.length, 'resposta', 'respostas'), largura: um ? 480 : 560,
      html: `<div class="campo"><label for="fupData">Data</label><input id="fupData" type="date" value="${FL.hojeISO()}" max="${FL.hojeISO()}"></div>${pedidos.map(linhaPedido).join('')}${anteriores}`,
      aoAbrir: (g) => {
        g.addEventListener('click', (e) => {
          const b = e.target.closest('[data-sit]');
          if (!b) return;
          const caixa = b.closest('[data-linha]');
          caixa.querySelectorAll('[data-sit]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          caixa.dataset.sit = b.dataset.sit;
          caixa.querySelector('[data-motivo-caixa]').hidden = b.dataset.sit === 'ok';
          g.erro('');
        });
        g.addEventListener('change', (e) => {
          if (e.target.tagName === 'SELECT') { const c = e.target.closest('[data-linha]'); c.querySelector('[data-obs-obrig]').textContent = e.target.value === 'Outro' ? '(obrigatório com "Outro")' : '(opcional)'; }
        });
      },
      aoSalvar: async (g) => {
        const itens = [];
        for (let i = 0; i < pedidos.length; i++) {
          const c = g.querySelector(`[data-linha="${i}"]`);
          const sit = c.dataset.sit;
          const motivo = c.querySelector('select').value;
          const obs = c.querySelector('textarea').value.trim();
          const nome = um ? '' : ` (pedido ${pedidos[i].pedido})`;
          if (!sit) { g.erro('Escolha a situação: Ok, Previsto atraso ou Atraso' + nome + '.'); return false; }
          if (sit !== 'ok' && !motivo) { g.erro('Escolha o motivo' + nome + '.'); return false; }
          if (sit !== 'ok' && motivo === 'Outro' && !obs) { g.erro('Com o motivo "Outro", escreva a observação' + nome + '.'); return false; }
          itens.push({ pedido: pedidos[i].pedido, situacao: sit, motivo: sit === 'ok' ? null : motivo, observacao: obs || null });
        }
        const r = await FL.api('POST', '/api/v2/fup', { data: g.querySelector('#fupData').value || null, itens });
        if (!r) return false;
        if (aoTerminar) await aoTerminar(pedidos.map((p) => p.pedido));
        FL.toast(um ? `FUP registrado no pedido ${p0.pedido}.` : `${FL.plural(itens.length, 'FUP registrado', 'FUPs registrados')}.`, { desfazer: async () => {
          for (const id of r.ids) await FL.api('DELETE', '/api/v2/fup/' + id);
          if (aoTerminar) await aoTerminar(pedidos.map((p) => p.pedido));
        } });
        return true;
      } });
  };

  function formEspera(p) {
    if (p.aguardando) {
      FL.modal({ titulo: `Tirar "Aguardando cliente" do pedido ${p.pedido}?`, botao: 'Tirar',
        html: `<p>Motivo: ${esc(p.aguardando.motivo)} · desde ${FL.data(p.aguardando.desde)}. O pedido volta a contar atraso normalmente.</p>`,
        aoConfirmar: async () => {
          if (!(await FL.api('DELETE', `/api/v2/pedidos/${encodeURIComponent(p.pedido)}/aguardando`))) return false;
          await recarregar(p.pedido); FL.toast(`Pedido ${p.pedido} voltou a contar atraso.`);
          return true;
        } });
      return;
    }
    let motivo = '';
    FL.gaveta({ sobre: 'PEDIDO ' + p.pedido + ' · ' + (p.cliente || ''), titulo: 'Aguardando cliente', sub: 'Pronto, depende do cliente. Sai dos atrasados.', botao: 'Marcar',
      html: `<div class="campo"><span class="rot" id="esMotRot">Motivo</span><div class="chips" role="group" aria-labelledby="esMotRot">${MOTIVOS_ESPERA.map((m) => `<button type="button" class="chip" data-mot="${esc(m)}" aria-pressed="${p.tipo === 'Retira' && m.startsWith('Retira')}">${esc(m)}</button>`).join('')}</div></div>
        <div class="campo"><label for="esObs">Observação <span data-obs-obrig style="font-weight:400">(opcional)</span></label><input id="esObs" type="text" maxlength="200"></div>`,
      aoAbrir: (g) => {
        if (p.tipo === 'Retira') motivo = MOTIVOS_ESPERA[0];
        g.addEventListener('click', (e) => {
          const b = e.target.closest('[data-mot]'); if (!b) return;
          motivo = b.dataset.mot; g.querySelectorAll('[data-mot]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          g.querySelector('[data-obs-obrig]').textContent = motivo === 'Outro' ? '(obrigatória com "Outro")' : '(opcional)'; g.erro('');
        });
      },
      aoSalvar: async (g) => {
        const obs = g.querySelector('#esObs').value.trim();
        if (!motivo) { g.erro('Escolha o motivo.'); return false; }
        if (motivo === 'Outro' && !obs) { g.erro('Com "Outro", escreva a observação.'); return false; }
        const texto = motivo === 'Outro' ? obs : motivo + (obs ? ' — ' + obs : '');
        if (!(await FL.api('POST', `/api/v2/pedidos/${encodeURIComponent(p.pedido)}/aguardando`, { motivo: texto }))) return false;
        await recarregar(p.pedido);
        FL.toast(`Pedido ${p.pedido}: aguardando cliente.`, { desfazer: async () => { if (await FL.api('DELETE', `/api/v2/pedidos/${encodeURIComponent(p.pedido)}/aguardando`)) recarregar(p.pedido); } });
        return true;
      } });
  }

  function formCancelar(p) {
    FL.modal({ titulo: `Cancelar o pedido ${p.pedido}?`, perigo: true, botao: 'Cancelar pedido',
      html: `<p>${esc(p.cliente || '')} · ${esc(p.status || '')}. Fica como <b>Cancelado</b> e sai dos atrasados e dos avisos. Desfazer pede a senha de administrador.</p>
        <div class="campo"><label for="cnMotivo">Motivo <span style="font-weight:400">(obrigatório)</span></label><textarea id="cnMotivo" rows="3" maxlength="300"></textarea></div>
        <div class="campo"><label for="cnData">Data do cancelamento</label><input id="cnData" type="date" value="${FL.hojeISO()}"></div>`,
      aoConfirmar: async (m) => {
        const motivo = m.querySelector('#cnMotivo').value.trim();
        if (!motivo) { FL.toast('Escreva o motivo do cancelamento.', { erro: true }); m.querySelector('#cnMotivo').focus(); return false; }
        const r = await FL.api('POST', `/api/v2/pedidos/${encodeURIComponent(p.pedido)}/cancelar`, { motivo, data: m.querySelector('#cnData').value || null });
        if (!r) return false;
        await recarregar(p.pedido);
        FL.toast(`Pedido ${p.pedido} cancelado.`);
        return true;
      } });
  }

  async function marcarNf(numero, nf, desmarcar) {
    const url = `/api/v2/pedidos/${encodeURIComponent(numero)}/nfs/${encodeURIComponent(nf)}/cancelada`;
    if (desmarcar) {
      if (await FL.api('POST', url, { cancelada: false })) { await recarregar(numero); FL.toast(`NF ${nf} volta a contar no pedido ${numero}.`); }
      return;
    }
    FL.modal({ titulo: `Marcar a NF ${nf} como cancelada?`, botao: 'Marcar como cancelada', perigo: true,
      html: `<p>A NF fica riscada e deixa de contar no status e no aviso de canhoto.</p>
        <div class="campo"><label for="nfMotivo">Por que foi cancelada <span style="font-weight:400">(obrigatório)</span></label><input id="nfMotivo" type="text" maxlength="200" placeholder="Ex.: refaturada na NF 117600"></div>`,
      aoConfirmar: async (m) => {
        const motivo = m.querySelector('#nfMotivo').value.trim();
        if (!motivo) { FL.toast('Escreva por que a NF foi cancelada.', { erro: true }); return false; }
        if (!(await FL.api('POST', url, { cancelada: true, motivo }))) return false;
        await recarregar(numero);
        FL.toast(`NF ${nf} marcada como cancelada.`, { desfazer: async () => { if (await FL.api('POST', url, { cancelada: false })) recarregar(numero); } });
        return true;
      } });
  }

  async function exportar() {
    const lista = filtrados();
    if (!lista.length) { FL.toast('Nenhum pedido para exportar.', { erro: true }); return; }
    FL.toast(`Gerando a planilha com ${FL.plural(lista.length, 'pedido', 'pedidos')}…`);
    const r = await FL.api('POST', '/api/v2/pedidos/exportar', { pedidos: lista.map((p) => p.pedido), nome: st.aba }, { blob: true });
    if (r) FL.baixarArquivo(r.blob, r.nome || 'flowlog_pedidos.xlsx');
  }

  function abrirFiltros() {
    const per = Object.assign({}, st.periodo);
    const extra = `<section style="display:flex;flex-direction:column;gap:10px;padding:16px 0;border-bottom:1px solid var(--c3)">
      <h3 style="margin:0;font-size:12px;letter-spacing:.06em">PERÍODO</h3>
      <div class="campo"><label for="fpCampo">Filtrar pela data de</label><select id="fpCampo">${CAMPOS_PERIODO.map((c) => `<option value="${c[0]}" ${c[0] === per.campo ? 'selected' : ''}>${c[1]}</option>`).join('')}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="campo"><label for="fpDe">De</label><input id="fpDe" type="date" value="${esc(per.de || '')}"></div>
      <div class="campo"><label for="fpAte">Até</label><input id="fpAte" type="date" value="${esc(per.ate || '')}"></div></div></section>`;
    const g = FL.gavetaFiltros({ sobre: 'PEDIDOS', defs: DEFS, itens: daAba().filter((p) => passaBusca(p)), marcados: st.filtros, nomeItens: 'pedidos', extraHtml: extra,
      aoMudar: (m) => { st.filtros = m; st.limite = POR_PAGINA; desenhar(); } });
    g.addEventListener('change', (e) => {
      if (!['fpCampo', 'fpDe', 'fpAte'].includes(e.target.id)) return;
      st.periodo = { campo: g.querySelector('#fpCampo').value, de: g.querySelector('#fpDe').value, ate: g.querySelector('#fpAte').value };
      st.limite = POR_PAGINA; desenhar();
    });
  }

  // ------------------------------------------------------------------
  function ligarEventos() {
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; st.limite = POR_PAGINA; desenhar(); return; }
      if (t.dataset.cartao) {
        const c = t.dataset.cartao;
        if (c === 'atrasados') st.aba = 'atrasados';
        else if (c === 'todos') { st.aba = 'todos'; }
        else if (c === 'avisos') { location.hash = '#avisos'; return; }
        else if (c === 'encerrados') { st.aba = 'todos'; st.filtros = Object.assign({}, st.filtros, { status: ['Encerrado'] }); }
        st.limite = POR_PAGINA; desenhar(); return;
      }
      if (t.dataset.abrir) {
        const n = t.dataset.abrir;
        st.abertos[n] = !st.abertos[n];
        desenhar();
        if (st.abertos[n] && !st.detalhes[n]) carregarDetalhe(n);
        return;
      }
      if (t.dataset.ordenar) {
        const c = t.dataset.ordenar;
        st.ordem = st.ordem.campo === c ? { campo: c, desc: !st.ordem.desc } : { campo: c, desc: c === 'emissao' || c === 'status' };
        desenhar(); return;
      }
      if (t.dataset.acao) {
        const p = achar(t.dataset.p);
        if (!p) return;
        if (t.dataset.acao === 'nova') formNovaData(p);
        if (t.dataset.acao === 'fup') FL.formFup([p], async (nums) => { for (const n of nums) await recarregar(n); });
        if (t.dataset.acao === 'cancelar') formCancelar(p);
        if (t.dataset.acao === 'espera') formEspera(p);
        if (t.dataset.acao === 'posvenda') location.hash = '#posvenda?novo=' + encodeURIComponent(p.pedido);
        return;
      }
      if (t.dataset.descancelar) {
        const n = t.dataset.descancelar;
        if (await FL.api('POST', `/api/v2/pedidos/${encodeURIComponent(n)}/descancelar`, null, { senha: true })) { await recarregar(n); FL.toast(`O pedido ${n} não está mais cancelado.`); }
        return;
      }
      if (t.dataset.nfCancelar) { marcarNf(t.dataset.p, t.dataset.nfCancelar, !!t.dataset.desfazer); return; }
      if ('mais' in t.dataset) { st.limite += POR_PAGINA; desenhar(); return; }
      if ('exportar' in t.dataset) { exportar(); return; }
      if ('abrirFiltros' in t.dataset) { abrirFiltros(); return; }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); desenhar(); return; }
      if ('tirarPeriodo' in t.dataset) { st.periodo = { campo: st.periodo.campo }; desenhar(); return; }
      if ('limparFiltros' in t.dataset || 'limparTudo' in t.dataset) {
        st.filtros = {}; st.periodo = { campo: 'prometida' };
        if ('limparTudo' in t.dataset) { st.q = ''; const b = document.getElementById('flBuscaTopo'); if (b) b.value = ''; }
        desenhar();
      }
    });
  }

  FL.telas.pedidos = {
    montar: async function (alvo) {
      el = alvo;
      st = { dados: [], carregado: false, aba: 'todos', filtros: {}, periodo: { campo: 'prometida' }, q: '', limite: POR_PAGINA,
        abertos: {}, detalhes: {}, ordem: { campo: 'emissao', desc: true } };
      ligarEventos();
      desenhar();
      await carregar();
      desenhar();
    },
    buscar: function (q) { if (!st) return; st.q = q; st.limite = POR_PAGINA; desenhar(); }
  };
})();
