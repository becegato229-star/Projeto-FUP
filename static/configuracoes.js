/* FlowLog v2 — Configurações: Todos · Importar · Listas · Prazos e feriados · Backup */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;

  // O que cada planilha alimenta (texto da tela; o reconhecimento é feito pelo servidor, pelas colunas)
  const TIPOS = [
    { id: 'follow', nome: 'Follow up de vendas', mega: 'gd_Pedido', alimenta: 'Pedidos: cliente, situação, transportadora', como: 'Manual',
      explica: 'Um pedido por linha: situação no Mega, cliente, emissão e transportadora (define o tipo de entrega).',
      colunas: ['Nº do documento', 'Situação', 'Data de emissão', 'Cód. do cliente', 'Nome fantasia', 'Cód. da transportadora'] },
    { id: 'oe', nome: 'OE', mega: 'Gd_PedidosPendentes', alimenta: 'Pedidos: nº da OE e data prometida', como: 'Manual',
      explica: 'Ordens de entrega: nº da OE e data prometida (base do atraso).',
      colunas: ['Cód. da OE', 'Cód. do pedido', 'Data de entrega'] },
    { id: 'expedicao', nome: 'Pedidos Mubec 2.0', mega: 'Planilha Google · aba Expedição', alimenta: 'NFs, faturamento, entrega e canhoto', como: 'Automática · n8n às 08:30, 11:50 e 14:00',
      explica: 'Expedição: NFs, faturamento, entrega e canhoto. Importada pelo n8n 3 vezes por dia.',
      cuidado: 'Sem o n8n rodando, os dados ficam desatualizados.',
      colunas: ['Pedido', 'NF', 'Data de Faturamento', 'Data de entrega', 'Canhoto', 'Data Prev de Entrega', 'OE'] },
    { id: 'carteira', nome: 'Carteira de pedidos', mega: 'Gd_Edicao (carteira)', alimenta: 'Itens dos pedidos em aberto', como: 'Manual',
      explica: 'Um item por linha, só pedidos pendentes. Item faturado sai da carteira e fica no histórico.',
      colunas: ['Documento de Venda', 'Código do item', 'Descrição do item', 'Quantidade do documento', 'Unidade', 'Data de entrega', 'Situação do item', 'Nome representante', 'Nome transportadora'] },
    { id: 'vendas', nome: 'Dashboard de vendas', mega: 'Gd_Edicao (vendas faturadas)', alimenta: 'Itens faturados de cada NF, vendedor e Estado', como: 'Manual',
      explica: 'Um item de NF por linha, ligado ao pedido pela NF. Traz itens faturados, Estado e vendedor.',
      cuidado: 'NF sem pedido na expedição fica guardada e liga depois.',
      colunas: ['Nº Nota Fiscal', 'Seq. Item NF', 'Data de Emissão', 'Item', 'Descrição do Item', 'Quantidade', 'Unidade', 'Nome do Representante', 'U.F.', 'Município'] },
    { id: 'boletos', nome: 'Boletos vencidos', mega: 'Relatório do banco', alimenta: 'Cobrança', como: 'Manual · Silvia',
      explica: 'Boletos vencidos do banco. Saiu do relatório = Pago; voltou = Em aberto.',
      colunas: ['Pagador', 'Seu Número', 'Data Vencimento', 'Valor Título (R$)'] },
    { id: 'catalogo', nome: 'Catálogo de produtos', mega: 'Gd_Produtos', alimenta: 'Peso dos itens da Terceirização', como: 'Manual · quando entra produto novo',
      explica: 'Cadastro de produtos: peso por peça para as notas da zincagem.',
      cuidado: 'Sem as colunas "Peso Líquido" e "Peso Bruto", os pesos atuais são mantidos.',
      colunas: ['Cód.Item', 'Descrição do Grupo', 'Código NCM', 'Unid.', 'Peso Líquido', 'Peso Bruto'] },
    { id: 'pdfs', nome: 'PDFs da zincagem', mega: 'DANFE (saída e retorno)', alimenta: 'Terceirização: notas e itens', como: 'Manual · vários de uma vez', pdf: true,
      explica: 'Notas de saída e retorno da galvanização. Tipo pelo CFOP; ligação pelo texto da nota.',
      cuidado: 'CFOP 5902 (entrada no estoque) é ignorado; só 5124.',
      colunas: ['Número e chave da NF', 'CFOP', 'Itens', 'Pesos e valores', 'Informações complementares'] }
  ];
  const NOMES_PRAZOS = {
    aviso_entrega: ['Entrega', 'dias úteis'], aviso_transportadora: ['Transportadora', 'dias úteis'], aviso_retira: ['Retira', 'dias úteis'],
    folga_retira: ['Folga para Retira', 'dia(s) depois'], fup_janela: ['Vence em até', 'dias úteis'], posvenda_prazo: ['Prazo', 'dias corridos']
  };
  const LIMITES = { aviso_entrega: [1, 30], aviso_transportadora: [1, 30], aviso_retira: [1, 30], folga_retira: [0, 10], fup_janela: [0, 15], posvenda_prazo: [1, 365] };
  const GRUPOS_PRAZOS = [
    { titulo: 'Avisos de canhoto', texto: 'Depois de quantos dias úteis sem canhoto a nota faturada vira aviso.', campos: ['aviso_entrega', 'aviso_transportadora', 'aviso_retira'] },
    { titulo: 'Atraso de produção', texto: 'Pedido não faturado conta como atrasado a partir da data prometida. Retira tem uma folga.', campos: ['folga_retira'] },
    { titulo: 'FUP · Para revisar', texto: 'Entra em "Para revisar" o pedido atrasado ou que vence nos próximos dias, ainda sem FUP de hoje.', campos: ['fup_janela'] },
    { titulo: 'Pós-venda', texto: 'Prazo para o cliente reclamar, contado do canhoto. Só informativo: fora do prazo o caso abre com justificativa.', campos: ['posvenda_prazo'] }
  ];

  let el, st;

  async function carregar() {
    const [imp, listas, prazos, feriados, senha, backups] = await Promise.all([
      FL.api('GET', '/api/v2/importacoes'), FL.api('GET', '/api/v2/listas'), FL.api('GET', '/api/v2/prazos'),
      FL.api('GET', '/api/v2/feriados'), FL.api('GET', '/api/v2/senha'), FL.api('GET', '/api/v2/backups')
    ]);
    st.senhasTelas = (await FL.api('GET', '/api/v2/senha-tela', null, { silencioso: true })) || [];
    st.imp = imp || {};
    st.listas = listas || [];
    st.prazos = (prazos && prazos.prazos) || {};
    if (!st.prazosEdit && prazos) st.prazosEdit = Object.assign({}, st.prazos);
    st.feriados = feriados || [];
    st.senhaDefinida = !!(senha && senha.definida);
    st.backups = backups || [];
    st.carregado = true;
  }

  function ultimo(tipo) { return (st.imp[tipo] || [])[0] || null; }
  function diasDesdeBackup() {
    const b = st.backups[0];
    if (!b) return null;
    return FL.diasEntre(b.quando.slice(0, 10), FL.hojeISO());
  }

  // ------------------------------------------------------------------
  function desenhar() {
    const comAviso = TIPOS.filter((t) => { const u = ultimo(t.id); return u && u.avisos && u.avisos.length; });
    const mudados = Object.keys(st.prazosEdit || {}).filter((k) => st.prazosEdit[k] !== st.prazos[k]).length;
    const abas = [
      { id: 'todos', rotulo: 'Todos' },
      { id: 'importar', rotulo: 'Importar', qtd: comAviso.length || '', alerta: true },
      { id: 'listas', rotulo: 'Listas' },
      { id: 'prazos', rotulo: 'Prazos e feriados', qtd: mudados || '', alerta: true },
      { id: 'backup', rotulo: 'Backup' }
    ];
    let corpo = '';
    if (!st.carregado) corpo = '<div class="carregando">Carregando…</div>';
    else if (st.aba === 'importar') corpo = htmlImportar();
    else if (st.aba === 'listas') corpo = htmlListas();
    else if (st.aba === 'prazos') corpo = htmlPrazos();
    else if (st.aba === 'backup') corpo = htmlBackup();
    else corpo = htmlTodos(comAviso);
    el.innerHTML = `
      <div class="fl-cabeca fl-entra"><div class="txt"><h1>Configurações</h1></div></div>
      <div class="fl-barra-abas fl-entra d1">${FL.htmlAbas(abas, st.aba, 'Abas das configurações')}</div>
      <div class="fl-troca" style="display:flex;flex-direction:column;gap:20px">${corpo}</div>`;
    FL.aplicarBusca();
  }

  // ---------------- Todos ----------------
  function htmlTodos(comAviso) {
    const alertas = [];
    const d = diasDesdeBackup();
    if (!st.senhaDefinida) alertas.push(['Senha de administrador não definida.', 'Definir senha', 'backup']);
    else if (d == null) alertas.push(['Nenhum backup registrado.', 'Fazer backup', 'backup']);
    else if (d >= 3) alertas.push([`Último backup há ${d} dias.`, 'Fazer backup', 'backup']);
    comAviso.slice(0, 3).forEach((t) => alertas.push([t.nome + ': ' + ultimo(t.id).avisos[0], 'Ver importação', 'importar:' + t.id]));
    const exp = ultimo('expedicao');
    const fol = ultimo('follow');
    const listasAtivas = st.listas.reduce((s, l) => s + l.itens.filter((i) => i.ativo).length, 0);
    const hoje = FL.hojeISO();
    const prox = st.feriados.find((f) => f.data > hoje);
    const b = st.backups[0];
    const cartao = (id, titulo, desc, linhas) => `<button type="button" class="fl-cartao grande" data-ir="${id}">
      <span class="t">${esc(titulo)} ${FL.icone.seguir}</span><span style="font-size:14px;line-height:1.45;color:var(--texto2)">${esc(desc)}</span>
      <span class="linhas">${linhas.map((l) => `<span><span style="color:var(--texto2)">${esc(l[0])}</span><b style="color:${l[2] || '#000'};text-align:right">${esc(l[1])}</b></span>`).join('')}</span></button>`;
    return `${alertas.map((a) => `<div class="aviso" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 16px"><span>${esc(a[0])}</span><button type="button" class="link" style="color:var(--alerta)" data-ir="${esc(a[2])}">${esc(a[1])}</button></div>`).join('')}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px">
        ${cartao('importar', 'Importar', 'Planilhas do Mega, do banco e da expedição, e os PDFs da zincagem.', [
          ['Pedidos Mubec 2.0', exp ? FL.dataHora(exp.quando) : 'nunca'], ['Follow up de vendas', fol ? FL.dataHora(fol.quando) : 'nunca'],
          ['Com aviso na última vez', String(comAviso.length), comAviso.length ? 'var(--alerta)' : '#000']])}
        ${cartao('listas', 'Listas', 'As opções dos formulários: motivos de FUP, pós-venda, quem chama a coleta.', [
          ['Listas', String(st.listas.length)], ['Opções em uso', String(listasAtivas)]])}
        ${cartao('prazos', 'Prazos e feriados', 'Quando um canhoto vira aviso, a folga da Retira, a janela do FUP e o prazo do pós-venda. Feriados de SP.', [
          ['Aviso de canhoto', `${st.prazos.aviso_entrega} / ${st.prazos.aviso_transportadora} / ${st.prazos.aviso_retira} dias úteis`],
          ['Próximo feriado', prox ? FL.dataCurta(prox.data) + ' · ' + prox.nome : '—']])}
        ${cartao('backup', 'Backup', 'Baixar uma cópia de todos os dados e PDFs, protegida por senha.', [
          ['Último backup', b ? FL.dataHora(b.quando) + ' · ' + (b.por || '—') : 'nenhum', d == null || d >= 3 ? 'var(--alerta)' : '#000'],
          ['Automático', 'a decidir']])}
      </div>`;
  }

  // ---------------- Importar ----------------
  function htmlImportar() {
    const sel = TIPOS.find((t) => t.id === st.tipoSel) || TIPOS[0];
    const hist = st.imp[sel.id] || [];
    const linhas = TIPOS.map((t) => {
      const u = ultimo(t.id);
      const aviso = u && u.avisos && u.avisos.length;
      return `<tr class="${t.id === sel.id ? 'sel' : ''}">
        <td><button type="button" class="fl-link-linha" data-tipo="${t.id}" aria-label="Ver detalhes da planilha ${esc(t.nome)}">${esc(t.nome)}</button><span class="sub">${esc(t.mega)}</span></td>
        <td>${esc(t.alimenta)}<span class="sub">${esc(t.como)}</span></td>
        <td>${u ? `<span class="nw">${FL.dataHora(u.quando)} · ${esc(u.por || '—')}</span><span class="sub" style="${aviso ? 'color:var(--alerta);font-weight:700' : ''}">${esc(aviso ? 'Com aviso: ' + u.avisos[0] : (u.resumo || ''))}</span>` : `<span class="sub">${t.semImport ? 'ainda não disponível' : 'nunca importada pela tela nova'}</span>`}</td></tr>`;
    }).join('');
    return `
      <button type="button" class="zona-arquivo" data-escolher="planilhas">
        ${FL.icone.enviar}<span style="text-align:left"><b>Arraste as planilhas do Mega ou clique para escolher</b>
        <span>Tipo reconhecido pelas colunas. Aceita várias de uma vez.</span></span>
      </button>
      <input type="file" id="cfgArqPlan" accept=".xlsx,.xls" multiple hidden>
      <input type="file" id="cfgArqPdf" accept=".pdf" multiple hidden>
      <div class="fl-tab-painel">
        <div class="fl-tabela-caixa alta"><table class="fl-tabela"><thead><tr>
          <th>Planilha<small>nome no Mega</small></th><th>Alimenta<small>como chega</small></th><th>Última importação<small>resultado</small></th>
        </tr></thead><tbody>${linhas}</tbody></table></div>
        <aside class="fl-painel" aria-labelledby="cfgImpTit"><div class="cab"><span class="sobre">${esc(sel.mega.toUpperCase())}</span>
          <h2 id="cfgImpTit">${esc(sel.nome)}</h2><span style="font-size:14px">${esc(sel.como)}</span></div>
          <div class="meio">
            <p style="margin:0;font-size:14px;line-height:1.45">${esc(sel.explica)}</p>
            ${sel.cuidado ? `<p class="aviso info">${esc(sel.cuidado)}</p>` : ''}
            <div style="display:flex;flex-direction:column;gap:8px"><span class="rotulo-secao">COLUNAS QUE O FLOWLOG USA</span>
              <div class="chips">${sel.colunas.map((c) => `<span class="selo" style="font-weight:400;font-size:13px">${esc(c)}</span>`).join('')}</div></div>
            <div style="display:flex;flex-direction:column;gap:10px"><span class="rotulo-secao">ÚLTIMAS IMPORTAÇÕES</span>
              ${hist.length ? hist.map((h) => `<div class="cartao-mini"><b style="font-size:13px">${FL.dataHora(h.quando)} · ${esc(h.por || '—')}</b>
                <span style="font-size:14px">${esc(h.resumo || '')}</span>${(h.avisos || []).map((a) => `<span style="font-size:12px;font-weight:700;color:var(--alerta)">${esc(a)}</span>`).join('')}
                ${h.arquivo ? `<span style="font-size:12px;color:var(--texto2)">${esc(h.arquivo)}</span>` : ''}</div>`).join('') : '<p style="margin:0;font-size:14px;color:var(--texto2)">Nenhuma importação registrada.</p>'}
            </div>
          </div>
          <div class="pe">
            ${sel.semImport ? '<span style="font-size:13px;color:var(--texto2)">Ainda não disponível.</span>' : `<button type="button" class="btn grande" data-escolher="${sel.pdf ? 'pdfs' : 'planilhas'}">${sel.pdf ? 'Enviar PDFs' : 'Enviar planilha'}</button>`}
            <span style="font-size:12px;color:var(--texto2);line-height:1.4">Importar nunca apaga o que já existe: só cria e atualiza. Linha ignorada sempre aparece no resultado.</span>
          </div></aside>
      </div>`;
  }

  async function enviarPlanilhas(arquivos) {
    if (!arquivos.length) return;
    const fd = new FormData();
    [...arquivos].forEach((f) => fd.append('files', f));
    FL.toast('Importando ' + FL.plural(arquivos.length, 'planilha', 'planilhas') + '…');
    const r = await FL.api('POST', '/api/v2/importar', null, { form: fd });
    if (!r) return;
    const nomes = Object.fromEntries(TIPOS.map((t) => [t.id, t.nome]));
    FL.gaveta({ sobre: 'RESULTADO DA IMPORTAÇÃO', titulo: FL.plural(r.resultados.length, 'planilha', 'planilhas'), semAutor: true, cancelar: 'Fechar',
      html: r.resultados.map((x) => `<div class="cartao-mini" style="border-left:4px solid ${x.ok ? 'var(--verde)' : 'var(--alerta)'}">
        <span style="font-size:13px;color:var(--texto2)">${esc(x.arquivo)}</span>
        <b>${x.ok ? 'Reconhecida como "' + esc(nomes[x.tipo] || x.tipo) + '"' : 'Não importada'}</b>
        <span style="font-size:14px">${esc(x.ok ? x.resumo : x.erro)}</span>
        ${(x.avisos || []).map((a) => `<p class="aviso" style="margin-top:6px">${esc(a)}</p>`).join('')}</div>`).join('') });
    await carregar(); desenhar();
  }

  async function enviarPdfs(arquivos) {
    if (!arquivos.length) return;
    const fd = new FormData();
    [...arquivos].forEach((f) => fd.append('files', f));
    FL.toast('Lendo ' + FL.plural(arquivos.length, 'PDF', 'PDFs') + '…');
    const r = await FL.api('POST', '/api/terceirizacao/importar-pdfs-lote', null, { form: fd });
    if (!r) return;
    FL.gaveta({ sobre: 'RESULTADO DA IMPORTAÇÃO', titulo: FL.plural(r.total, 'PDF', 'PDFs'), semAutor: true, cancelar: 'Fechar',
      html: (r.resultados || []).map((x) => `<div class="cartao-mini" style="border-left:4px solid ${['importado', 'completado'].includes(x.resultado) ? 'var(--verde)' : 'var(--c3)'}">
        <span style="font-size:13px;color:var(--texto2)">${esc(x.arquivo)}</span>
        <b>${esc((x.tipo === 'saida' ? 'Saída ' : x.tipo === 'retorno' ? 'Retorno ' : '') + (x.numero_nota || ''))} · ${esc(x.resultado)}</b>
        <span style="font-size:14px">${esc(x.mensagem || '')}</span>
        ${(x.avisos || []).map((a) => `<p class="aviso" style="margin-top:6px">${esc(a)}</p>`).join('')}</div>`).join('') });
    await carregar(); desenhar();
  }

  // ---------------- Listas ----------------
  function htmlListas() {
    const sel = st.listas.find((l) => l.id === st.listaSel) || st.listas[0];
    if (!sel) return '<div class="carregando">Nenhuma lista.</div>';
    const linhas = st.listas.map((l) => {
      const at = l.itens.filter((i) => i.ativo).length;
      const d = l.itens.length - at;
      return `<tr class="${l.id === sel.id ? 'sel' : ''}"><td><button type="button" class="fl-link-linha" data-lista="${l.id}" aria-label="Editar a lista ${esc(l.nome)}">${esc(l.nome)}</button><span class="sub">Aparece em: ${esc(l.onde)}</span></td>
        <td>${at} opções em uso<span class="sub">${d ? FL.plural(d, 'desativada', 'desativadas') : 'nenhuma desativada'}</span></td></tr>`;
    }).join('');
    const itens = sel.itens.map((i) => {
      let acao = '';
      if (!i.fixo) acao = !i.ativo ? ['reativar', 'Reativar'] : (i.uso > 0 ? ['desativar', 'Desativar'] : ['apagar', 'Apagar']);
      const uso = i.fixo ? `Fixa · usada em ${i.uso} registros` : (!i.ativo ? `Desativada · fica só no histórico (${i.uso} registros)` : (i.uso ? `Usada em ${i.uso} registros` : 'Ainda não usada'));
      return `<li style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--c3);border-radius:var(--r-btn);background:${i.ativo ? '#fff' : 'var(--c1)'}">
        <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><b style="font-size:14px;${i.ativo ? '' : 'text-decoration:line-through;color:var(--texto2)'}">${esc(i.texto)}</b><span style="font-size:12px;color:var(--texto2)">${esc(uso)}</span></span>
        ${acao ? `<button type="button" class="btn sec" style="min-height:34px;padding:0 12px;font-size:13px" data-op="${acao[0]}" data-id="${i.id}" data-texto="${esc(i.texto)}">${acao[1]}</button>` : ''}</li>`;
    }).join('');
    return `<div class="fl-tab-painel">
      <div class="fl-tabela-caixa alta"><table class="fl-tabela"><thead><tr><th>Lista<small>onde aparece</small></th><th>Opções<small>em uso · desativadas</small></th></tr></thead><tbody>${linhas}</tbody></table></div>
      <aside class="fl-painel" aria-labelledby="cfgListaTit"><div class="cab"><span class="sobre">LISTA</span><h2 id="cfgListaTit">${esc(sel.nome)}</h2><span style="font-size:14px">Aparece em: ${esc(sel.onde)}</span></div>
        <div class="meio">${sel.nota ? `<p class="aviso info">${esc(sel.nota)}</p>` : ''}<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">${itens}</ul></div>
        <div class="pe"><div class="campo"><label for="cfgNovoItem">Adicionar opção</label>
          <div style="display:flex;gap:8px"><input id="cfgNovoItem" type="text" maxlength="80" placeholder="Ex.: Falta de embalagem" style="flex:1 1 auto;min-width:0"><button type="button" class="btn" data-op="adicionar">Adicionar</button></div></div>
          <span style="font-size:12px;color:var(--texto2);line-height:1.4">Opção já usada em registros não é apagada, só desativada: ela some dos formulários e continua no histórico.</span></div>
      </aside></div>`;
  }

  async function acaoLista(op, botao) {
    const sel = st.listas.find((l) => l.id === st.listaSel) || st.listas[0];
    const base = '/api/v2/listas/' + sel.id;
    if (op === 'adicionar') {
      const inp = el.querySelector('#cfgNovoItem');
      const texto = inp.value.trim();
      if (!texto) { FL.toast('Escreva a nova opção.', { erro: true }); inp.focus(); return; }
      if (!(await FL.api('POST', base, { texto }, { senha: true }))) return;
      await carregar(); desenhar();
      const novo = (st.listas.find((l) => l.id === sel.id).itens.find((i) => i.texto.toLowerCase() === texto.toLowerCase()) || {});
      FL.toast(`Opção "${texto}" adicionada em ${sel.nome}.`, { desfazer: async () => { if (await FL.api('DELETE', base + '/' + novo.id, null, { senha: true })) { await carregar(); desenhar(); } } });
      return;
    }
    const id = botao.dataset.id, texto = botao.dataset.texto;
    if (op === 'apagar') {
      if (!(await FL.api('DELETE', base + '/' + id, null, { senha: true }))) return;
      await carregar(); desenhar();
      FL.toast(`Opção "${texto}" apagada.`, { desfazer: async () => { if (await FL.api('POST', base, { texto }, { senha: true })) { await carregar(); desenhar(); } } });
      return;
    }
    const ativo = op === 'reativar';
    if (!(await FL.api('PUT', base + '/' + id, { ativo }, { senha: true }))) return;
    await carregar(); desenhar();
    FL.toast(ativo ? `Opção "${texto}" reativada: volta a aparecer nos formulários.` : `Opção "${texto}" desativada. Os registros antigos continuam com ela.`,
      { desfazer: async () => { if (await FL.api('PUT', base + '/' + id, { ativo: !ativo }, { senha: true })) { await carregar(); desenhar(); } } });
  }

  // ---------------- Prazos e feriados ----------------
  function htmlPrazos() {
    if (!st.prazosEdit) return '<p class="aviso">Erro ao carregar os prazos. Atualize a página.</p>';
    const grupos = GRUPOS_PRAZOS.map((g) => `<section class="fl-secao"><div><h2>${esc(g.titulo)}</h2><p>${esc(g.texto)}</p></div>
      ${g.campos.map((k) => { const v = st.prazosEdit[k]; const mudou = v !== st.prazos[k]; return `
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;padding-top:10px;border-top:1px solid var(--c2)">
          <span id="pz-${k}" style="font-size:15px">${esc(NOMES_PRAZOS[k][0])}${mudou ? ' <b style="font-size:12px;color:var(--sucesso)">alterado</b>' : ''}</span>
          <span role="group" aria-labelledby="pz-${k}" style="display:inline-flex;align-items:center;gap:8px">
            <button type="button" class="btn-icone" style="border-color:#000;font-size:18px;font-weight:700" data-pz="${k}" data-d="-1" aria-label="Diminuir ${esc(NOMES_PRAZOS[k][0])}">−</button>
            <b aria-live="polite" style="min-width:32px;text-align:center;font-size:18px">${v}</b>
            <button type="button" class="btn-icone" style="border-color:#000;font-size:18px;font-weight:700" data-pz="${k}" data-d="1" aria-label="Aumentar ${esc(NOMES_PRAZOS[k][0])}">+</button>
            <span style="min-width:96px;font-size:13px;color:var(--texto2)">${esc(NOMES_PRAZOS[k][1])}</span></span></div>`; }).join('')}</section>`).join('');
    const anos = [...new Set(st.feriados.map((f) => f.data.slice(0, 4)).concat([FL.hojeISO().slice(0, 4)]))].sort();
    if (!st.ano) st.ano = FL.hojeISO().slice(0, 4);
    const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const fer = st.feriados.filter((f) => f.data.slice(0, 4) === st.ano);
    return `<div class="fl-duas">
      <div style="display:flex;flex-direction:column;gap:20px">${grupos}
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
          <span style="font-size:12px;color:var(--texto2)">Será registrado por <b style="color:#000">${esc(FL.usuario() || '—')}</b>. Ao salvar, avisos e atrasos são recalculados.</span>
          <div style="display:flex;gap:8px"><button type="button" class="btn sec grande" data-op="desfazer-prazos">Desfazer alterações</button><button type="button" class="btn grande" data-op="salvar-prazos">Salvar prazos</button></div>
        </div></div>
      <section aria-labelledby="cfgFerTit" style="display:flex;flex-direction:column;gap:12px">
        <div><h2 id="cfgFerTit" style="margin:0;font-size:18px">Feriados</h2><p style="margin:4px 0 0;font-size:14px;color:var(--texto2);line-height:1.45">Não contam como dia útil. Nacionais, SP estado e capital.</p></div>
        <div class="chips" role="group" aria-label="Ano">${anos.map((a) => `<button type="button" class="chip" data-ano="${a}" aria-pressed="${a === st.ano}">${a}</button>`).join('')}</div>
        <div class="fl-tabela-caixa" style="max-height:460px"><table class="fl-tabela"><thead><tr><th>Data</th><th>Feriado</th><th><span class="oculto">Ação</span></th></tr></thead><tbody>
          ${fer.length ? fer.map((f) => `<tr><td class="nw"><b>${FL.dataCurta(f.data)}</b><span class="sub">${SEMANA[new Date(f.data + 'T12:00:00').getDay()]}</span></td>
            <td>${esc(f.nome)}<span class="sub">${esc(f.abrangencia || '')}</span></td>
            <td class="dir"><button type="button" class="link" style="font-size:13px" data-op="remover-feriado" data-id="${f.id}" aria-label="Remover ${esc(f.nome)}">remover</button></td></tr>`).join('') : '<tr><td colspan="3" class="vazio">Nenhum feriado neste ano.</td></tr>'}
        </tbody></table></div>
        <button type="button" class="btn sec" style="align-self:flex-start" data-op="novo-feriado">+ Adicionar feriado ou ponte</button>
      </section></div>`;
  }

  async function salvarPrazos() {
    const mud = {};
    Object.keys(st.prazosEdit).forEach((k) => { if (st.prazosEdit[k] !== st.prazos[k]) mud[k] = st.prazosEdit[k]; });
    if (!Object.keys(mud).length) { FL.toast('Nada mudou nos prazos.'); return; }
    const antes = {};
    Object.keys(mud).forEach((k) => { antes[k] = st.prazos[k]; });
    if (!(await FL.api('PUT', '/api/v2/prazos', mud, { senha: true }))) return;
    st.prazosEdit = null;
    await carregar(); desenhar();
    FL.toast('Prazos salvos. Avisos e atrasos foram recalculados.', { desfazer: async () => {
      if (await FL.api('PUT', '/api/v2/prazos', antes, { senha: true })) { st.prazosEdit = null; await carregar(); desenhar(); }
    } });
  }

  function novoFeriado() {
    FL.gaveta({ sobre: 'PRAZOS E FERIADOS', titulo: 'Adicionar feriado ou ponte', botao: 'Adicionar',
      html: `<div class="campo"><label for="ferData">Data <span style="font-weight:400">(obrigatório)</span></label><input id="ferData" type="date"></div>
        <div class="campo"><label for="ferNome">Nome <span style="font-weight:400">(obrigatório)</span></label><input id="ferNome" type="text" maxlength="80" placeholder="Ex.: Ponte de Natal"></div>`,
      aoSalvar: async (g) => {
        const data = g.querySelector('#ferData').value, nome = g.querySelector('#ferNome').value.trim();
        if (!data) { g.erro('Escolha a data.'); return false; }
        if (!nome) { g.erro('Dê um nome ao feriado.'); return false; }
        const r = await FL.api('POST', '/api/v2/feriados', { data, nome }, { senha: true });
        if (!r) return false;
        st.ano = data.slice(0, 4);
        await carregar(); desenhar();
        FL.toast(`"${nome}" adicionado. ${FL.dataCurta(data)} não conta mais como dia útil.`, { desfazer: async () => {
          if (await FL.api('DELETE', '/api/v2/feriados/' + r.id, null, { senha: true })) { await carregar(); desenhar(); }
        } });
        return true;
      } });
  }

  async function removerFeriado(id) {
    const r = await FL.api('DELETE', '/api/v2/feriados/' + id, null, { senha: true });
    if (!r) return;
    const f = r.apagado;
    await carregar(); desenhar();
    FL.toast(`Feriado "${f.nome}" removido. ${FL.dataCurta(f.data)} volta a ser dia útil.`, { desfazer: async () => {
      if (await FL.api('POST', '/api/v2/feriados', { data: f.data, nome: f.nome, abrangencia: f.abrangencia }, { senha: true })) { await carregar(); desenhar(); }
    } });
  }

  // ---------------- Backup ----------------
  function htmlBackup() {
    const d = diasDesdeBackup();
    return `<div class="fl-duas">
      <div style="display:flex;flex-direction:column;gap:20px">
        <section class="fl-secao forte"><div><h2 style="font-size:20px">Baixar backup agora</h2>
          <p>Todos os dados e PDFs (.zip).</p></div>
          ${st.senhaDefinida ? `<div class="campo"><label for="cfgSenhaBackup">Senha de administrador</label>
            <input id="cfgSenhaBackup" type="password" autocomplete="current-password" placeholder="Digite a senha">
            </div>
            <button type="button" class="btn grande" data-op="baixar">Baixar backup (.zip)</button>
            <button type="button" class="link" style="align-self:flex-start" data-op="trocar-senha">Trocar a senha</button>
            <button type="button" class="link" style="align-self:flex-start" data-op="bloquear">Bloquear as Configurações (sair)</button>`
            : `<p class="aviso">Senha de administrador não definida.</p>
            <button type="button" class="btn grande" data-op="definir-senha">Definir senha</button>`}
        </section>
        <section class="fl-secao"><h2 style="font-size:20px">Senhas das telas</h2>
          <p>A senha de administrador abre todas.</p>
          ${(st.senhasTelas || []).map((t) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--c2)">
            <span><b>${esc(t.nome)}</b> <span class="selo ${t.definida ? 'ok' : 'contorno'}" style="margin-left:6px">${t.definida ? 'com senha' : 'sem senha'}</span></span>
            <span style="display:flex;gap:12px"><button type="button" class="link" data-op="senha-tela" data-tela="${t.tela}" data-nome="${esc(t.nome)}">${t.definida ? 'Trocar' : 'Definir'}</button>
            ${t.definida ? `<button type="button" class="link" data-op="tirar-senha-tela" data-tela="${t.tela}" data-nome="${esc(t.nome)}">Tirar</button>` : ''}</span></div>`).join('')}
        </section>
      </div>
      <section aria-labelledby="cfgHistBk" style="display:flex;flex-direction:column;gap:12px">
        <h2 id="cfgHistBk" style="margin:0;font-size:18px">Backups feitos</h2>
        <div class="fl-tabela-caixa" style="max-height:560px"><table class="fl-tabela"><thead><tr><th>Quando<small>quem baixou</small></th><th>Arquivo<small>tamanho</small></th></tr></thead><tbody>
          ${st.backups.length ? st.backups.map((b) => `<tr><td><b>${FL.dataHora(b.quando)}</b><span class="sub">${esc(b.por || '—')}</span></td>
            <td><span style="word-break:break-all">${esc(b.arquivo)}</span><span class="sub">${FL.num((b.tamanho_bytes || 0) / 1048576, 1)} MB</span></td></tr>`).join('') : '<tr><td colspan="2" class="vazio">Nenhum backup registrado.</td></tr>'}
        </tbody></table></div>
        ${d != null && d >= 3 ? `<p class="aviso">Último backup há ${d} dias.</p>` : ''}
      </section></div>`;
  }

  async function baixarBackup() {
    const inp = el.querySelector('#cfgSenhaBackup');
    const senha = inp.value;
    if (!senha) { FL.toast('Digite a senha de administrador.', { erro: true }); inp.focus(); return; }
    const fd = new FormData(); fd.append('senha', senha);
    FL.toast('Gerando o backup…');
    const r = await FL.api('POST', '/api/backup', null, { form: fd, blob: true });
    if (!r) return;
    FL.baixarArquivo(r.blob, r.nome || 'flowlog_backup.zip');
    inp.value = '';
    await carregar(); desenhar();
    FL.toast(`Backup baixado: ${r.nome} (${FL.num(r.blob.size / 1048576, 1)} MB).`);
  }

  // ------------------------------------------------------------------
  function ligarEventos() {
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; desenhar(); return; }
      if (t.dataset.ir) { const [aba, tipo] = t.dataset.ir.split(':'); st.aba = aba; if (tipo) st.tipoSel = tipo; desenhar(); return; }
      if (t.dataset.tipo) { st.tipoSel = t.dataset.tipo; desenhar(); return; }
      if (t.dataset.lista) { st.listaSel = t.dataset.lista; desenhar(); return; }
      if (t.dataset.ano) { st.ano = t.dataset.ano; desenhar(); return; }
      if (t.dataset.escolher) { el.querySelector(t.dataset.escolher === 'pdfs' ? '#cfgArqPdf' : '#cfgArqPlan').click(); return; }
      if (t.dataset.pz) {
        const k = t.dataset.pz, [mn, mx] = LIMITES[k];
        st.prazosEdit[k] = Math.min(mx, Math.max(mn, st.prazosEdit[k] + Number(t.dataset.d)));
        desenhar(); return;
      }
      const op = t.dataset.op;
      if (!op) return;
      if (['adicionar', 'apagar', 'desativar', 'reativar'].includes(op)) return acaoLista(op, t);
      if (op === 'salvar-prazos') return salvarPrazos();
      if (op === 'desfazer-prazos') { st.prazosEdit = Object.assign({}, st.prazos); desenhar(); return; }
      if (op === 'novo-feriado') return novoFeriado();
      if (op === 'remover-feriado') return removerFeriado(t.dataset.id);
      if (op === 'baixar') return baixarBackup();
      if (op === 'definir-senha') { if (await FL.definirSenha()) { await carregar(); desenhar(); } return; }
      if (op === 'trocar-senha') { await FL.definirSenha(true); return; }
      if (op === 'senha-tela') {
        const tela = t.dataset.tela, nome = t.dataset.nome;
        FL.modal({ titulo: 'Senha da tela ' + nome, botao: 'Salvar',
          html: `<div class="campo"><label for="stNova">Nova senha (mínimo 4 caracteres)</label><input id="stNova" type="password" autocomplete="new-password"></div>
            <div class="campo"><label for="stNova2">Repita</label><input id="stNova2" type="password" autocomplete="new-password"></div>`,
          aoConfirmar: async (m) => {
            const a = m.querySelector('#stNova').value, b = m.querySelector('#stNova2').value;
            if (a.length < 4) { FL.toast('A senha precisa ter pelo menos 4 caracteres.', { erro: true }); return false; }
            if (a !== b) { FL.toast('As duas senhas não são iguais.', { erro: true }); return false; }
            if (!(await FL.api('PUT', '/api/v2/senha-tela/' + tela, { nova: a }, { senha: true }))) return false;
            await carregar(); desenhar(); FL.toast('Senha da tela ' + nome + ' salva.');
            return true;
          } });
        return;
      }
      if (op === 'tirar-senha-tela') {
        if (await FL.api('PUT', '/api/v2/senha-tela/' + t.dataset.tela, { nova: null }, { senha: true })) { await carregar(); desenhar(); FL.toast('A tela ' + t.dataset.nome + ' abre sem senha.'); }
        return;
      }
      if (op === 'bloquear') { FL.esquecerSenha(); FL.toast('Configurações bloqueadas.'); FL.telas.configuracoes.montar(el); return; }
    });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'cfgArqPlan') { enviarPlanilhas(e.target.files); e.target.value = ''; }
      if (e.target.id === 'cfgArqPdf') { enviarPdfs(e.target.files); e.target.value = ''; }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'cfgNovoItem') acaoLista('adicionar'); if (e.key === 'Enter' && e.target.id === 'cfgSenhaBackup') baixarBackup(); });
    // arrastar e soltar na área de planilhas
    el.addEventListener('dragover', (e) => { const z = e.target.closest('.zona-arquivo'); if (z) { e.preventDefault(); z.classList.add('arrastando'); } });
    el.addEventListener('dragleave', (e) => { const z = e.target.closest('.zona-arquivo'); if (z) z.classList.remove('arrastando'); });
    el.addEventListener('drop', (e) => {
      const z = e.target.closest('.zona-arquivo');
      if (!z) return;
      e.preventDefault(); z.classList.remove('arrastando');
      const arqs = [...e.dataTransfer.files];
      const pdfs = arqs.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
      const plan = arqs.filter((f) => !f.name.toLowerCase().endsWith('.pdf'));
      if (plan.length) enviarPlanilhas(plan);
      if (pdfs.length) enviarPdfs(pdfs);
    });
  }

  // ------------------------------------------------------------------
  // Entrada protegida: as Configurações só abrem com a senha de
  // administrador (decisão do Rian, 18/11). A senha fica guardada só até
  // fechar o navegador; "Bloquear" esquece na hora.
  // ------------------------------------------------------------------
  async function senhaValida() {
    const s = FL.senhaGuardada();
    if (!s) return false;
    const r = await FL.api('POST', '/api/v2/senha/conferir', { senha: s }, { silencioso: true });
    if (!r || !r.ok) { FL.esquecerSenha(); return false; }
    return true;
  }

  async function telaBloqueio(alvo) {
    const st0 = await FL.api('GET', '/api/v2/senha', null, { silencioso: true });
    const definida = !!(st0 && st0.definida);
    alvo.innerHTML = `<div class="fl-cabeca fl-entra"><div class="txt"><h1>Configurações</h1></div></div>
      <section class="fl-secao forte fl-entra d1" style="max-width:460px">
        <span aria-hidden="true" style="width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--r-btn);background:var(--c1)">${FL.icone.cadeado}</span>
        <h2 style="font-size:20px">${definida ? 'Área protegida' : 'Defina a senha de administrador'}</h2>
        <p>${definida ? 'Senha de administrador.' : 'Senha de administrador não definida. Não pode ser recuperada.'}</p>
        ${definida ? `<div class="campo"><label for="cfgEntrar">Senha de administrador</label><input id="cfgEntrar" type="password" autocomplete="current-password"></div>
          <button type="button" class="btn grande" data-entrar>Entrar</button>` : '<button type="button" class="btn grande" data-definir>Definir senha</button>'}
      </section>`;
    const entrar = async () => {
      const inp = alvo.querySelector('#cfgEntrar');
      if (!inp.value) { inp.focus(); return; }
      const r = await FL.api('POST', '/api/v2/senha/conferir', { senha: inp.value });
      if (!r) return;
      if (!r.ok) { FL.toast('Senha errada.', { erro: true }); inp.select(); return; }
      try { sessionStorage.setItem('fl_senha', inp.value); } catch (e) { /* sem armazenamento: pede de novo depois */ }
      FL.telas.configuracoes.montar(alvo);
    };
    alvo.addEventListener('click', async (e) => {
      if (e.target.closest('[data-entrar]')) entrar();
      if (e.target.closest('[data-definir]') && await FL.definirSenha()) FL.telas.configuracoes.montar(alvo);
    });
    alvo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'cfgEntrar') entrar(); });
    setTimeout(() => { const i = alvo.querySelector('#cfgEntrar'); if (i) i.focus(); }, 60);
  }

  FL.telas.configuracoes = {
    montar: async function (alvo) {
      if (!(await senhaValida())) {
        const novo = alvo.cloneNode(false); // tira eventos de uma tentativa anterior
        alvo.replaceWith(novo);
        return telaBloqueio(novo);
      }
      const limpo = alvo.cloneNode(false);
      alvo.replaceWith(limpo);
      el = limpo;
      st = { aba: (location.hash.split('?')[1] || '').replace('aba=', '') || 'todos', tipoSel: 'follow', listaSel: 'motivos',
        imp: {}, listas: [], prazos: {}, prazosEdit: null, feriados: [], backups: [], senhaDefinida: false, carregado: false };
      ligarEventos();
      desenhar();
      await carregar();
      desenhar();
    }
  };
})();
