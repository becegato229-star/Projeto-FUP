"""v2 — tela Terceirização (notas de saída para a zincagem e notas de retorno).

Usa as rotas do 1.0 para ler PDF, confirmar importação, editar e marcar GE/BICRO.
Aqui ficam: a lista pronta para a tela (uma linha por nota, com a conferência),
o detalhe com "quanto já voltou" por item, a nota à mão e o apagar com Desfazer.
"""
import re
import statistics
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from .database import get_session
from .fuso import hoje_brasil
from .models import NotaItem, NotaRetorno, NotaSaida
from .rotas_novo import usuario_atual

router = APIRouter(prefix="/api/v2")

DIAS_ALERTA = 5          # saída sem retorno há mais de 5 dias = alerta (como no 1.0 / protótipo)
FORNECEDOR_PADRAO = "JJ LESTE GALVANIZACAO LTDA"


def _iso(d):
    return d.isoformat() if d else None


def _numero(texto: str) -> str:
    """Número da nota com ou sem ponto ("118.098" = "118098")."""
    t = re.sub(r"[.\s]", "", str(texto or ""))
    return t.lstrip("0") or t


def _peso_diverge(peso_nota, soma, sem_peso, tem_itens) -> bool:
    if not tem_itens or peso_nota is None or sem_peso:
        return False
    return abs(soma - peso_nota) > max(1.0, 0.005 * peso_nota)


def _por_codigo(itens) -> dict:
    q = {}
    for i in itens:
        q[i.codigo_produto] = q.get(i.codigo_produto, 0) + (i.quantidade or 0)
    return q


