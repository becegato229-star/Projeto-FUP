/* FlowLog v2 — Cobrança: Todos · Em aberto · Pagos (boletos vencidos do relatório do banco) */
(function () {
  'use strict';
  const FL = window.FL;
  const esc = FL.esc;
  const POR_PAGINA = 150;
  const ICO_FONE = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"></path></svg>';
  const ICO_LAPIS = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="m13 7 4 4"></path></svg>';
  const ICO_LIXO = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg>';
  const SELO = { 'Pago': 'ok', 'Negociado': 'preto', 'Em aberto': '' };
  const DESFAZER_MS = 15 * 60 * 1000;

  let el, st;

  const devendo = (b) => b.status !== 'Pago';
  function faixa(b) {
    const d = b.dias || 0;
    return d <= 15 ? 'Até 15 dias' : d <= 30 ? '16 a 30 dias' : d <= 60 ? '31 a 60 dias' : 'Mais de 60 dias';
  }
  const DEFS = [
    { id: 'status', titulo: 'STATUS', ordem: ['Em aberto', 'Negociado', 'Pago'], valor: (b) => [b.status] },
    { id: 'hoje', titulo: 'COBRAR HOJE', ordem: ['Sim', 'Não'], valor: (b) => (devendo(b) ? [b.cobrar_hoje ? 'Sim' : 'Não'] : []) },
    { id: 'faixa', titulo: 'VENCIDO HÁ', ordem: ['Até 15 dias', '16 a 30 dias', '31 a 60 dias', 'Mais de 60 dias'], valor: (b) => (devendo(b) && b.dias != null ? [faixa(b)] : []) },
    { id: 'voltou', titulo: 'VOLTOU A APARECER', ordem: ['Sim'], valor: (b) => (b.voltou ? ['Sim'] : []) },
    { id: 'vendedor', titulo: 'VENDEDOR', valor: (b) => [b.vendedor || 'Sem vendedor'] },
    { id: 'cliente', titulo: 'CLIENTE', valor: (b) => [b.pagador || '—'] }
  ];

  const soma = (l) => l.reduce((s, b) => s + (b.valor || 0), 0);
  function brlCurto(v) {
    if (v >= 1e6) return 'R$ ' + FL.num(v / 1e6, 1) + ' mi';
    if (v >= 1e4) return 'R$ ' + FL.num(v / 1e3, 1) + ' mil';
    return FL.brl(v);
  }
  const doCliente = (k) => st.dados.filter((b) => b.cliente === k);
  const registrosDoCliente = (k) => {
    const nums = new Set(doCliente(k).map((b) => b.num));
    const grupos = {};
    st.registros.filter((r) => nums.has(r.boleto)).forEach((r) => {
      const g = grupos[r.grupo] || (grupos[r.grupo] = Object.assign({}, r, { boletos: [], ids: [] }));
      g.boletos.push(r.boleto); g.ids.push(r.id);
    });
    return Object.values(grupos).sort((a, b) => (a.data + String(a.ids[0]).padStart(9, '0') < b.data + String(b.ids[0]).padStart(9, '0') ? 1 : -1));
  };

  function passaBusca(b) {
    if (!st.q) return true;
    const alvo = [b.num, b.nosso, b.pagador, b.cnpj, b.nf, b.pedido, b.vendedor].map((c) => FL.semAcento(c).replace(/[.\s/-]/g, '')).join('|');
    return alvo.includes(st.q.replace(/[/-]/g, ''));
  }
  const daAba = () => st.dados.filter((b) => (st.aba === 'aberto' ? devendo(b) : st.aba === 'pago' ? !devendo(b) : true));
  function filtrados() {
    const lista = daAba().filter((b) => passaBusca(b) && FL.passaFiltros(b, DEFS, st.filtros));
    const o = st.ordem;
    const chave = {
      num: (b) => b.num, cliente: (b) => FL.semAcento(b.pagador), valor: (b) => String(Math.round((b.valor || 0) * 100)).padStart(14, '0'),
      vencimento: (b) => b.vencimento || '', status: (b) => (b.cobrar_hoje ? '0' : '1') + (devendo(b) ? '0' : '1') + (b.vencimento || '')
    }[o.campo] || ((b) => b.vencimento || '');
    lista.sort((a, b) => { const x = chave(a), y = chave(b); return (x < y ? -1 : x > y ? 1 : 0) * (o.desc ? -1 : 1); });
    return lista;
  }

  // ------------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------------
  function cabecalho() {
    const u = st.ultimaImp;
    return `<div class="fl-cabeca fl-entra"><div class="txt"><h1>Cobrança</h1></div>
      <div class="fl-acoes-topo" style="flex-direction:column;align-items:flex-end;gap:6px">
        <button type="button" class="btn sec" data-importar>${FL.icone.enviar} Importar relatório do banco</button>
        <span style="font-size:12px;color:var(--texto2)">Última importação: ${u ? FL.dataHora(u.quando) + (u.por ? ' · ' + esc(u.por) : '') : 'nunca'}</span>
        <input type="file" id="cobArq" accept=".xlsx,.xls" hidden></div></div>`;
  }
  function th(campo, titulo, sub, dir) {
    const on = st.ordem.campo === campo;
    return `<th${dir ? ' style="text-align:right"' : ''}><button type="button" data-ordenar="${campo}" style="padding:0;border:0;background:transparent;color:#fff;font-weight:700;cursor:pointer;text-align:${dir ? 'right' : 'left'}" aria-label="Ordenar por ${esc(titulo)}">${esc(titulo)}${on ? (st.ordem.desc ? ' ↓' : ' ↑') : ''}</button><small>${esc(sub)}</small></th>`;
  }

  function desenhar() {
    if (!st.carregado) {
      el.innerHTML = cabecalho() + '<div class="fl-tabela-caixa"><div class="carregando"><div class="esqueleto" style="margin:8px 0"></div><div class="esqueleto" style="margin:8px 0;width:80%"></div></div></div>';
      return;
    }
    const todos = st.dados;
    const abertos = todos.filter(devendo), pagos = todos.filter((b) => !devendo(b));
    const negociados = abertos.filter((b) => b.status === 'Negociado');
    const hoje = st.hoje;
    const pagos30 = pagos.filter((b) => b.pago_em && b.pago_em >= FL.somarDias(hoje, -30));
    const lista = filtrados();
    const visiveis = lista.slice(0, st.limite);
    const abas = [{ id: 'todos', rotulo: 'Todos', qtd: todos.length }, { id: 'aberto', rotulo: 'Em aberto', qtd: abertos.length }, { id: 'pago', rotulo: 'Pagos', qtd: pagos.length }];
    el.innerHTML = cabecalho() + `
      <div class="fl-cartoes fl-entra d1">
        <button type="button" class="fl-cartao" data-cartao="aberto"><span class="v">${brlCurto(soma(abertos))}</span><span class="r">${FL.plural(abertos.length, 'boleto em aberto', 'boletos em aberto')}${negociados.length ? ' (' + FL.plural(negociados.length, 'negociado', 'negociados') + ')' : ''}</span><span class="s">valor dos títulos</span></button>
        <button type="button" class="fl-cartao" data-cartao="hoje"><span class="v" style="color:${st.clientesHoje ? 'var(--alerta)' : '#000'}">${FL.num(st.clientesHoje)}</span><span class="r">Clientes para cobrar hoje</span><span class="s">sem cobrança ou data vencida</span></button>
        <button type="button" class="fl-cartao" data-cartao="30"><span class="v">${brlCurto(soma(abertos.filter((b) => (b.dias || 0) > 30)))}</span><span class="r">Vencido há mais de 30 dias</span><span class="s">em aberto</span></button>
        <button type="button" class="fl-cartao" data-cartao="pago"><span class="v" style="color:var(--verde-escuro, #1E7A52)">${brlCurto(soma(pagos30))}</span><span class="r">Pagos nos últimos 30 dias</span><span class="s"></span></button>
      </div>
      <div class="fl-entra d1" style="display:flex;flex-direction:column;gap:12px">
        <div class="fl-barra-abas">${FL.htmlAbas(abas, st.aba, 'Abas da cobrança')}${FL.botaoFiltros(st.filtros)}</div>
        ${FL.htmlChipsAtivos(DEFS, st.filtros)}
      </div>
      <div class="fl-tabela-caixa fl-entra d2"><table class="fl-tabela"><thead><tr>
        ${th('num', 'Seu número', 'nosso número')}${th('cliente', 'Pagador', 'CNPJ/CPF')}${th('valor', 'Valor título', '', true)}
        ${th('vencimento', 'Vencimento', 'dias em atraso')}${th('status', 'Status', 'próxima cobrança')}<th>Última cobrança<small>quando · quem</small></th><th class="dir">Ações</th>
      </tr></thead><tbody>
        ${visiveis.length ? visiveis.map(linha).join('') : `<tr><td colspan="7" class="vazio">${st.q || FL.qtdFiltros(st.filtros) ? 'Nenhum boleto com essa busca ou filtros. <button type="button" class="link" data-limpar-filtros>Limpar</button>' : (st.aba === 'pago' ? 'Nenhum boleto pago ainda.' : (todos.length ? 'Nenhum boleto em aberto. Tudo pago.' : 'Nenhum boleto ainda. Importe o relatório do banco.'))}</td></tr>`}
      </tbody></table></div>
      ${lista.length > st.limite ? `<button type="button" class="btn sec" style="align-self:center" data-mais>Mostrar mais ${Math.min(POR_PAGINA, lista.length - st.limite)} (de ${FL.num(lista.length - st.limite)} restantes)</button>` : ''}`;
  }

  function linha(b) {
    const aberto = !!st.abertos[b.num];
    const dev = devendo(b);
    let venc = '—', cor = 'var(--texto2)', peso = '400';
    if (dev && b.dias != null) { venc = b.dias > 0 ? FL.plural(b.dias, 'dia', 'dias') + ' em atraso' : (b.dias === 0 ? 'vence hoje' : 'a vencer'); if (b.dias > 0) { cor = 'var(--alerta)'; peso = '700'; } }
    else if (!dev) venc = b.pago_dias_atraso != null ? (b.pago_dias_atraso > 0 ? `Pago c/ ${b.pago_dias_atraso}d atraso` : 'Pago em dia') : 'Pago';
    let prox = '—', corP = 'var(--texto2)', pesoP = '400';
    if (dev) {
      if (b.cobrar_hoje) { prox = b.ultima && b.ultima.proxima ? 'Cobrar hoje (era ' + FL.dataCurta(b.ultima.proxima) + ')' : (b.ultima ? 'Cobrar hoje' : 'Cobrar hoje (nunca cobrado)'); corP = 'var(--alerta)'; pesoP = '700'; }
      else if (b.ultima && b.ultima.proxima) prox = 'Cobrar em ' + FL.dataCurta(b.ultima.proxima);
    } else if (b.pago_em) prox = 'Pago em ' + FL.dataCurta(b.pago_em);
    const u = b.ultima;
    return `<tr class="${aberto ? 'aberta' : ''}">
      <td class="nw"><button type="button" class="fl-link-linha" data-abrir="${esc(b.num)}" aria-expanded="${aberto}" aria-label="Mostrar as cobranças do cliente do boleto ${esc(b.num)}">${FL.icone.seta}${esc(b.num)}</button><span class="sub" style="padding-left:18px">${esc(b.nosso || '—')}</span></td>
      <td style="max-width:280px"><b>${esc(b.pagador || '—')}</b><span class="sub">${esc(b.cnpj || '')}${b.vendedor ? ' · ' + esc(b.vendedor) : ''}</span></td>
      <td class="nw" style="text-align:right"><b>${FL.brl(b.valor)}</b></td>
      <td class="nw">${FL.data(b.vencimento)}<span class="sub" style="color:${cor};font-weight:${peso}">${esc(venc)}</span></td>
      <td><span class="selo ${SELO[b.status] || ''}">${esc(b.status)}</span>${b.voltou ? ' <span class="selo contorno-alerta">Voltou a aparecer</span>' : ''}<span class="sub" style="color:${corP};font-weight:${pesoP};margin-top:4px">${esc(prox)}</span></td>
      <td style="max-width:260px">${u ? esc(u.texto) : '<span style="color:var(--texto2)">—</span>'}<span class="sub">${u ? FL.dataCurta(u.data) + (u.por ? ' · ' + esc(u.por) : '') : ''}</span></td>
      <td class="dir nw"><span style="display:inline-flex;gap:6px">
        ${dev ? `<button type="button" class="btn-icone" data-acao="cobrar" data-b="${esc(b.num)}" title="Registrar cobrança" aria-label="Registrar cobrança do boleto ${esc(b.num)}">${ICO_FONE}</button>` : ''}
        <button type="button" class="btn-icone" data-acao="status" data-b="${esc(b.num)}" title="Mudar status" aria-label="Mudar status do boleto ${esc(b.num)}">${ICO_LAPIS}</button>
        <button type="button" class="btn-icone" data-acao="apagar" data-b="${esc(b.num)}" title="Apagar boleto" aria-label="Apagar o boleto ${esc(b.num)}">${ICO_LIXO}</button>
      </span></td></tr>
      ${aberto ? `<tr class="detalhe"><td colspan="7">${detalheHtml(b)}</td></tr>` : ''}`;
  }

  function detalheHtml(b) {
    const dev = devendo(b);
    const doCli = doCliente(b.cliente).sort((x, y) => (x.vencimento || '') < (y.vencimento || '') ? -1 : 1);
    const abertosCli = doCli.filter(devendo);
    const regs = registrosDoCliente(b.cliente);
    const agora = Date.now();
    const avisos = [];
    if (b.voltou) avisos.push(['aviso', 'Estava Pago e voltou ao relatório do banco.']);
    if (dev && b.cobrar_hoje) avisos.push(['aviso', b.ultima && b.ultima.proxima ? `Cobrança prevista para ${FL.data(b.ultima.proxima)}.` : (b.ultima ? 'Última cobrança sem próxima data.' : 'Cliente ainda não cobrado.')]);
    if (b.status_motivo) avisos.push(['aviso info', `Status mudado à mão para ${b.status}${b.status_por ? ' por ' + b.status_por : ''}${b.status_em ? ' em ' + FL.dataHora(b.status_em) : ''}: ${b.status_motivo}`]);
    const dados = [['Emissão', FL.data(b.emissao)], ['Valor pago', b.valor_pago != null ? FL.brl(b.valor_pago) : '—'],
      ['Pagamento', b.pagamento_banco ? FL.data(b.pagamento_banco) + ' (banco)' : (b.pago_em ? FL.data(b.pago_em) + ' (saiu do relatório)' : '—')],
      ['Vendedor', b.vendedor || 'não encontrado'], ['NF', b.nf ? b.nf + (b.pedido ? ' · pedido ' + b.pedido : '') : '—']];
    return `<div style="display:flex;flex-direction:column;gap:14px">
      ${avisos.map((a) => `<p class="${a[0]}">${esc(a[1])}</p>`).join('')}
      <div style="display:flex;flex-wrap:wrap;gap:6px 24px;font-size:13px;color:var(--texto2)">${dados.map((x) => `<span>${esc(x[0])}: <b style="color:#000">${esc(x[1])}</b></span>`).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start">
        <div style="flex:1 1 380px;min-width:0;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="rotulo-secao">BOLETOS DE ${esc((b.pagador || '').toUpperCase())}</span><b style="font-size:13px">Em aberto: ${FL.brl(soma(abertosCli))}</b></div>
          ${doCli.map((x) => `<div class="cartao-mini" style="flex-direction:row;align-items:center;justify-content:space-between;gap:10px;${x.num === b.num ? 'border-color:#000' : ''}">
            <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><b style="font-size:14px">${esc(x.num)} · ${FL.brl(x.valor)} · ${esc(x.status)}</b>
            <span style="font-size:12px;color:var(--texto2)">Vence ${FL.data(x.vencimento)}${devendo(x) && x.dias > 0 ? ' · ' + FL.plural(x.dias, 'dia', 'dias') + ' em atraso' : ''}${!devendo(x) && x.pago_em ? ' · pago em ' + FL.dataCurta(x.pago_em) : ''}</span></span>
            <button type="button" class="btn sec" style="min-height:32px;padding:0 10px;font-size:12px;flex:0 0 auto" data-acao="status" data-b="${esc(x.num)}">Mudar status</button></div>`).join('')}
        </div>
        <div style="flex:1 1 380px;min-width:0;display:flex;flex-direction:column;gap:8px">
          <span class="rotulo-secao">COBRANÇAS FEITAS</span>
          ${regs.length ? `<ol class="linha-tempo">${regs.slice(0, 12).map((g, i) => {
            const pode = i === 0 && g.criado && agora - new Date(g.criado + 'Z').getTime() < DESFAZER_MS;
            return `<li><b style="font-size:13px">${FL.dataCurta(g.data)}${g.por ? ' · ' + esc(g.por) : ''} · ${g.boletos.length > 1 ? FL.plural(g.boletos.length, 'boleto', 'boletos') : esc(g.boletos[0])}</b>
              <span style="font-size:14px">${esc(g.texto)}</span>
              ${g.proxima ? `<span style="font-size:12px;color:var(--texto2)">Cobrar de novo em ${FL.data(g.proxima)}</span>` : ''}
              ${pode ? `<button type="button" class="link" style="font-size:12px;align-self:flex-start" data-desfazer-cob="${esc(g.grupo)}" data-b="${esc(b.num)}">Desfazer</button>` : ''}</li>`;
          }).join('')}</ol>` : '<p style="margin:0;font-size:14px;color:var(--texto2)">Sem cobranças registradas.</p>'}
          ${abertosCli.length ? `<button type="button" class="btn" style="align-self:flex-start" data-acao="cobrar" data-b="${esc(b.num)}">${ICO_FONE} Registrar cobrança</button>`
            : '<p class="aviso info">Nenhum boleto em aberto.</p>'}
        </div>
      </div></div>`;
  }

  // ------------------------------------------------------------------
  async function carregar() {
    const r = await FL.api('GET', '/api/v2/cobranca');
    st.carregado = true;
    if (!r) { st.dados = st.dados || []; return; }
    st.dados = r.boletos; st.registros = r.registros; st.hoje = r.hoje;
    st.clientesHoje = r.clientes_cobrar_hoje; st.ultimaImp = r.ultima_importacao;
  }
  async function recarregar() { await carregar(); desenhar(); FL.atualizarContagens(); }
  const achar = (n) => st.dados.find((b) => b.num === n);

  // ------------------------------------------------------------------
  // Formulários
  // ------------------------------------------------------------------
  function formCobrar(b) {
    const abertos = doCliente(b.cliente).filter(devendo);
    let marcados = abertos.map((x) => x.num);
    let prox = '';
    const atalhos = FL.atalhosVerificar(st.hoje);
    FL.gaveta({ sobre: 'COBRANÇA · ' + (b.pagador || ''), titulo: 'Registrar cobrança', sub: `${FL.plural(abertos.length, 'boleto em aberto', 'boletos em aberto')} · ${FL.brl(soma(abertos))}`, botao: 'Registrar cobrança',
      html: `<div class="campo"><span class="rot" id="cobBolRot">Boletos cobrados nesta conversa</span>
          <div class="chips" role="group" aria-labelledby="cobBolRot">${abertos.map((x) => `<button type="button" class="chip" data-bol="${esc(x.num)}" aria-pressed="true">${esc(x.num)} · ${FL.brl(x.valor)}</button>`).join('')}</div></div>
        <div class="campo"><label for="cobTexto">O que o cliente disse <span style="font-weight:400">(obrigatório)</span></label><textarea id="cobTexto" rows="4" maxlength="1000" placeholder="Ex.: falei com o financeiro, paga na sexta junto com a outra parcela"></textarea></div>
        <div class="campo"><span class="rot" id="cobProxRot">Cobrar de novo em <span style="font-weight:400">(obrigatório)</span></span>
          <div class="chips" role="group" aria-labelledby="cobProxRot">${atalhos.map((x) => `<button type="button" class="chip" data-prox="${x[1]}" aria-pressed="false">${esc(x[0])}</button>`).join('')}</div>
          <label for="cobOutra" style="font-size:13px;padding-top:4px">Ou escolha outra data</label><input id="cobOutra" type="date" min="${FL.somarDias(st.hoje, 1)}">
          </div>`,
      aoAbrir: (g) => {
        g.addEventListener('click', (e) => {
          const bb = e.target.closest('[data-bol]');
          if (bb) { const n = bb.dataset.bol; const on = marcados.includes(n); marcados = on ? marcados.filter((x) => x !== n) : marcados.concat([n]); bb.setAttribute('aria-pressed', String(!on)); g.erro(''); return; }
          const p = e.target.closest('[data-prox]');
          if (p) { prox = p.dataset.prox; g.querySelector('#cobOutra').value = ''; g.querySelectorAll('[data-prox]').forEach((x) => x.setAttribute('aria-pressed', String(x === p))); g.erro(''); }
        });
        g.querySelector('#cobOutra').addEventListener('change', (e) => { prox = e.target.value; g.querySelectorAll('[data-prox]').forEach((x) => x.setAttribute('aria-pressed', 'false')); });
      },
      aoSalvar: async (g) => {
        const texto = g.querySelector('#cobTexto').value.trim();
        if (!marcados.length) { g.erro('Marque pelo menos um boleto.'); return false; }
        if (!texto) { g.erro('Escreva o que o cliente disse.'); return false; }
        if (!prox || prox <= st.hoje) { g.erro('Escolha quando cobrar de novo (a partir de amanhã).'); return false; }
        const r = await FL.api('POST', '/api/v2/cobranca/registros', { boletos: marcados, texto, proxima: prox });
        if (!r) return false;
        st.abertos[b.num] = true;
        await recarregar();
        FL.toast(`Cobrança registrada (${FL.plural(marcados.length, 'boleto', 'boletos')}).`, { desfazer: async () => {
          if (await FL.api('DELETE', '/api/v2/cobranca/registros/grupo/' + encodeURIComponent(r.grupo))) recarregar();
        } });
        return true;
      } });
  }

  function formStatus(b) {
    let novo = b.status;
    FL.gaveta({ sobre: 'BOLETO ' + b.num + ' · ' + (b.pagador || ''), titulo: 'Mudar status', sub: `${FL.brl(b.valor)} · vence ${FL.data(b.vencimento)} · hoje: ${b.status}`, botao: 'Salvar status',
      html: `
        <div class="campo"><span class="rot" id="stRot">Status correto</span>
          <div class="seg" style="grid-template-columns:repeat(3,1fr)" role="group" aria-labelledby="stRot">${['Em aberto', 'Negociado', 'Pago'].map((s) => `<button type="button" data-st="${s}" aria-pressed="${s === novo}">${s}</button>`).join('')}</div></div>
        <div class="campo"><label for="stMotivo">O que foi combinado / por que está mudando <span style="font-weight:400">(obrigatório)</span></label><textarea id="stMotivo" rows="3" maxlength="500"></textarea></div>`,
      aoAbrir: (g) => {
        g.addEventListener('click', (e) => { const s = e.target.closest('[data-st]'); if (!s) return; novo = s.dataset.st; g.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-pressed', String(x === s))); g.erro(''); });
      },
      aoSalvar: async (g) => {
        const motivo = g.querySelector('#stMotivo').value.trim();
        if (!motivo) { g.erro('Escreva o que foi combinado ou por que está mudando.'); return false; }
        const r = await FL.api('PUT', `/api/v2/cobranca/${encodeURIComponent(b.num)}/status`, { status: novo, motivo });
        if (!r) return false;
        await recarregar();
        FL.toast(`Boleto ${b.num}: ${novo}.`, { desfazer: async () => {
          if (await FL.api('POST', `/api/v2/cobranca/${encodeURIComponent(b.num)}/status/desfazer`, r.antes)) recarregar();
        } });
        return true;
      } });
  }

  function formApagar(b) {
    FL.modal({ titulo: `Apagar o boleto ${b.num}?`, perigo: true, botao: 'Apagar boleto',
      html: `<p>${esc(b.pagador || '')} · ${FL.brl(b.valor)} · vence ${FL.data(b.vencimento)}. Ele sai da lista; as cobranças do cliente continuam. Se ele ainda estiver no relatório do banco, <b>volta na próxima importação</b>. Logo depois aparece um botão <b>Desfazer</b>.</p>`,
      aoConfirmar: async () => {
        if (!(await FL.api('DELETE', '/api/v2/cobranca/' + encodeURIComponent(b.num)))) return false;
        delete st.abertos[b.num];
        await recarregar();
        FL.toast(`Boleto ${b.num} apagado.`, { desfazer: async () => {
          if (await FL.api('POST', `/api/v2/cobranca/${encodeURIComponent(b.num)}/restaurar`)) recarregar();
        } });
        return true;
      } });
  }

  async function importar(arquivo) {
    if (!arquivo) return;
    const fd = new FormData();
    fd.append('file', arquivo);
    FL.toast('Importando o relatório do banco…');
    const r = await FL.api('POST', '/api/cobranca/importar', null, { form: fd });
    if (!r) return;
    await recarregar();
    const partes = [`${FL.num(r.registros_processados)} boletos no relatório`, `${r.novos} novos`, `${r.marcados_pagos} viraram Pago`];
    if (r.reapareceram) partes.push(`${r.reapareceram} voltaram a aparecer`);
    FL.toast('Importado: ' + partes.join(' · ') + '.');
  }

  // ------------------------------------------------------------------
  function ligarEventos() {
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.aba) { st.aba = t.dataset.aba; st.limite = POR_PAGINA; desenhar(); return; }
      if (t.dataset.cartao) {
        const c = t.dataset.cartao;
        if (c === 'aberto') { st.aba = 'aberto'; }
        else if (c === 'hoje') { st.aba = 'aberto'; st.filtros = Object.assign({}, st.filtros, { hoje: ['Sim'] }); }
        else if (c === '30') { st.aba = 'aberto'; st.filtros = Object.assign({}, st.filtros, { faixa: ['31 a 60 dias', 'Mais de 60 dias'] }); }
        else if (c === 'pago') { st.aba = 'pago'; }
        st.limite = POR_PAGINA; desenhar(); return;
      }
      if (t.dataset.abrir) { const n = t.dataset.abrir; st.abertos[n] = !st.abertos[n]; desenhar(); return; }
      if (t.dataset.ordenar) {
        const c = t.dataset.ordenar;
        st.ordem = st.ordem.campo === c ? { campo: c, desc: !st.ordem.desc } : { campo: c, desc: c === 'valor' };
        desenhar(); return;
      }
      if (t.dataset.acao) {
        const b = achar(t.dataset.b);
        if (!b) return;
        if (t.dataset.acao === 'cobrar') formCobrar(b);
        if (t.dataset.acao === 'status') formStatus(b);
        if (t.dataset.acao === 'apagar') formApagar(b);
        return;
      }
      if (t.dataset.desfazerCob) {
        if (await FL.api('DELETE', '/api/v2/cobranca/registros/grupo/' + encodeURIComponent(t.dataset.desfazerCob))) { await recarregar(); FL.toast('Cobrança desfeita.'); }
        return;
      }
      if ('importar' in t.dataset) { el.querySelector('#cobArq').click(); return; }
      if ('mais' in t.dataset) { st.limite += POR_PAGINA; desenhar(); return; }
      if ('abrirFiltros' in t.dataset) {
        FL.gavetaFiltros({ sobre: 'COBRANÇA', defs: DEFS, itens: daAba().filter(passaBusca), marcados: st.filtros, nomeItens: 'boletos',
          aoMudar: (m) => { st.filtros = m; st.limite = POR_PAGINA; desenhar(); } });
        return;
      }
      if (t.dataset.tirarFiltro) { st.filtros[t.dataset.tirarFiltro] = (st.filtros[t.dataset.tirarFiltro] || []).filter((v) => v !== t.dataset.valor); desenhar(); return; }
      if ('limparFiltros' in t.dataset) { st.filtros = {}; st.q = ''; const bq = document.getElementById('flBuscaTopo'); if (bq) bq.value = ''; desenhar(); }
    });
    el.addEventListener('change', (e) => { if (e.target.id === 'cobArq') { importar(e.target.files[0]); e.target.value = ''; } });
  }

  FL.telas.cobranca = {
    montar: async function (alvo) {
      el = alvo;
      st = { aba: 'aberto', filtros: {}, q: '', abertos: {}, ordem: { campo: 'status', desc: false }, limite: POR_PAGINA,
        dados: [], registros: [], carregado: false, clientesHoje: 0, ultimaImp: null, hoje: FL.hojeISO() };
      ligarEventos();
      desenhar();
      await carregar();
      desenhar();
    },
    buscar: function (q) { if (!st) return; st.q = q; st.limite = POR_PAGINA; desenhar(); }
  };
})();
