/* FlowLog v2 — Pós-venda: Todos · Abertos · Concluídos (coordenação: Norma) */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  const ABERTOS = ['Encontrar solução', 'Em andamento'];
  const STATUS = ['Encontrar solução', 'Em andamento', 'Resolvido', 'Recusado'];
  const SELO = { 'Encontrar solução': 'contorno-alerta', 'Em andamento': '', 'Resolvido': 'ok', 'Recusado': 'preto' };
  // Sem login, Desfazer e Apagar aparecem para quem escolheu o nome Norma ou Rian (decisão de 11/11)
  const PODE_DESFAZER = ['norma', 'rian'];
  const MOTIVO_ROMANEIO = { 'Material errado': 'Erro de separação', 'Quantidade faltando': 'Erro de separação', 'Quantidade a mais': 'Erro de separação',
    'Defeito / qualidade': 'Produto com possível defeito', 'NF de devolução': 'Devolução', 'Avaria no transporte': 'Troca de material' };
  const MOTIVOS_ROMANEIO = ['Troca de material', 'Devolução', 'Garantia', 'Produto com possível defeito', 'Erro de separação', 'Outro'];

  let el, st;
  const ehAberto = (c) => ABERTOS.includes(c.status);
  const dias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
  const podeDesfazer = () => PODE_DESFAZER.includes(FL.semAcento(FL.usuario() || '').trim());
  const prazoVencido = (c) => ehAberto(c) && c.prazo_solucao && c.prazo_solucao < st.hoje;
  function garantia(c) {
    if (!c.canhoto_em) return { ok: true, txt: `Ainda sem canhoto: o prazo de ${st.prazoDias} dias começa quando ele chegar.` };
    const d = dias(c.canhoto_em, c.aberto_em);
    if (d <= st.prazoDias) return { ok: true, txt: `Dentro do prazo de ${st.prazoDias} dias: canhoto em ${FL.dataCurta(c.canhoto_em)}, aberto ${FL.plural(d, 'dia', 'dias')} depois.` };
    return { ok: false, txt: `Fora do prazo: canhoto em ${FL.dataCurta(c.canhoto_em)}, aberto ${d} dias depois. Motivo: ${c.justificativa || '—'}` };
  }
  function prazoTxt(c) {
    if (!ehAberto(c)) return 'Encerrado';
    if (!c.prazo_solucao) return 'Sem prazo';
    const d = dias(st.hoje, c.prazo_solucao);
    return d < 0 ? `Venceu ${FL.dataCurta(c.prazo_solucao)} · ${FL.plural(-d, 'dia', 'dias')}` : d === 0 ? 'Vence hoje' : 'Até ' + FL.dataCurta(c.prazo_solucao);
  }

  const DEFS = [
    { id: 'status', titulo: 'STATUS', ordem: STATUS, valor: (c) => [c.status] },
    { id: 'tipo', titulo: 'PROBLEMA', valor: (c) => [c.problema || '—'] },
    { id: 'resp', titulo: 'RESPONSÁVEL', valor: (c) => [c.responsavel || 'Sem responsável'] },
    { id: 'causa', titulo: 'CAUSA', valor: (c) => [c.causa || 'Ainda sem causa'] },
    { id: 'prazo', titulo: 'PRAZO DE SOLUÇÃO', ordem: ['Vencido', 'No prazo', 'Encerrado'], valor: (c) => [!ehAberto(c) ? 'Encerrado' : (prazoVencido(c) ? 'Vencido' : 'No prazo')] },
    { id: 'garantia', titulo: 'PRAZO DE 30 DIAS', ordem: ['Dentro', 'Fora (com justificativa)'], valor: (c) => [garantia(c).ok ? 'Dentro' : 'Fora (com justificativa)'] },
    { id: 'vendedor', titulo: 'VENDEDOR', valor: (c) => [c.vendedor || 'Sem vendedor'] },
    { id: 'cliente', titulo: 'CLIENTE', valor: (c) => [c.cliente || '—'] }
  ];
  function passaBusca(c) {
    if (!st.q) return true;
    const alvo = [c.numero, c.cliente, c.nf, c.pedido, c.vendedor, c.contato, c.problema].map((x) => FL.semAcento(x).replace(/[.\s-]/g, '')).join('|');
    return alvo.includes(st.q.replace(/-/g, ''));
  }
  const daAba = () => st.dados.filter((c) => (st.aba === 'abertos' ? ehAberto(c) : st.aba === 'concluidos' ? !ehAberto(c) : true));
  const filtrados = () => daAba().filter((c) => passaBusca(c) && FL.passaFiltros(c, DEFS, st.filtros));

  // ------------------------------------------------------------------
  function cabecalho() {
    return `<div class="fl-cabeca fl-entra"><div class="txt"><h1>Pós-venda</h1></div>
      <div class="fl-acoes-topo"><button type="button" class="btn" data-novo>+ Novo caso</button></div></div>`;
  }
  function desenhar() {
    if (!st.carregado) { el.innerHTML = cabecalho() + '<div class="fl-tabela-caixa"><div class="carregando"><div class="esqueleto" style="margin:8px 0"></div></div></div>'; return; }
    const todos = st.dados;
    const abertos = todos.filter(ehAberto);
    const resolvidos = todos.filter((c) => c.status === 'Resolvido');
    const causas = {};
    todos.forEach((c) => { if (c.causa) causas[c.causa] = (causas[c.causa] || 0) + 1; });
    const top = Object.entries(causas).sort((a, b) => b[1] - a[1])[0];
    const vencidos = todos.filter(prazoVencido).length;
    const lista = filtrados();
    const abas = [{ id: 'todos', rotulo: 'Todos', qtd: todos.length }, { id: 'abertos', rotulo: 'Abertos', qtd: abertos.length }, { id: 'concluidos', rotulo: 'Concluídos', qtd: todos.length - abertos.length }];
    el.innerHTML = cabecalho() + `
      <div class="fl-cartoes fl-entra d1">
        <button type="button" class="fl-cartao" data-cartao="abertos"><span class="v">${abertos.length}</span><span class="r">Casos abertos</span><span class="s"></span></button>
        <button type="button" class="fl-cartao" data-cartao="vencidos"><span class="v" style="color:${vencidos ? 'var(--alerta)' : '#000'}">${vencidos}</span><span class="r">Com prazo de solução vencido</span><span class="s"></span></button>
        <button type="button" class="fl-cartao" data-cartao="resolvidos"><span class="v">${resolvidos.length}</span><span class="r">Resolvidos</span><span class="s"></span></button>
        <button type="button" class="fl-cartao" data-cartao="causa"><span class="v" style="font-size:${top && top[0].length > 10 ? '22px' : ''}">${top ? esc(top[0]) : '—'}</span><span class="r">Causa mais comum</span><span class="s">${top ? FL.plural(top[1], 'caso', 'casos') : 'nenhum caso encerrado'}</span></button>
      </div>
      <div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px">
        <div class="fl-barra-abas">${FL.htmlAbas(abas, st.aba, 'Abas do pós-venda')}${FL.botaoFiltros(st.filtros)}</div>
        ${FL.htmlChipsAtivos(DEFS, st.filtros)}
      </div>
      <div class="fl-tabela-caixa fl-entra d2"><table class="fl-tabela"><thead><tr>
        <th>Caso<small>aberto em</small></th><th>Cliente<small>NF · pedido</small></th><th>Problema<small>o que o cliente disse</small></th><th>Status<small>responsável · prazo de solução</small></th>
      </tr></thead><tbody>
        ${lista.length ? lista.map(linha).join('') : `<tr><td colspan="4" class="vazio">${st.q || FL.qtdFiltros(st.filtros) ? 'Nenhum caso com essa busca ou filtros. <button type="button" class="link" data-limpar-filtros>Limpar</button>' : (todos.length ? 'Nenhum caso aqui.' : 'Nenhum caso ainda. Use "+ Novo caso" (ou o "+" na linha do pedido, em Pedidos).')}</td></tr>`}
      </tbody></table></div>`;
  }
  function linha(c) {
    const aberto = !!st.abertos[c.id];
    const venc = prazoVencido(c);
    return `<tr class="${aberto ? 'aberta' : ''}">
      <td class="nw"><button type="button" class="fl-link-linha" data-abrir="${c.id}" aria-expanded="${aberto}" aria-label="Mostrar o caso ${esc(c.numero)}">${FL.icone.seta}${esc(c.numero)}</button><span class="sub" style="padding-left:18px">${FL.dataCurta(c.aberto_em)}${c.aberto_por ? ' · ' + esc(c.aberto_por) : ''}</span></td>
      <td style="max-width:260px"><b>${esc(c.cliente || '—')}</b><span class="sub">${c.nf ? 'NF ' + esc(c.nf) : 'sem NF'}${c.pedido ? ' · pedido ' + esc(c.pedido) : ''}</span></td>
      <td style="max-width:380px"><b>${esc(c.problema || '—')}</b><span class="sub">${esc((c.descricao || '').slice(0, 140))}</span></td>
      <td><span class="selo ${SELO[c.status] || ''}">${esc(c.status)}</span><span class="sub" style="margin-top:4px;${venc ? 'color:var(--alerta);font-weight:700' : ''}">${esc(c.responsavel || 'sem responsável')} · ${esc(prazoTxt(c))}</span></td></tr>
      ${aberto ? `<tr class="detalhe"><td colspan="4">${detalheHtml(c)}</td></tr>` : ''}`;
  }
  function detalheHtml(c) {
    const g = garantia(c);
    const ult = c.atualizacoes[c.atualizacoes.length - 1];
    const pode = podeDesfazer();
    const campos = [['STATUS', c.status], ['RESPONSÁVEL', c.responsavel || '—'], ['SOLUÇÃO', c.solucao || '—'], ['CAUSA', c.causa || '—']];
    return `<div style="display:flex;flex-direction:column;gap:14px">
      <span class="rotulo-secao">CASO ${esc(c.numero)} · ABERTO ${FL.dataCurta(c.aberto_em)}${c.aberto_por ? ' POR ' + esc(c.aberto_por.toUpperCase()) : ''}</span>
      <p class="${g.ok ? 'aviso info' : 'aviso'}">${esc(g.txt)}</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px 24px;font-size:13px;color:var(--texto2)">
        <span>Contato: <b style="color:#000">${esc([c.contato, c.telefone].filter(Boolean).join(' · ') || '—')}</b></span>
        <span>Vendedor: <b style="color:#000">${esc(c.vendedor || '—')}</b></span>${c.tipo_entrega ? `<span>Entrega: <b style="color:#000">${esc(c.tipo_entrega)}</b></span>` : ''}
        <button type="button" class="link" style="font-size:13px" data-contato="${c.id}">editar contato</button></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">${campos.map((x) => `<div class="cartao-mini"><span class="rotulo-secao">${x[0]}</span><b>${esc(x[1])}</b></div>`).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start">
        <div style="flex:2 1 420px;min-width:0;display:flex;flex-direction:column;gap:8px"><span class="rotulo-secao">O QUE O CLIENTE DISSE</span><p style="margin:0;font-size:15px">${esc(c.descricao || '—')}</p>
          <span class="rotulo-secao" style="margin-top:8px">ATUALIZAÇÕES</span>
          <ol class="linha-tempo">${c.atualizacoes.slice().reverse().map((a) => `<li><b style="font-size:13px">${FL.dataCurta(a.data)}${a.por ? ' · ' + esc(a.por) : ''}${a.mudou ? ' · ' + esc(a.mudou) : ''}</b><span style="font-size:14px">${esc(a.texto)}</span></li>`).join('')}</ol>
          ${pode ? `<div style="display:flex;flex-wrap:wrap;gap:6px 18px">${ult && !ult.abertura ? `<button type="button" class="link" style="font-size:13px" data-desfazer-at="${c.id}" data-at="${ult.id}">Desfazer esta atualização</button>` : ''}
            <button type="button" class="link" style="font-size:13px;color:var(--alerta)" data-apagar="${c.id}">Apagar este caso</button></div>` : '<span style="font-size:12px;color:var(--texto2)">Desfazer e apagar: só Norma e Rian.</span>'}
        </div>
        <div style="flex:1 1 220px;display:flex;flex-direction:column;gap:8px">
          <button type="button" class="btn" data-atualizar="${c.id}">Registrar atualização</button>
          <button type="button" class="btn sec" data-romaneio="${c.id}">Romaneio</button>
        </div>
      </div></div>`;
  }

  // ------------------------------------------------------------------
  async function carregar() {
    const r = await FL.api('GET', '/api/v2/posvenda');
    st.carregado = true;
    if (!r) return;
    st.dados = r.casos; st.hoje = r.hoje; st.prazoDias = r.prazo_dias;
  }
  async function recarregar() { await carregar(); desenhar(); FL.atualizarContagens(); }
  const achar = (id) => st.dados.find((c) => String(c.id) === String(id));
  async function listas() {
    if (!st.listas) {
      const [problemas, solucoes, causas, responsaveis] = await Promise.all(['problemas', 'solucoes', 'causas', 'responsaveis'].map((l) => FL.api('GET', `/api/v2/listas/${l}/ativas`, null, { silencioso: true })));
      st.listas = { problemas: problemas || [], solucoes: solucoes || [], causas: causas || [], responsaveis: responsaveis || [] };
    }
    return st.listas;
  }

  // ------------------------------------------------------------------
  // Novo caso
  // ------------------------------------------------------------------
  async function formNovo(inicial) {
    const L = await listas();
    let achado = null, resp = '';
    const prazoPadrao = FL.somarDias(st.hoje, 2);
    FL.gaveta({ sobre: 'PÓS-VENDA', titulo: 'Novo caso', botao: 'Abrir caso', largura: 560,
      html: `<div class="campo"><label for="pvBusca">Nota fiscal ou número do pedido <span style="font-weight:400">(com ou sem ponto)</span></label>
          <div style="display:flex;gap:8px"><input id="pvBusca" type="text" inputmode="numeric" value="${esc(inicial || '')}" style="flex:1"><button type="button" class="btn sec" data-buscar-pv>Buscar</button></div></div>
        <div data-achado></div>
        <div class="campo"><label for="pvProblema">Problema <span style="font-weight:400">(obrigatório)</span></label><select id="pvProblema"><option value="">Escolha…</option>${L.problemas.map((p) => `<option>${esc(p)}</option>`).join('')}</select></div>
        <div class="campo"><label for="pvDesc">O que o cliente disse <span style="font-weight:400">(obrigatório)</span></label><textarea id="pvDesc" rows="3" maxlength="2000"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="campo"><label for="pvContato">Contato</label><input id="pvContato" type="text" maxlength="120" placeholder="Nome de quem ligou"></div>
          <div class="campo"><label for="pvTel">Telefone</label><input id="pvTel" type="tel" maxlength="40"></div></div>
        <div class="campo"><span class="rot" id="pvRespRot">Quem vai resolver</span><div class="chips" role="group" aria-labelledby="pvRespRot">${L.responsaveis.map((r) => `<button type="button" class="chip" data-resp="${esc(r)}" aria-pressed="false">${esc(r)}</button>`).join('')}</div></div>
        <div class="campo"><label for="pvPrazo">Prazo para resolver</label><input id="pvPrazo" type="date" value="${prazoPadrao}" min="${st.hoje}"></div>`,
      aoAbrir: (g) => {
        const buscar = async () => {
          const q = g.querySelector('#pvBusca').value.trim();
          const caixa = g.querySelector('[data-achado]');
          achado = null;
          if (!q) { caixa.innerHTML = ''; return; }
          caixa.innerHTML = '<div class="carregando">Procurando…</div>';
          const r = await FL.api('GET', '/api/v2/posvenda/buscar?q=' + encodeURIComponent(q), null, { silencioso: true });
          if (g.querySelector('#pvBusca').value.trim() !== q) return; // o número mudou enquanto procurava
          achado = r;
          if (r) achado.q = q;
          if (!achado) { caixa.innerHTML = `<p class="aviso">Nota ou pedido ${esc(q)} não encontrado.</p>`; return; }
          desenharAchado(g);
        };
        g.addEventListener('click', (e) => {
          if (e.target.closest('[data-buscar-pv]')) buscar();
          const r = e.target.closest('[data-resp]');
          if (r) { resp = r.dataset.resp === resp ? '' : r.dataset.resp; g.querySelectorAll('[data-resp]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.resp === resp))); }
        });
        g.querySelector('#pvBusca').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
        g.querySelector('#pvBusca').addEventListener('change', buscar);
        g.addEventListener('change', (e) => { if (e.target.id === 'pvNf') { achado.nf = e.target.value; desenharAchado(g); } });
        if (inicial) buscar();
      },
      aoSalvar: async (g) => {
        if (!achado || achado.q !== g.querySelector('#pvBusca').value.trim()) { g.erro('Busque uma nota ou pedido existente.'); return false; }
        const fora = foraDoPrazo();
        const just = g.querySelector('#pvJust') ? g.querySelector('#pvJust').value.trim() : '';
        if (fora && !just) { g.erro(`Está fora do prazo de ${st.prazoDias} dias: escreva por que vai abrir assim mesmo.`); return false; }
        const problema = g.querySelector('#pvProblema').value, descricao = g.querySelector('#pvDesc').value.trim();
        if (!problema) { g.erro('Escolha o problema.'); return false; }
        if (!descricao) { g.erro('Escreva o que o cliente disse.'); return false; }
        const r = await FL.api('POST', '/api/v2/posvenda', { pedido: achado.pedido, nf: achado.nf, cliente: achado.cliente, problema, descricao,
          contato: g.querySelector('#pvContato').value, telefone: g.querySelector('#pvTel').value, responsavel: resp || null,
          prazo_solucao: g.querySelector('#pvPrazo').value || null, justificativa: just || null });
        if (!r) return false;
        st.abertos[r.id] = true; st.aba = 'todos'; st.filtros = {};
        await recarregar();
        FL.toast(`Caso ${r.numero} aberto.${resp ? ' Responsável: ' + resp + '.' : ''}`);
        return true;
      } });
    function nfAtual() { return achado && achado.nfs.find((n) => n.nf === achado.nf); }
    function foraDoPrazo() {
      const n = nfAtual();
      return !!(n && n.canhoto && n.entrega && dias(n.entrega, st.hoje) > st.prazoDias);
    }
    function desenharAchado(g) {
      const n = nfAtual();
      const fora = foraDoPrazo();
      let gar = 'Sem NF: o prazo de 30 dias não pode ser conferido.';
      if (n) gar = !n.canhoto || !n.entrega ? `Ainda sem canhoto: o prazo de ${st.prazoDias} dias começa quando ele chegar.` : `${fora ? 'Fora' : 'Dentro'} do prazo de ${st.prazoDias} dias: canhoto em ${FL.dataCurta(n.entrega)} (${FL.plural(dias(n.entrega, st.hoje), 'dia', 'dias')}).`;
      g.querySelector('[data-achado]').innerHTML = `<div class="cartao-mini" style="gap:6px">
          <b>${esc(achado.cliente || 'Cliente não informado')}</b>
          <span style="font-size:13px;color:var(--texto2)">${achado.pedido ? 'Pedido ' + esc(achado.pedido) : 'Sem pedido ligado'}${achado.tipo_entrega ? ' · ' + esc(achado.tipo_entrega) : ''} · vendedor ${esc(achado.vendedor || 'não informado')}</span>
          ${achado.nfs.length > 1 ? `<div class="campo"><label for="pvNf">Nota fiscal do problema</label><select id="pvNf">${achado.nfs.map((x) => `<option value="${esc(x.nf)}" ${x.nf === achado.nf ? 'selected' : ''}>NF ${esc(x.nf)}${x.cancelada ? ' (cancelada)' : ''}${x.faturamento ? ' · faturada ' + FL.dataCurta(x.faturamento) : ''}</option>`).join('')}</select></div>` : (achado.nf ? `<span style="font-size:13px">NF <b>${esc(achado.nf)}</b></span>` : '')}
          <span style="font-size:13px;font-weight:700;color:${fora ? 'var(--alerta)' : 'var(--verde-escuro,#1E7A52)'}">${esc(gar)}</span></div>
        ${fora ? `<div class="campo"><label for="pvJust">Por que abrir fora do prazo? <span style="font-weight:400">(obrigatório)</span></label><input id="pvJust" type="text" maxlength="300" placeholder="Ex.: cliente antigo, Guilherme pediu para atender como cortesia"></div>` : ''}`;
    }
  }

  // ------------------------------------------------------------------
  // Registrar atualização
  // ------------------------------------------------------------------
  async function formAtualizar(c) {
    const L = await listas();
    let status = c.status;
    let resp = c.responsavel || '';
    const desenharCampos = (g) => {
      const pedeSol = status === 'Em andamento' || status === 'Resolvido';
      const pedeCausa = status === 'Resolvido' || status === 'Recusado';
      g.querySelector('[data-sol]').hidden = !pedeSol && !c.solucao;
      g.querySelector('[data-causa]').hidden = !pedeCausa;
      g.querySelector('[data-recusa]').hidden = status !== 'Recusado';
      g.querySelector('[data-sol-rot]').textContent = pedeSol ? '(obrigatória)' : '(opcional)';
    };
    FL.gaveta({ sobre: 'CASO ' + c.numero + ' · ' + (c.cliente || ''), titulo: 'Registrar atualização', sub: `${c.problema || ''} · hoje: ${c.status}`, botao: 'Registrar', largura: 520,
      html: `<div class="campo"><label for="atTexto">O que aconteceu <span style="font-weight:400">(obrigatório)</span></label><textarea id="atTexto" rows="3" maxlength="2000"></textarea></div>
        <div class="campo"><span class="rot" id="atStRot">Status</span><div class="seg" style="grid-template-columns:repeat(2,1fr)" role="group" aria-labelledby="atStRot">${STATUS.map((s) => `<button type="button" data-st="${s}" aria-pressed="${s === status}">${s}</button>`).join('')}</div></div>
        <div class="campo" data-sol><label for="atSol">Solução <span data-sol-rot style="font-weight:400"></span></label><select id="atSol"><option value="">${c.solucao ? 'Manter: ' + esc(c.solucao) : 'Escolha…'}</option>${L.solucoes.map((s) => `<option>${esc(s)}</option>`).join('')}</select></div>
        <div class="campo" data-causa hidden><label for="atCausa">Causa <span style="font-weight:400">(obrigatória para encerrar)</span></label><select id="atCausa"><option value="">Escolha a causa…</option>${L.causas.map((s) => `<option ${s === c.causa ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div class="campo" data-recusa hidden><label for="atRecusa">Por que foi recusado <span style="font-weight:400">(obrigatório)</span></label><input id="atRecusa" type="text" maxlength="300"></div>
        <div class="campo"><span class="rot" id="atRespRot">Quem resolve</span><div class="chips" role="group" aria-labelledby="atRespRot">${L.responsaveis.concat(resp && !L.responsaveis.includes(resp) ? [resp] : []).map((r) => `<button type="button" class="chip" data-resp="${esc(r)}" aria-pressed="${r === resp}">${esc(r)}</button>`).join('')}</div></div>
        <div class="campo"><label for="atPrazo">Prazo para resolver</label><input id="atPrazo" type="date" value="${esc(c.prazo_solucao || '')}"></div>`,
      aoAbrir: (g) => {
        desenharCampos(g);
        g.addEventListener('click', (e) => {
          const s = e.target.closest('[data-st]');
          if (s) { status = s.dataset.st; g.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-pressed', String(x === s))); desenharCampos(g); g.erro(''); }
          const r = e.target.closest('[data-resp]');
          if (r) { resp = r.dataset.resp; g.querySelectorAll('[data-resp]').forEach((x) => x.setAttribute('aria-pressed', String(x === r))); }
        });
      },
      aoSalvar: async (g) => {
        const texto = g.querySelector('#atTexto').value.trim();
        const sol = g.querySelector('#atSol').value || null;
        const causa = g.querySelector('#atCausa').value || null;
        const recusa = g.querySelector('#atRecusa').value.trim();
        if (!texto) { g.erro('Escreva o que aconteceu.'); return false; }
        if ((status === 'Em andamento' || status === 'Resolvido') && !sol && !c.solucao) { g.erro('Escolha a solução.'); return false; }
        if ((status === 'Resolvido' || status === 'Recusado') && !causa) { g.erro('Escolha a causa para encerrar o caso.'); return false; }
        if (status === 'Recusado' && !recusa) { g.erro('Escreva por que foi recusado.'); return false; }
        const r = await FL.api('POST', `/api/v2/posvenda/${c.id}/atualizacoes`, { texto, status, solucao: sol, causa, motivo_recusa: recusa || null, responsavel: resp || null, prazo_solucao: g.querySelector('#atPrazo').value || null });
        if (!r) return false;
        await recarregar();
        FL.toast(`Atualização registrada no caso ${c.numero}.`, { desfazer: async () => { if (await FL.api('DELETE', `/api/v2/posvenda/${c.id}/atualizacoes/${r.id}`)) recarregar(); } });
        return true;
      } });
  }

  function formContato(c) {
    FL.gaveta({ sobre: 'CASO ' + c.numero, titulo: 'Contato e endereço', botao: 'Salvar',
      html: `<div class="campo"><label for="ctNome">Contato</label><input id="ctNome" type="text" maxlength="120" value="${esc(c.contato || '')}"></div>
        <div class="campo"><label for="ctTel">Telefone</label><input id="ctTel" type="tel" maxlength="40" value="${esc(c.telefone || '')}"></div>
        <div class="campo"><label for="ctEnd">Endereço para a retirada</label><textarea id="ctEnd" rows="3" maxlength="500">${esc(c.endereco || '')}</textarea></div>`,
      aoSalvar: async (g) => {
        const corpo = { contato: g.querySelector('#ctNome').value, telefone: g.querySelector('#ctTel').value, endereco: g.querySelector('#ctEnd').value };
        if (!(await FL.api('PUT', `/api/v2/posvenda/${c.id}`, corpo))) return false;
        await recarregar(); FL.toast('Contato salvo.');
        return true;
      } });
  }

  function formApagar(c) {
    FL.modal({ titulo: `Apagar o caso ${c.numero}?`, perigo: true, botao: 'Apagar caso',
      html: `<p>${esc(c.cliente || '')} · ${esc(c.problema || '')}. O caso e as atualizações saem da lista. Logo depois aparece um botão <b>Desfazer</b>, caso tenha sido engano.</p>`,
      aoConfirmar: async () => {
        if (!(await FL.api('DELETE', `/api/v2/posvenda/${c.id}`))) return false;
        delete st.abertos[c.id];
        await recarregar();
        FL.toast(`Caso ${c.numero} apagado.`, { desfazer: async () => { if (await FL.api('POST', `/api/v2/posvenda/${c.id}/restaurar`)) recarregar(); } });
        return true;
      } });
  }

  // ------------------------------------------------------------------
  // Romaneio (prévia preenchida pelo caso, imprimir/salvar PDF)
  // ------------------------------------------------------------------
  async function romaneio(c) {
    const itens = (await FL.api('GET', `/api/v2/posvenda/${c.id}/itens`, null, { silencioso: true })) || [];
    const motivo = MOTIVO_ROMANEIO[c.problema] || 'Outro';
    const itensTxt = itens.map((i) => `${FL.num(i.quantidade, (i.quantidade || 0) % 1 ? 2 : 0)} ${i.unidade || ''} · ${i.codigo || ''} · ${i.descricao || ''}`.trim()).join('\n');
    FL.gaveta({ sobre: 'PRÉVIA · DADOS VÊM DO CASO ' + c.numero, titulo: 'Romaneio', botao: 'Imprimir / salvar PDF', cancelar: 'Fechar', semAutor: true, largura: 560,
      html: `<div class="campo"><label for="rmData">Data da retirada</label><input id="rmData" type="date" value="${FL.somarDias(st.hoje, 1)}"></div>
        <div class="campo"><label for="rmCliente">Cliente</label><input id="rmCliente" type="text" value="${esc(c.cliente || '')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="campo"><label for="rmContato">Contato</label><input id="rmContato" type="text" value="${esc(c.contato || '')}"></div>
          <div class="campo"><label for="rmTel">Telefone</label><input id="rmTel" type="text" value="${esc(c.telefone || '')}"></div></div>
        <div class="campo"><label for="rmNf">Nota fiscal</label><input id="rmNf" type="text" value="${esc(c.nf || 'Verbal')}"></div>
        <div class="campo"><label for="rmEnd">Endereço</label><textarea id="rmEnd" rows="2">${esc(c.endereco || '')}</textarea></div>
        <div class="campo"><label for="rmItens">Itens (um por linha)</label><textarea id="rmItens" rows="6">${esc(itensTxt)}</textarea></div>
        <div class="campo"><span class="rot">Motivo</span><div class="chips">${MOTIVOS_ROMANEIO.map((m) => `<label class="chip" style="cursor:pointer"><input type="checkbox" value="${esc(m)}" ${m === motivo ? 'checked' : ''}> ${esc(m)}</label>`).join('')}</div></div>`,
      aoSalvar: async (g) => {
        const v = (id) => g.querySelector(id).value;
        const endereco = v('#rmEnd').trim();
        if (endereco !== (c.endereco || '')) FL.api('PUT', `/api/v2/posvenda/${c.id}`, { endereco }, { silencioso: true }).then(() => carregar());
        const marcados = [...g.querySelectorAll('input[type=checkbox]')].map((x) => [x.value, x.checked]);
        const linhas = v('#rmItens').split('\n').map((x) => x.trim()).filter(Boolean);
        const w = window.open('', '_blank');
        if (!w) { g.erro('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.'); return false; }
        w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Romaneio ${esc(c.numero)}</title>
          <style>body{font-family:Arial,sans-serif;margin:32px;color:#000}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border:1px solid #000;padding:6px 8px;font-size:13px;text-align:left;vertical-align:top}.x{display:inline-block;width:14px;height:14px;border:1px solid #000;text-align:center;line-height:14px;font-size:12px;margin-right:6px}.mot span{display:inline-block;margin:4px 16px 4px 0;font-size:13px}.ass{margin-top:48px;border-top:1px solid #000;width:60%;padding-top:4px;font-size:12px}</style></head><body>
          <h1>Romaneio · MUBEC</h1><div style="font-size:12px">Caso ${esc(c.numero)} · emitido em ${FL.data(st.hoje)}</div>
          <table><tr><th style="width:24%">Data da retirada</th><td>${FL.data(v('#rmData')) || ''}</td></tr><tr><th>Cliente</th><td>${esc(v('#rmCliente'))}</td></tr>
          <tr><th>Contato</th><td>${esc(v('#rmContato'))}</td></tr><tr><th>Telefone</th><td>${esc(v('#rmTel'))}</td></tr><tr><th>Nota fiscal</th><td>${esc(v('#rmNf'))}</td></tr>
          <tr><th>Endereço</th><td>${esc(endereco).replace(/\n/g, '<br>')}</td></tr></table>
          <table><tr><th>Itens</th></tr>${(linhas.length ? linhas : ['']).map((l) => `<tr><td>${esc(l) || '&nbsp;'}</td></tr>`).join('')}</table>
          <div class="mot" style="margin-top:12px"><b style="font-size:13px">Motivo:</b><br>${marcados.map(([m, on]) => `<span><span class="x">${on ? 'X' : ''}</span>${esc(m)}</span>`).join('')}</div>
          <div class="ass">Quem retirou (nome e assinatura)</div><div class="ass">MUBEC</div>
          <script>window.onload=function(){window.print();}<\/script></body></html>`);
        w.document.close();
        return true;
      } });
  }

  // ------------------------------------------------------------------
  function ligarEventos() {
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; desenhar(); return; }
      if (t.dataset.cartao) {
        const c = t.dataset.cartao;
        if (c === 'abertos') st.aba = 'abertos';
        else if (c === 'vencidos') { st.aba = 'abertos'; st.filtros = Object.assign({}, st.filtros, { prazo: ['Vencido'] }); }
        else if (c === 'resolvidos') { st.aba = 'concluidos'; st.filtros = Object.assign({}, st.filtros, { status: ['Resolvido'] }); }
        else if (c === 'causa') { st.aba = 'todos'; }
        desenhar(); return;
      }
      if (t.dataset.abrir) { st.abertos[t.dataset.abrir] = !st.abertos[t.dataset.abrir]; desenhar(); return; }
      if ('novo' in t.dataset) { formNovo(); return; }
      if (t.dataset.atualizar) { const c = achar(t.dataset.atualizar); if (c) formAtualizar(c); return; }
      if (t.dataset.romaneio) { const c = achar(t.dataset.romaneio); if (c) romaneio(c); return; }
      if (t.dataset.contato) { const c = achar(t.dataset.contato); if (c) formContato(c); return; }
      if (t.dataset.apagar) { const c = achar(t.dataset.apagar); if (c) formApagar(c); return; }
      if (t.dataset.desfazerAt) {
        const c = achar(t.dataset.desfazerAt);
        if (c && await FL.api('DELETE', `/api/v2/posvenda/${c.id}/atualizacoes/${t.dataset.at}`)) { await recarregar(); FL.toast(`Última atualização do caso ${c.numero} desfeita.`); }
        return;
      }
      if ('abrirFiltros' in t.dataset) { FL.gavetaFiltros({ sobre: 'PÓS-VENDA', defs: DEFS, itens: daAba().filter(passaBusca), marcados: st.filtros, nomeItens: 'casos', aoMudar: (m) => { st.filtros = m; desenhar(); } }); return; }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); desenhar(); return; }
      if ('limparFiltros' in t.dataset) { st.filtros = {}; st.q = ''; const bq = document.getElementById('flBuscaTopo'); if (bq) bq.value = ''; desenhar(); }
    });
  }

  FL.telas.posvenda = {
    montar: function (alvo) { return FL.protegerTela(alvo, 'posvenda', 'Pós-venda', FL.telas.posvenda.montarAberta); },
    montarAberta: async function (alvo) {
      el = alvo;
      st = { aba: 'todos', filtros: {}, q: '', abertos: {}, dados: [], carregado: false, hoje: FL.hojeISO(), prazoDias: 30, listas: null };
      ligarEventos();
      desenhar();
      await carregar();
      desenhar();
      // Vindo do "+" de Pedidos: #posvenda?novo=PEDIDO
      const m = (location.hash.split('?')[1] || '').match(/novo=([^&]+)/);
      if (m) { history.replaceState(null, '', '#posvenda'); formNovo(decodeURIComponent(m[1])); }
    },
    buscar: function (q) { if (!st) return; st.q = q; desenhar(); }
  };
})();