def montar_tela(session: Session) -> dict:
    hoje = hoje_brasil()
    saidas = session.exec(select(NotaSaida).where(NotaSaida.apagada_em == None)).all()  # noqa: E711
    retornos = session.exec(select(NotaRetorno).where(NotaRetorno.apagada_em == None)).all()  # noqa: E711
    itens = session.exec(select(NotaItem)).all()
    itens_de: dict = {}
    for i in itens:
        itens_de.setdefault((i.tipo_nota, i.numero_nota), []).append(i)
    s_por_num = {s.numero_nota: s for s in saidas}
    ret_por_saida: dict = {}
    for r in retornos:
        if r.numero_nota_saida in s_por_num:
            ret_por_saida.setdefault(r.numero_nota_saida, []).append(r)

    def base(tipo, n):
        its = itens_de.get((tipo, n.numero_nota), [])
        soma_peso = sum(i.peso_total for i in its if i.peso_total is not None)
        sem_peso = sum(1 for i in its if i.peso_total is None)
        peso = n.peso_bruto if n.peso_bruto is not None else (soma_peso if its and not sem_peso else (soma_peso or None))
        cfops = sorted({i.cfop for i in its if i.cfop})
        selos = []
        if not n.chave_acesso:
            selos.append("Sem PDF")
        if sem_peso and its:
            selos.append("Item sem peso no catálogo")
        if _peso_diverge(n.peso_bruto, soma_peso, sem_peso, bool(its)):
            selos.append("Peso não bate")
        return {
            "tipo": tipo, "numero": n.numero_nota, "data": _iso(n.data_nota), "dias": (hoje - n.data_nota).days if n.data_nota else None,
            "fornecedor": n.fornecedor, "com_pdf": bool(n.chave_acesso), "cfop": "/".join(cfops) or None,
            "peso": round(peso, 3) if peso is not None else None, "peso_calculado": n.peso_bruto is None and peso is not None,
            "valor": n.valor_total_nota if n.valor_total_nota is not None else n.valor_total_produtos,
            "itens": len(its), "tem_bicro": any((i.acabamento or "").upper() == "BICRO" for i in its) if tipo == "saida" else False,
            "selos": selos,
        }

    notas = []
    lead_times = []
    for s in saidas:
        b = base("saida", s)
        rets = sorted(ret_por_saida.get(s.numero_nota, []), key=lambda r: (r.data_nota, r.numero_nota))
        saiu = _por_codigo(itens_de.get(("saida", s.numero_nota), []))
        voltou: dict = {}
        for r in rets:
            for c, q in _por_codigo(itens_de.get(("retorno", r.numero_nota), [])).items():
                voltou[c] = voltou.get(c, 0) + q
        if not rets:
            situacao = "Aguardando retorno"
        elif saiu and any(voltou.get(c, 0) + 1e-9 < q for c, q in saiu.items()) and any(itens_de.get(("retorno", r.numero_nota)) for r in rets):
            situacao = "Retorno parcial"
        else:
            situacao = "Retornou"
        for r in rets:
            lead_times.append((r.data_nota - s.data_nota).days)
        if situacao != "Retornou" and b["dias"] is not None and b["dias"] > DIAS_ALERTA:
            b["selos"].append(f"Há mais de {DIAS_ALERTA} dias")
        if b["tem_bicro"]:
            b["selos"].insert(0, "BICRO")
        if len(rets) > 1:
            b["selos"].append(f"{len(rets)} retornos")
        b.update({
            "situacao": situacao,
            "retornos": [{"numero": r.numero_nota, "data": _iso(r.data_nota), "lead": (r.data_nota - s.data_nota).days} for r in rets],
            "faltam": {c: round(q - voltou.get(c, 0), 3) for c, q in saiu.items() if voltou.get(c, 0) + 1e-9 < q}
                      if any(itens_de.get(("retorno", r.numero_nota)) for r in rets) else {},
        })
        notas.append(b)
    for r in retornos:
        b = base("retorno", r)
        s = s_por_num.get(r.numero_nota_saida) if r.numero_nota_saida else None
        if not r.numero_nota_saida:
            b["selos"].append("Sem ligação")
        elif not s:
            b["selos"].append("Saída não lançada")
        b.update({
            "situacao": "Retorno",
            "saida": r.numero_nota_saida, "saida_existe": bool(s), "lead": (r.data_nota - s.data_nota).days if s else None,
            "vinculo_manual": bool(r.vinculo_manual),
            "tem_bicro": bool(s) and any((i.acabamento or "").upper() == "BICRO" for i in itens_de.get(("saida", s.numero_nota), [])),
        })
        if b["tem_bicro"]:
            b["selos"].insert(0, "BICRO")
        notas.append(b)
    for n in notas:
        n["pendente"] = any(x in ("Sem PDF", "Item sem peso no catálogo", "Peso não bate", "Sem ligação", "Saída não lançada") or x.startswith("Há mais de") for x in n["selos"])
    notas.sort(key=lambda n: (n["data"] or "", n["numero"]), reverse=True)

    aguardando = [n for n in notas if n["tipo"] == "saida" and n["situacao"] != "Retornou"]
    mes = hoje.strftime("%Y-%m")
    voltaram_mes = [n for n in notas if n["tipo"] == "retorno" and (n["data"] or "").startswith(mes)]
    return {
        "hoje": hoje.isoformat(), "dias_alerta": DIAS_ALERTA, "notas": notas,
        "resumo": {
            "aguardando": len(aguardando), "aguardando_peso": round(sum(n["peso"] or 0 for n in aguardando), 3),
            "aguardando_atrasadas": sum(1 for n in aguardando if (n["dias"] or 0) > DIAS_ALERTA),
            "lead_mediana": statistics.median(lead_times) if lead_times else None,
            "lead_min": min(lead_times) if lead_times else None, "lead_max": max(lead_times) if lead_times else None,
            "voltaram_mes": len(voltaram_mes), "voltaram_mes_peso": round(sum(n["peso"] or 0 for n in voltaram_mes), 3),
            "pendentes": sum(1 for n in notas if n["pendente"]),
        },
        "fornecedores": sorted({n["fornecedor"] for n in notas if n["fornecedor"]} | {FORNECEDOR_PADRAO}),
    }


@router.get("/terceirizacao")
def tela(session: Session = Depends(get_session)):
    return montar_tela(session)


