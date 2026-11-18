"""v2 — tela Cobrança (boletos vencidos do relatório do banco).

Regras (aprovadas em 18/11):
- Saiu do relatório = Pago (automático, na importação). Pago que volta = Em aberto, "Voltou a aparecer".
- "Negociado": o cliente combinou outra forma/data; continua devendo, com o combinado anotado.
- Mudar status pede motivo. Apagar tira da lista (com Desfazer); se ainda estiver no relatório,
  volta na próxima importação. As cobranças nunca são apagadas junto.
- A Silvia cobra o cliente, não o boleto: "Registrar cobrança" vale para vários boletos de uma vez.
- Cobrar hoje = cliente com boleto em aberto que nunca foi cobrado ou cuja data de cobrar de novo chegou.
"""
import re
import uuid
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from .configuracoes import agora_brasil
from .database import get_session
from .fuso import hoje_brasil
from .models import Boleto, CobrancaRegistro, ImportacaoRegistro, ItemFaturado, NotaFiscalPedido, Pedido
from .rotas_novo import usuario_atual

router = APIRouter(prefix="/api/v2")

STATUS_VALIDOS = ("Em aberto", "Negociado", "Pago")
JANELA_DESFAZER = timedelta(minutes=15)


def _iso(d):
    return d.isoformat() if d else None


def chave_cliente(b: Boleto) -> str:
    """O mesmo cliente pelo CNPJ/CPF (só os dígitos); sem ele, pelo nome."""
    dig = re.sub(r"\D", "", str(b.cnpj_cpf or ""))
    if dig:
        return dig
    nome = (b.pagador or "").strip().upper()
    return ("nome:" + nome) if nome else ("boleto:" + b.seu_numero)  # sem CNPJ e sem nome: cada boleto é um cliente


def nf_do_boleto(seu_numero: str) -> Optional[str]:
    """Seu número = NF + parcela (ex.: 115352-002 → NF 115352). A confirmar no Mega (18/11)."""
    m = re.match(r"^\s*0*(\d{4,})\s*[-/]", seu_numero or "")
    if m:
        return m.group(1)
    m = re.fullmatch(r"\s*0*(\d{4,})\s*", seu_numero or "")
    return m.group(1) if m else None


def devendo(b: Boleto) -> bool:
    return b.status != "Pago"


def _dados_por_nf(session: Session, nfs: set) -> dict:
    """NF → (pedido, vendedor). Pelo pedido da planilha da expedição; sem ele, pelo Dashboard de vendas."""
    if not nfs:
        return {}
    saida = {}
    ligacoes = session.exec(select(NotaFiscalPedido).where(NotaFiscalPedido.nf.in_(list(nfs)))).all()
    pedidos = {p.numero_pedido: p for p in session.exec(
        select(Pedido).where(Pedido.numero_pedido.in_([n.numero_pedido for n in ligacoes]))).all()} if ligacoes else {}
    for n in ligacoes:
        p = pedidos.get(n.numero_pedido)
        saida[n.nf] = (n.numero_pedido, p.vendedor if p else None)
    faltam = [nf for nf in nfs if nf not in saida or not saida[nf][1]]
    if faltam:
        for nf, rep in session.exec(select(ItemFaturado.nf, ItemFaturado.nome_representante)
                                    .where(ItemFaturado.nf.in_(faltam))).all():
            if rep:
                atual = saida.get(nf, (None, None))
                saida[nf] = (atual[0], atual[1] or rep)
    return saida


def _registro_json(r: CobrancaRegistro) -> dict:
    return {"id": r.id, "boleto": r.seu_numero, "data": _iso(r.data_registro), "texto": r.motivo,
            "proxima": _iso(r.proxima_data_cobranca), "por": r.registrado_por, "grupo": r.grupo or f"r{r.id}",
            "criado": r.created_at.isoformat() if r.created_at else None}


def _cobrar_hoje_por_cliente(boletos, registros, hoje) -> dict:
    ultima = {}
    cliente_do_boleto = {b.seu_numero: chave_cliente(b) for b in boletos}
    for r in registros:  # já em ordem de data
        k = cliente_do_boleto.get(r.seu_numero)
        if k:
            ultima[k] = r
    abertos = {}
    for b in boletos:
        if devendo(b) and not b.apagado_em:
            abertos.setdefault(chave_cliente(b), 0)
            abertos[chave_cliente(b)] += 1
    resultado = {}
    for k in abertos:
        u = ultima.get(k)
        resultado[k] = (u is None) or (u.proxima_data_cobranca is None) or (u.proxima_data_cobranca <= hoje)
    return resultado, ultima


