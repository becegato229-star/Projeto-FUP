"""v2 — Dashboard (Rian e Guilherme; pede a senha de administrador). Só lê dados.

Decisões de 19/11:
- Pontualidade: Retira = faturado até o dia prometido; Entrega e Transportadora = até 1 dia útil antes.
- FUP só conta a partir de 19/11/2026 (antes não era preenchido direito). Sem avisos e transportadora.
- Filtros: vendedor, tipo de entrega, Estado, cliente (valem para pedidos, vendas, cobrança, pós-venda,
  FUP) e fornecedor da zincagem (vale só para a zincagem).
"""
import re
import statistics
from collections import defaultdict
from datetime import date, timedelta
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from .configuracoes import datas_feriados
from .database import get_session
from .fuso import hoje_brasil
from .models import (
    AtualizacaoPosVenda, Boleto, CasoPosVenda, FupRegistro, ItemFaturado, NotaFiscalPedido, NotaItem,
    NotaRetorno, NotaSaida, Pedido,
)
from .rotas_novo import exigir_senha

router = APIRouter(prefix="/api/v2")

FUP_DESDE = date(2026, 11, 19)
TIPOS = ("Entrega", "Transportadora", "Retira")


def _mediana(v):
    v = [x for x in v if x is not None]
    return round(statistics.median(v), 1) if v else None


def _media(v):
    v = [x for x in v if x is not None]
    return round(sum(v) / len(v), 1) if v else None


def _pct(sim, total):
    return round(100 * sim / total, 1) if total else None


def _inicio_periodo(periodo: str, hoje: date) -> date:
    def meses_atras(n):
        y, m = hoje.year, hoje.month - n
        while m <= 0:
            m += 12
            y -= 1
        return date(y, m, 1)
    return {"mes": meses_atras(0), "3m": meses_atras(2), "6m": meses_atras(5), "ano": date(hoje.year, 1, 1)}.get(periodo, meses_atras(5))


def _meses(de: date, ate: date) -> list:
    out, y, m = [], de.year, de.month
    while (y, m) <= (ate.year, ate.month):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