@router.get("/terceirizacao/{tipo}/{numero}")
def detalhe(tipo: str, numero: str, session: Session = Depends(get_session)):
    """O detalhe do 1.0 + quanto de cada item já voltou (saída) ou se estava na saída (retorno)."""
    from .main import detalhe_nota_terceirizacao
    d = detalhe_nota_terceirizacao(tipo, numero, session)
    itens = d["itens"]
    if tipo == "saida":
        voltou: dict = {}
        for r in d.get("retornos_vinculados", []):
            for i in session.exec(select(NotaItem).where(NotaItem.tipo_nota == "retorno", NotaItem.numero_nota == r["numero_nota"])).all():
                voltou[i.codigo_produto] = voltou.get(i.codigo_produto, 0) + (i.quantidade or 0)
        # cada código pode ter mais de uma linha (ex.: metade GE, metade BICRO): o que voltou cobre as linhas em ordem
        resto = dict(voltou)
        for i in itens:
            q = i.get("quantidade") or 0
            v = min(q, resto.get(i["codigo_produto"], 0))
            resto[i["codigo_produto"]] = resto.get(i["codigo_produto"], 0) - v
            i["voltou"] = round(v, 3)
            i["falta"] = round(q - v, 3)
    else:
        esperado = d.get("acabamento_esperado") or {}
        for i in itens:
            lst = esperado.get(i["codigo_produto"])
            # saída lançada à mão (sem itens) não dá para conferir: fica "sem itens" em vez de "não estava"
            i["estava_na_saida"] = bool(lst) if d.get("saida_vinculada") and esperado else None
            i["saida_sem_itens"] = bool(d.get("saida_vinculada")) and not esperado
            i["precisa_voltar"] = "/".join(sorted({x["acabamento"] for x in lst})) if lst else None
    for i in itens:
        i["preco_kg"] = round(i["valor_total"] / i["peso_total"], 2) if i.get("valor_total") and i.get("peso_total") else None
    return d


class NotaManual(BaseModel):
    tipo: str                     # "saida" | "retorno"
    numero: str
    data: date
    fornecedor: Optional[str] = None
    saida: Optional[str] = None   # só retorno


@router.post("/terceirizacao/manual")
def nota_manual(dados: NotaManual, session: Session = Depends(get_session)):
    if dados.tipo not in ("saida", "retorno"):
        raise HTTPException(400, "Tipo inválido.")
    numero = _numero(dados.numero)
    if not numero or not numero.isdigit():
        raise HTTPException(400, "Número da nota inválido (só números, com ou sem ponto).")
    forn = (dados.fornecedor or "").strip() or FORNECEDOR_PADRAO
    Model = NotaSaida if dados.tipo == "saida" else NotaRetorno
    existente = session.get(Model, numero)
    if existente and not existente.apagada_em:
        raise HTTPException(409, f"Já existe uma nota de {'saída' if dados.tipo == 'saida' else 'retorno'} com o número {numero}.")
    saida = _numero(dados.saida) if dados.saida else None
    saida_nota = session.get(NotaSaida, saida) if saida else None
    if dados.tipo == "retorno" and saida and (saida_nota is None or saida_nota.apagada_em):
        raise HTTPException(404, f"A nota de saída {saida} não está no FlowLog. Lance a saída primeiro ou deixe sem ligação.")
    if existente:  # estava apagada: volta com os dados novos
        existente.apagada_em = None
        existente.apagada_por = None
        existente.data_nota = dados.data
        existente.fornecedor = forn
        if dados.tipo == "retorno":
            existente.numero_nota_saida = saida
            existente.vinculo_manual = bool(saida)
        session.add(existente)
    elif dados.tipo == "saida":
        session.add(NotaSaida(numero_nota=numero, data_nota=dados.data, fornecedor=forn))
    else:
        session.add(NotaRetorno(numero_nota=numero, data_nota=dados.data, fornecedor=forn, numero_nota_saida=saida, vinculo_manual=bool(saida)))
    session.commit()
    return {"ok": True, "numero": numero}


def _nota(tipo, numero, session):
    Model = {"saida": NotaSaida, "retorno": NotaRetorno}.get(tipo)
    if not Model:
        raise HTTPException(404, "Tipo de nota inválido.")
    n = session.get(Model, numero)
    if not n:
        raise HTTPException(404, "Nota não encontrada.")
    return n


@router.delete("/terceirizacao/{tipo}/{numero}")
def apagar(tipo: str, numero: str, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    """Tira a nota das listas (e do alerta da zincagem). Nada é apagado de verdade: itens e PDF ficam."""
    n = _nota(tipo, numero, session)
    if n.apagada_em:
        raise HTTPException(404, "Nota não encontrada.")
    n.apagada_em = datetime.utcnow()
    n.apagada_por = por
    session.add(n)
    session.commit()
    return {"ok": True}


@router.post("/terceirizacao/{tipo}/{numero}/restaurar")
def restaurar(tipo: str, numero: str, session: Session = Depends(get_session)):
    n = _nota(tipo, numero, session)
    n.apagada_em = None
    n.apagada_por = None
    session.add(n)
    session.commit()
    return {"ok": True}