def tela_cobranca(session: Session) -> dict:
    hoje = hoje_brasil()
    todos = session.exec(select(Boleto)).all()
    registros = session.exec(select(CobrancaRegistro).order_by(CobrancaRegistro.data_registro, CobrancaRegistro.id)).all()
    cobrar, ultima = _cobrar_hoje_por_cliente(todos, registros, hoje)
    visiveis = [b for b in todos if not b.apagado_em]
    nfs = {nf for nf in (nf_do_boleto(b.seu_numero) for b in visiveis) if nf}
    por_nf = _dados_por_nf(session, nfs)
    saida = []
    for b in visiveis:
        k = chave_cliente(b)
        nf = nf_do_boleto(b.seu_numero)
        pedido, vendedor = por_nf.get(nf, (None, None)) if nf else (None, None)
        u = ultima.get(k)
        dias = (hoje - b.data_vencimento).days if b.data_vencimento else None
        pago_dias = None
        if b.status == "Pago" and b.data_vencimento:
            pagamento = b.data_pagamento_banco or b.data_pago_sistema
            pago_dias = (pagamento - b.data_vencimento).days if pagamento else None
        saida.append({
            "num": b.seu_numero, "nosso": b.nosso_numero, "pagador": b.pagador, "cnpj": b.cnpj_cpf, "cliente": k,
            "emissao": _iso(b.data_emissao), "vencimento": _iso(b.data_vencimento), "valor": b.valor_titulo,
            "valor_pago": b.valor_pago, "pagamento_banco": _iso(b.data_pagamento_banco), "baixa": _iso(b.data_baixa),
            "status": b.status, "pago_em": _iso(b.data_pago_sistema), "voltou": bool(b.reapareceu),
            "dias": dias, "pago_dias_atraso": pago_dias,
            "status_motivo": b.status_motivo, "status_por": b.status_por, "status_em": b.status_em.isoformat() if b.status_em else None,
            "nf": nf, "pedido": pedido, "vendedor": vendedor,
            "cobrar_hoje": bool(devendo(b) and cobrar.get(k)),
            "ultima": ({"data": _iso(u.data_registro), "por": u.registrado_por, "texto": u.motivo, "proxima": _iso(u.proxima_data_cobranca)} if u else None),
        })
    saida.sort(key=lambda x: (x["status"] == "Pago", x["vencimento"] or "9999"))
    nums_visiveis = {b.seu_numero for b in visiveis}
    ultima_imp = session.exec(select(ImportacaoRegistro).where(ImportacaoRegistro.tipo == "boletos")
                              .order_by(ImportacaoRegistro.quando.desc())).first()
    return {
        "hoje": hoje.isoformat(), "boletos": saida,
        "registros": [_registro_json(r) for r in registros if r.seu_numero in nums_visiveis],
        "clientes_cobrar_hoje": sum(1 for v in cobrar.values() if v),
        "ultima_importacao": ({"quando": ultima_imp.quando.isoformat(), "por": ultima_imp.por, "resumo": ultima_imp.resumo} if ultima_imp else None),
    }


@router.get("/cobranca")
def listar(session: Session = Depends(get_session)):
    return tela_cobranca(session)


def contar_cobrar_hoje(session: Session) -> int:
    todos = session.exec(select(Boleto)).all()
    registros = session.exec(select(CobrancaRegistro).order_by(CobrancaRegistro.data_registro, CobrancaRegistro.id)).all()
    cobrar, _ = _cobrar_hoje_por_cliente(todos, registros, hoje_brasil())
    return sum(1 for v in cobrar.values() if v)


def _espelhar(session: Session, seu_numero: str) -> None:
    ultimo = session.exec(select(CobrancaRegistro).where(CobrancaRegistro.seu_numero == seu_numero)
                          .order_by(CobrancaRegistro.data_registro.desc(), CobrancaRegistro.id.desc())).first()
    b = session.get(Boleto, seu_numero)
    if b:
        b.motivo_cobranca_recente = ultimo.motivo if ultimo else None
        b.proxima_cobranca = ultimo.proxima_data_cobranca if ultimo else None
        session.add(b)


class NovaCobranca(BaseModel):
    boletos: List[str]
    texto: str
    proxima: date
    data: Optional[date] = None