@router.get("/dashboard")
def dashboard(
    periodo: str = "6m",
    vendedor: List[str] = Query(default=[]),
    tipo: List[str] = Query(default=[]),
    estado: List[str] = Query(default=[]),
    cliente: List[str] = Query(default=[]),
    fornecedor: List[str] = Query(default=[]),
    session: Session = Depends(get_session),
    _ok: None = Depends(exigir_senha),
):
    hoje = hoje_brasil()
    de = _inicio_periodo(periodo, hoje)
    meses = _meses(de, hoje)
    feriados = np.array(datas_feriados(session), dtype="datetime64[D]")

    def uteis(d1, d2):
        """Dias úteis de d1 até d2 (negativo se d2 vier antes)."""
        if d1 is None or d2 is None:
            return None
        return int(np.busday_count(d1, d2, holidays=feriados)) if d2 >= d1 else -int(np.busday_count(d2, d1, holidays=feriados))

    def dia_util_antes(d):
        return np.busday_offset(np.datetime64(d, "D"), -1, roll="backward", holidays=feriados).astype(date)

    # ---------------- Pedidos (base) ----------------
    pedidos = session.exec(select(Pedido)).all()
    nfs_por_pedido = defaultdict(list)
    for n in session.exec(select(NotaFiscalPedido)).all():
        nfs_por_pedido[n.numero_pedido].append(n)

    # opções dos filtros
    cli_nome_cod = defaultdict(set)
    for p in pedidos:
        if p.nome_cliente and p.cod_cliente:
            cli_nome_cod[p.nome_cliente.strip()].add(p.cod_cliente)
    vendas_itens = session.exec(select(ItemFaturado)).all()
    for i in vendas_itens:
        if i.nome_cliente and i.cod_cliente:
            cli_nome_cod[i.nome_cliente.strip()].add(i.cod_cliente)
    cods_cliente = set().union(*[cli_nome_cod.get(c, set()) for c in cliente]) if cliente else set()

    def passa_pedido(p) -> bool:
        if vendedor and (p.vendedor or "") not in vendedor:
            return False
        if tipo and (p.tipo_entrega or "") not in tipo:
            return False
        if estado and (p.uf or "") not in estado:
            return False
        if cliente and (p.cod_cliente not in cods_cliente and (p.nome_cliente or "").strip() not in cliente):
            return False
        return True

    ped_f = [p for p in pedidos if passa_pedido(p)]
    ped_por_num = {p.numero_pedido: p for p in pedidos}

    def faturamento(p):
        datas = [n.data_faturamento for n in nfs_por_pedido.get(p.numero_pedido, []) if n.data_faturamento and not n.cancelada and not n.fora_da_planilha]
        return min(datas) if datas else p.data_faturamento

    # ---------------- Agora ----------------
    abertos = [p for p in ped_f if p.status in ("Bloqueado", "Aprovado") and not p.cancelado]
    atrasados = [p for p in abertos if p.atraso_producao]
    vencem = [p for p in abertos if not p.atraso_producao and not p.aguardando_cliente_desde and p.data_entrega_prevista and 0 <= (uteis(hoje, p.data_entrega_prevista) or 0) <= 2]
    fat_hoje = {p.numero_pedido for p in ped_f for n in nfs_por_pedido.get(p.numero_pedido, []) if n.data_faturamento == hoje and not n.cancelada}
    por_vend = defaultdict(int)
    por_tipo = defaultdict(int)
    for p in atrasados:
        por_vend[p.vendedor or "Sem vendedor"] += 1
        por_tipo[p.tipo_entrega or "Desconhecido"] += 1

    # ---------------- Pontualidade ----------------
    linhas_pont = []  # (mes, tipo, vendedor, pontual, atraso, prazo_dado)
    etapa_ef = defaultdict(list)
    for p in ped_f:
        if p.cancelado or p.status == "Cancelado" or not p.data_entrega_prevista:
            continue
        fat = faturamento(p)
        if not fat or fat < de or fat > hoje:
            continue
        t = p.tipo_entrega if p.tipo_entrega in TIPOS else "Entrega"
        limite = p.data_entrega_prevista if t == "Retira" else dia_util_antes(p.data_entrega_prevista)
        # pronto e esperando o cliente antes do limite: o atraso não é da MUBEC
        pontual = fat <= limite or bool(p.aguardando_cliente_desde and p.aguardando_cliente_desde <= limite)
        atraso = None if pontual else uteis(limite, fat)
        prazo = uteis(p.data_emissao, p.data_entrega_prevista) if p.data_emissao else None
        linhas_pont.append((fat.strftime("%Y-%m"), p.tipo_entrega if p.tipo_entrega in TIPOS else None, p.vendedor or "Sem vendedor", pontual, atraso, prazo,
                            fat <= p.data_entrega_prevista))
        if p.data_emissao and p.tipo_entrega in TIPOS:
            etapa_ef[p.tipo_entrega].append(uteis(p.data_emissao, fat))

    def pct_de(ls):
        return _pct(sum(1 for x in ls if x[3]), len(ls))
    por_mes = []
    for m in meses:
        ls = [x for x in linhas_pont if x[0] == m]
        por_mes.append({"mes": m, "pct": pct_de(ls), "pedidos": len(ls),
                        "tipos": {t: pct_de([x for x in ls if x[1] == t]) for t in TIPOS}})
    vend_g = defaultdict(list)
    for x in linhas_pont:
        vend_g[x[2]].append(x)
    por_vendedor = sorted(({"nome": k, "pedidos": len(v), "pct": pct_de(v), "prazo_medio": _media([x[5] for x in v]),
                            "atraso_medio": _media([x[4] for x in v if not x[3]])} for k, v in vend_g.items() if len(v) >= 3),
                          key=lambda x: (x["pct"] if x["pct"] is not None else 101))

    # ---------------- Etapas ----------------
    etapa_fe = defaultdict(list)
    canhoto = defaultdict(lambda: [0, 0])
    for p in ped_f:
        if p.tipo_entrega not in TIPOS:
            continue
        for n in nfs_por_pedido.get(p.numero_pedido, []):
            if n.cancelada or not n.data_faturamento or n.data_faturamento < de:
                continue
            if n.data_entrega:
                etapa_fe[p.tipo_entrega].append(uteis(n.data_faturamento, n.data_entrega))
            canhoto[p.tipo_entrega][1] += 1
            if n.canhoto and str(n.canhoto).strip():
                canhoto[p.tipo_entrega][0] += 1
    etapas = [{"tipo": t, "emissao_faturamento": _mediana(etapa_ef[t]), "faturamento_entrega": _mediana(etapa_fe[t]),
               "com_canhoto": _pct(*canhoto[t])} for t in TIPOS if not tipo or t in tipo]

    # ---------------- Vendas ----------------
    def passa_item(i) -> bool:
        if vendedor and (i.nome_representante or "") not in vendedor:
            return False
        if estado and (i.uf or "") not in estado:
            return False
        if cliente and (i.cod_cliente not in cods_cliente and (i.nome_cliente or "").strip() not in cliente):
            return False
        return bool(i.data_emissao and de <= i.data_emissao <= hoje)
    its = [i for i in vendas_itens if passa_item(i)]
    total = sum(i.valor_total or 0 for i in its)

    def soma_por(chave):
        d = defaultdict(float)
        for i in its:
            d[chave(i) or "—"] += i.valor_total or 0
        return sorted(d.items(), key=lambda x: -x[1])
    v_mes = defaultdict(float)
    for i in its:
        v_mes[i.data_emissao.strftime("%Y-%m")] += i.valor_total or 0
    top = soma_por(lambda i: (i.nome_cliente or "").strip())[:10]
    estados = soma_por(lambda i: i.uf)
    if len(estados) > 9:
        estados = estados[:8] + [("Outros", sum(v for _, v in estados[8:]))]
    vendas = {
        "total": round(total, 2), "nfs": len({i.nf for i in its}),
        "por_mes": [{"mes": m, "valor": round(v_mes.get(m, 0), 2)} for m in meses],
        "por_vendedor": [{"nome": k, "valor": round(v, 2)} for k, v in soma_por(lambda i: i.nome_representante)[:12]],
        "top_clientes": [{"nome": k, "valor": round(v, 2), "pct": _pct(v, total)} for k, v in top],
        "por_estado": [{"uf": k, "valor": round(v, 2)} for k, v in estados],
        "por_grupo": [{"nome": k, "valor": round(v, 2)} for k, v in soma_por(lambda i: i.grupo_estoque)[:10]],
    }

    # ---------------- Zincagem ----------------
    saidas = {s.numero_nota: s for s in session.exec(select(NotaSaida).where(NotaSaida.apagada_em == None)).all()  # noqa: E711
              if not fornecedor or s.fornecedor in fornecedor}
    retornos = [r for r in session.exec(select(NotaRetorno).where(NotaRetorno.apagada_em == None)).all()  # noqa: E711
                if not fornecedor or r.fornecedor in fornecedor]
    itens_nota = defaultdict(list)
    for it in session.exec(select(NotaItem)).all():
        itens_nota[(it.tipo_nota, it.numero_nota)].append(it)

    def peso_nota(tipo_n, n):
        if n.peso_bruto is not None:
            return n.peso_bruto
        ps = [i.peso_total for i in itens_nota[(tipo_n, n.numero_nota)] if i.peso_total is not None]
        return sum(ps) if ps else None
    pares = [(saidas[r.numero_nota_saida], r) for r in retornos if r.numero_nota_saida in saidas]
    pares_p = [(s, r) for s, r in pares if de <= r.data_nota <= hoje]
    z_mes = []
    for m in meses:
        z_mes.append({"mes": m,
                      "peso": round(sum(peso_nota("saida", s) or 0 for s in saidas.values() if s.data_nota.strftime("%Y-%m") == m), 1),
                      "lead": _mediana([(r.data_nota - s.data_nota).days for s, r in pares_p if r.data_nota.strftime("%Y-%m") == m])})
    forn = defaultdict(lambda: {"pares": 0, "leads": [], "peso": 0.0, "valor": 0.0, "kg": 0.0})
    for s, r in pares_p:
        f = forn[r.fornecedor]
        f["pares"] += 1
        f["leads"].append((r.data_nota - s.data_nota).days)
        for i in itens_nota[("retorno", r.numero_nota)]:
            if i.valor_total and i.peso_total:
                f["valor"] += i.valor_total
                f["kg"] += i.peso_total
    for s in saidas.values():
        if de <= s.data_nota <= hoje:
            forn[s.fornecedor]["peso"] += peso_nota("saida", s) or 0
    retornados = {r.numero_nota_saida for r in retornos if r.numero_nota_saida}
    aguardando = [s for s in saidas.values() if s.numero_nota not in retornados]
    zincagem = {
        "lead_mediana": _mediana([(r.data_nota - s.data_nota).days for s, r in pares_p]), "pares": len(pares_p),
        "por_mes": z_mes,
        "por_fornecedor": sorted(({"nome": k, "pares": v["pares"], "lead": _mediana(v["leads"]), "peso": round(v["peso"], 1),
                                   "preco_kg": round(v["valor"] / v["kg"], 2) if v["kg"] else None} for k, v in forn.items()),
                                 key=lambda x: -x["pares"]),
    }

    # ---------------- Cobrança ----------------
    def nf_do_boleto(num):
        m = re.match(r"^\s*0*(\d{4,})", num or "")
        return m.group(1) if m else None
    ped_por_nf = {}
    for num, ls in nfs_por_pedido.items():
        for n in ls:
            ped_por_nf.setdefault(n.nf, num)
    item_por_nf = {}
    for i in vendas_itens:
        item_por_nf.setdefault(i.nf, i)

    def passa_boleto(b) -> bool:
        if not (vendedor or estado or cliente):
            return True
        nf = nf_do_boleto(b.seu_numero)
        p = ped_por_nf.get(nf) and ped_por_num.get(ped_por_nf.get(nf))
        i = item_por_nf.get(nf)
        vend = (p.vendedor if p else None) or (i.nome_representante if i else None)
        uf = (p.uf if p else None) or (i.uf if i else None)
        cod = (p.cod_cliente if p else None) or (i.cod_cliente if i else None)
        if vendedor and vend not in vendedor:
            return False
        if estado and uf not in estado:
            return False
        if cliente and cod not in cods_cliente:
            return False
        return True
    boletos = [b for b in session.exec(select(Boleto)).all() if not b.apagado_em and passa_boleto(b)]
    abertos_b = [b for b in boletos if b.status != "Pago"]
    faixas = [("Até 15 dias", 0, 15), ("16 a 30 dias", 16, 30), ("31 a 60 dias", 31, 60), ("Mais de 60 dias", 61, 10 ** 6)]
    def dias_venc(b):
        return (hoje - b.data_vencimento).days if b.data_vencimento else 0
    pagos_atraso = []
    por_cli = defaultdict(lambda: {"boletos": 0, "aberto": 0.0, "atrasos": []})
    for b in boletos:
        pag = b.data_pagamento_banco or b.data_pago_sistema
        if b.status == "Pago" and pag and b.data_vencimento and de <= pag <= hoje:
            atraso = (pag - b.data_vencimento).days
            if atraso > 0:
                pagos_atraso.append(atraso)
        k = (b.pagador or "—").strip()
        if b.status != "Pago" or (pag and pag >= de):
            c = por_cli[k]
            c["boletos"] += 1
            if b.status != "Pago":
                c["aberto"] += b.valor_titulo or 0
                c["atrasos"].append(max(0, dias_venc(b)))
            elif pag and b.data_vencimento:
                c["atrasos"].append(max(0, (pag - b.data_vencimento).days))
    cobranca = {
        "aberto_valor": round(sum(b.valor_titulo or 0 for b in abertos_b), 2),
        "atraso_medio_pagamento": _media(pagos_atraso),
        "faixas": [{"faixa": f, "valor": round(sum(b.valor_titulo or 0 for b in abertos_b if a <= dias_venc(b) <= z), 2),
                    "qtd": sum(1 for b in abertos_b if a <= dias_venc(b) <= z)} for f, a, z in faixas],
        "clientes": sorted(({"nome": k, "boletos": v["boletos"], "aberto": round(v["aberto"], 2), "atraso_medio": _media(v["atrasos"])}
                            for k, v in por_cli.items() if any(x > 0 for x in v["atrasos"])),
                           key=lambda x: -(x["atraso_medio"] or 0))[:8],
    }

    # ---------------- Pós-venda ----------------
    def passa_caso(c) -> bool:
        p = ped_por_num.get(c.numero_pedido) if c.numero_pedido else None
        if vendedor and (c.vendedor or "") not in vendedor:
            return False
        if tipo and (c.tipo_entrega or "") not in tipo:
            return False
        if estado and (not p or (p.uf or "") not in estado):
            return False
        if cliente and (not p or p.cod_cliente not in cods_cliente) and (c.cliente or "").strip() not in cliente:
            return False
        return True
    casos_todos = [c for c in session.exec(select(CasoPosVenda).where(CasoPosVenda.apagado_em == None)).all() if passa_caso(c)]  # noqa: E711
    casos = [c for c in casos_todos if de <= c.aberto_em <= hoje]
    fim_caso = {}
    for a in session.exec(select(AtualizacaoPosVenda).where(AtualizacaoPosVenda.desfeita_em == None)  # noqa: E711
                          .order_by(AtualizacaoPosVenda.data, AtualizacaoPosVenda.id)).all():
        if a.status_depois in ("Resolvido", "Recusado"):
            fim_caso[a.caso_id] = a.data
        elif a.status_depois:
            fim_caso.pop(a.caso_id, None)
    encerrados = [c for c in casos if c.status in ("Resolvido", "Recusado") and c.id in fim_caso]
    contar = lambda f: [{"nome": k, "qtd": v} for k, v in sorted(f.items(), key=lambda x: -x[1])]  # noqa: E731
    pv_causa, pv_prob, pv_mes = defaultdict(int), defaultdict(int), defaultdict(int)
    for c in casos:
        pv_prob[c.problema or "—"] += 1
        pv_mes[c.aberto_em.strftime("%Y-%m")] += 1
        if c.causa:
            pv_causa[c.causa] += 1
    abertos_pv = [c for c in casos_todos if c.status in ("Encontrar solução", "Em andamento")]
    posvenda = {
        "casos": len(casos), "abertos": len(abertos_pv),
        "tempo_medio_solucao": _media([(fim_caso[c.id] - c.aberto_em).days for c in encerrados]),
        "fora_prazo_pct": _pct(sum(1 for c in casos if c.justificativa), len(casos)),
        "recusados_pct": _pct(sum(1 for c in casos if c.status == "Recusado"), len(casos)),
        "por_mes": [{"mes": m, "qtd": pv_mes.get(m, 0)} for m in meses],
        "por_causa": contar(pv_causa), "por_problema": contar(pv_prob),
    }

    # ---------------- FUP (desde 19/11) ----------------
    nums_f = {p.numero_pedido for p in ped_f}
    fups = [f for f in session.exec(select(FupRegistro).where(FupRegistro.data_referencia >= max(de, FUP_DESDE))).all() if f.numero_pedido in nums_f]
    mot = defaultdict(int)
    for f in fups:
        if (f.situacao or "atraso") != "ok":
            mot[f.motivo_atraso or "Sem motivo"] += 1

    return {
        "hoje": hoje.isoformat(), "de": de.isoformat(),
        "opcoes": {
            "vendedores": sorted({p.vendedor for p in pedidos if p.vendedor} | {i.nome_representante for i in vendas_itens if i.nome_representante}),
            "tipos": list(TIPOS),
            "estados": sorted({p.uf for p in pedidos if p.uf} | {i.uf for i in vendas_itens if i.uf}),
            "clientes": sorted(cli_nome_cod),
            "fornecedores": sorted({s.fornecedor for s in session.exec(select(NotaSaida)).all() if s.fornecedor}),
        },
        "agora": {
            "atrasados": len(atrasados), "vencem": len(vencem), "faturados_hoje": len(fat_hoje),
            "zinc_peso": round(sum(peso_nota("saida", s) or 0 for s in aguardando), 1), "zinc_saidas": len(aguardando),
            "boletos_valor": cobranca["aberto_valor"], "boletos_qtd": len(abertos_b),
            "posvenda_abertos": len(abertos_pv),
            "posvenda_vencidos": sum(1 for c in abertos_pv if c.prazo_solucao and c.prazo_solucao < hoje),
            "atrasados_por_vendedor": [{"nome": k, "qtd": v} for k, v in sorted(por_vend.items(), key=lambda x: -x[1])][:12],
            "atrasados_por_tipo": [{"tipo": k, "qtd": v} for k, v in sorted(por_tipo.items(), key=lambda x: -x[1])],
            "mais_atrasados": [{"pedido": p.numero_pedido, "cliente": p.nome_cliente, "vendedor": p.vendedor, "tipo": p.tipo_entrega,
                                "prometida": p.data_entrega_prevista.isoformat() if p.data_entrega_prevista else None,
                                "dias": p.dias_atraso_producao or 0}
                               for p in sorted(atrasados, key=lambda p: -(p.dias_atraso_producao or 0))[:10]],
        },
        "pontualidade": {"pct": pct_de(linhas_pont), "pedidos": len(linhas_pont),
                         "pct_ate_data": _pct(sum(1 for x in linhas_pont if x[6]), len(linhas_pont)), "por_mes": por_mes, "por_vendedor": por_vendedor},
        "etapas": etapas, "vendas": vendas, "zincagem": zincagem, "cobranca": cobranca, "posvenda": posvenda,
        "fup": {"registros": len(fups), "motivos": contar(mot)},
    }