@router.post("/cobranca/registros")
def registrar(dados: NovaCobranca, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    texto = (dados.texto or "").strip()
    if not texto:
        raise HTTPException(400, "Escreva o que o cliente disse.")
    hoje = hoje_brasil()
    if dados.proxima <= hoje:
        raise HTTPException(400, "\"Cobrar de novo em\" tem que ser a partir de amanhã.")
    nums = list(dict.fromkeys(n for n in dados.boletos if n))
    if not nums:
        raise HTTPException(400, "Marque pelo menos um boleto.")
    for n in nums:
        b = session.get(Boleto, n)
        if not b or b.apagado_em:
            raise HTTPException(404, f"Boleto {n} não encontrado.")
    grupo = uuid.uuid4().hex[:12]
    ids = []
    for n in nums:
        r = CobrancaRegistro(seu_numero=n, data_registro=dados.data or hoje, motivo=texto[:1000],
                             proxima_data_cobranca=dados.proxima, registrado_por=por, grupo=grupo)
        session.add(r)
        session.flush()
        ids.append(r.id)
        _espelhar(session, n)
    session.commit()
    return {"ok": True, "grupo": grupo, "ids": ids}


@router.delete("/cobranca/registros/grupo/{grupo}")
def desfazer_registro(grupo: str, session: Session = Depends(get_session)):
    regs = session.exec(select(CobrancaRegistro).where(CobrancaRegistro.grupo == grupo)).all()
    if not regs and grupo.startswith("r") and grupo[1:].isdigit():
        r = session.get(CobrancaRegistro, int(grupo[1:]))
        regs = [r] if r else []
    if not regs:
        raise HTTPException(404, "Cobrança não encontrada.")
    if any(r.created_at and datetime.utcnow() - r.created_at > JANELA_DESFAZER for r in regs):
        raise HTTPException(400, "Só dá para desfazer nos primeiros 15 minutos.")
    nums = {r.seu_numero for r in regs}
    for r in regs:
        session.delete(r)
    session.flush()
    for n in nums:
        _espelhar(session, n)
    session.commit()
    return {"ok": True}


class MudarStatus(BaseModel):
    status: str
    motivo: str


@router.put("/cobranca/{seu_numero:path}/status")
def mudar_status(seu_numero: str, dados: MudarStatus, session: Session = Depends(get_session),
                 por: Optional[str] = Depends(usuario_atual)):
    b = session.get(Boleto, seu_numero)
    if not b or b.apagado_em:
        raise HTTPException(404, "Boleto não encontrado.")
    if dados.status not in STATUS_VALIDOS:
        raise HTTPException(400, "Status inválido.")
    motivo = (dados.motivo or "").strip()
    if not motivo:
        raise HTTPException(400, "Escreva o que foi combinado ou por que está mudando.")
    antes = {"status": b.status, "motivo": b.status_motivo, "pago_em": _iso(b.data_pago_sistema), "voltou": b.reapareceu,
             "status_por": b.status_por, "status_em": b.status_em.isoformat() if b.status_em else None}
    if dados.status == "Pago":
        if b.status != "Pago":
            b.data_pago_sistema = hoje_brasil()
        b.reapareceu = False
    else:
        b.data_pago_sistema = None
    b.status = dados.status
    b.status_motivo = motivo[:500]
    b.status_por = por
    b.status_em = agora_brasil()
    b.updated_at = datetime.utcnow()
    session.add(b)
    session.commit()
    antes["marca"] = b.status_em.isoformat()  # o Desfazer só vale se nada mudou o boleto depois
    antes["depois"] = b.status
    return {"ok": True, "antes": antes}


class VoltarStatus(BaseModel):
    status: str
    motivo: Optional[str] = None
    pago_em: Optional[date] = None
    voltou: Optional[bool] = False
    status_por: Optional[str] = None
    status_em: Optional[datetime] = None
    marca: Optional[str] = None
    depois: Optional[str] = None


@router.post("/cobranca/{seu_numero:path}/status/desfazer")
def desfazer_status(seu_numero: str, dados: VoltarStatus, session: Session = Depends(get_session)):
    b = session.get(Boleto, seu_numero)
    if not b or b.apagado_em:
        raise HTTPException(404, "Boleto não encontrado.")
    if dados.status not in STATUS_VALIDOS:
        raise HTTPException(400, "Status inválido.")
    if not dados.marca or not b.status_em or b.status_em.isoformat() != dados.marca or b.status != dados.depois \
            or datetime.utcnow() - b.updated_at > JANELA_DESFAZER:
        raise HTTPException(409, "O boleto mudou depois (ou passaram 15 minutos). Mude o status à mão.")
    b.status, b.status_motivo, b.data_pago_sistema = dados.status, dados.motivo, dados.pago_em
    b.reapareceu, b.status_por, b.status_em = bool(dados.voltou), dados.status_por, dados.status_em
    session.add(b)
    session.commit()
    return {"ok": True}


@router.delete("/cobranca/{seu_numero:path}")
def apagar(seu_numero: str, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    """Tira o boleto da lista (não apaga do banco: dá para desfazer e as cobranças ficam)."""
    b = session.get(Boleto, seu_numero)
    if not b or b.apagado_em:
        raise HTTPException(404, "Boleto não encontrado.")
    b.apagado_em = datetime.utcnow()
    b.apagado_por = por
    session.add(b)
    session.commit()
    return {"ok": True}


@router.post("/cobranca/{seu_numero:path}/restaurar")
def restaurar(seu_numero: str, session: Session = Depends(get_session)):
    b = session.get(Boleto, seu_numero)
    if not b:
        raise HTTPException(404, "Boleto não encontrado.")
    b.apagado_em = None
    b.apagado_por = None
    session.add(b)
    session.commit()
    return {"ok": True}
