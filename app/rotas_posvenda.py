"""v2 — Pós-venda (protótipo aprovado em 11/11).

- Abrir caso pela NF ou pelo pedido (com ou sem ponto): cliente, vendedor e prazo de 30 dias vêm sozinhos.
- Prazo de 30 dias corridos depois do canhoto: só informativo; fora dele, pede justificativa.
- Atualização: o que aconteceu + status; solução obrigatória em Em andamento/Resolvido; causa obrigatória
  para encerrar; motivo obrigatório se Recusado.
- Desfazer a última atualização (uma a uma; a abertura não se desfaz) e Apagar caso (com Desfazer).
"""
import re
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from .configuracoes import ler_prazos
from .database import get_session
from .fuso import hoje_brasil
from .models import AtualizacaoPosVenda, CasoPosVenda, ItemFaturado, NotaFiscalPedido, Pedido, PedidoItem
from .rotas_novo import usuario_atual

router = APIRouter(prefix="/api/v2")

ABERTOS = ("Encontrar solução", "Em andamento")
STATUS = ABERTOS + ("Resolvido", "Recusado")


def _iso(d):
    return d.isoformat() if d else None


def _num(texto) -> str:
    return re.sub(r"[.\s]", "", str(texto or "")).strip()


def _caso_json(c: CasoPosVenda, atualizacoes) -> dict:
    return {
        "id": c.id, "numero": c.numero, "aberto_em": _iso(c.aberto_em), "aberto_por": c.aberto_por,
        "pedido": c.numero_pedido, "nf": c.nf, "cliente": c.cliente, "vendedor": c.vendedor, "tipo_entrega": c.tipo_entrega,
        "canhoto_em": _iso(c.canhoto_em), "justificativa": c.justificativa, "problema": c.problema, "descricao": c.descricao,
        "contato": c.contato, "telefone": c.telefone, "responsavel": c.responsavel, "prazo_solucao": _iso(c.prazo_solucao),
        "status": c.status, "solucao": c.solucao, "causa": c.causa, "endereco": c.endereco,
        "atualizacoes": [{
            "id": a.id, "data": _iso(a.data), "por": a.por, "texto": a.texto, "abertura": bool(a.abertura),
            "mudou": " · ".join(x for x in (
                a.status_depois if a.status_depois != a.status_antes and not a.abertura else None,
                ("solução: " + a.solucao_depois) if a.solucao_depois and a.solucao_depois != a.solucao_antes else None,
                ("causa: " + a.causa_depois) if a.causa_depois and a.causa_depois != a.causa_antes else None,
                ("responsável: " + a.responsavel_depois) if a.responsavel_depois and a.responsavel_depois != a.responsavel_antes else None,
                ("prazo: " + a.prazo_depois.strftime("%d/%m")) if a.prazo_depois and a.prazo_depois != a.prazo_antes else None,
            ) if x),
        } for a in atualizacoes],
    }


@router.get("/posvenda")
def listar(session: Session = Depends(get_session)):
    casos = session.exec(select(CasoPosVenda).where(CasoPosVenda.apagado_em == None).order_by(CasoPosVenda.id.desc())).all()  # noqa: E711
    ids = [c.id for c in casos]
    por_caso: dict = {}
    if ids:
        for a in session.exec(select(AtualizacaoPosVenda).where(AtualizacaoPosVenda.caso_id.in_(ids), AtualizacaoPosVenda.desfeita_em == None)  # noqa: E711
                              .order_by(AtualizacaoPosVenda.data, AtualizacaoPosVenda.id)).all():
            por_caso.setdefault(a.caso_id, []).append(a)
    return {"hoje": hoje_brasil().isoformat(), "prazo_dias": ler_prazos(session)["posvenda_prazo"],
            "casos": [_caso_json(c, por_caso.get(c.id, [])) for c in casos]}


def contar_abertos(session: Session) -> int:
    return session.exec(select(func.count()).select_from(CasoPosVenda)
                        .where(CasoPosVenda.apagado_em == None, CasoPosVenda.status.in_(ABERTOS))).one() or 0  # noqa: E711


@router.get("/posvenda/buscar")
def buscar(q: str, session: Session = Depends(get_session)):
    """NF ou pedido → dados para abrir o caso. Devolve as NFs do pedido para escolher."""
    n = _num(q)
    if not n:
        raise HTTPException(400, "Digite a nota fiscal ou o número do pedido.")
    pedido = session.get(Pedido, n)
    nf_escolhida = None
    if not pedido:
        ligacao = session.exec(select(NotaFiscalPedido).where(NotaFiscalPedido.nf == n)).first()
        if ligacao:
            pedido = session.get(Pedido, ligacao.numero_pedido)
            nf_escolhida = n
    if not pedido:
        item = session.exec(select(ItemFaturado).where(ItemFaturado.nf == n)).first()
        if item:  # NF que está só no Dashboard de vendas (ainda sem pedido ligado)
            return {"pedido": None, "cliente": item.nome_cliente, "vendedor": item.nome_representante, "tipo_entrega": None,
                    "nfs": [{"nf": n, "faturamento": _iso(item.data_emissao), "entrega": None, "canhoto": False, "cancelada": False}],
                    "nf": n, "itens": _itens_da_nf(session, n, None)}
        raise HTTPException(404, f"Não achei a nota ou o pedido {q}.")
    nfs = session.exec(select(NotaFiscalPedido).where(NotaFiscalPedido.numero_pedido == pedido.numero_pedido)
                       .order_by(NotaFiscalPedido.data_faturamento, NotaFiscalPedido.id)).all()
    lista = [{"nf": x.nf, "faturamento": _iso(x.data_faturamento), "entrega": _iso(x.data_entrega),
              "canhoto": bool(x.canhoto and str(x.canhoto).strip()), "cancelada": bool(x.cancelada)} for x in nfs]
    if not nf_escolhida:
        validas = [x for x in lista if not x["cancelada"]]
        nf_escolhida = validas[-1]["nf"] if validas else (lista[-1]["nf"] if lista else None)
    return {"pedido": pedido.numero_pedido, "cliente": pedido.nome_cliente, "vendedor": pedido.vendedor,
            "tipo_entrega": pedido.tipo_entrega, "nfs": lista, "nf": nf_escolhida,
            "itens": _itens_da_nf(session, nf_escolhida, pedido.numero_pedido)}


def _itens_da_nf(session: Session, nf: Optional[str], pedido: Optional[str]) -> list:
    """Itens para o romaneio: os faturados na NF (Dashboard de vendas); sem eles, os do pedido (Carteira)."""
    if nf:
        its = session.exec(select(ItemFaturado).where(ItemFaturado.nf == nf).order_by(ItemFaturado.seq)).all()
        if its:
            return [{"codigo": i.codigo_item, "descricao": i.descricao, "quantidade": i.quantidade, "unidade": i.unidade} for i in its]
    if pedido:
        its = session.exec(select(PedidoItem).where(PedidoItem.numero_pedido == pedido).order_by(PedidoItem.linha, PedidoItem.id)).all()
        return [{"codigo": i.codigo_item, "descricao": i.descricao, "quantidade": i.quantidade, "unidade": i.unidade} for i in its]
    return []


@router.get("/posvenda/{caso_id}/itens")
def itens_do_caso(caso_id: int, session: Session = Depends(get_session)):
    c = session.get(CasoPosVenda, caso_id)
    if not c:
        raise HTTPException(404, "Caso não encontrado.")
    return _itens_da_nf(session, c.nf, c.numero_pedido)


class NovoCaso(BaseModel):
    pedido: Optional[str] = None
    nf: Optional[str] = None
    cliente: Optional[str] = None
    problema: str
    descricao: str
    contato: Optional[str] = None
    telefone: Optional[str] = None
    responsavel: Optional[str] = None
    prazo_solucao: Optional[date] = None
    justificativa: Optional[str] = None


@router.post("/posvenda")
def abrir(dados: NovoCaso, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    if not (dados.problema or "").strip():
        raise HTTPException(400, "Escolha o problema.")
    if not (dados.descricao or "").strip():
        raise HTTPException(400, "Escreva o que o cliente disse.")
    pedido = session.get(Pedido, _num(dados.pedido)) if dados.pedido else None
    if dados.pedido and not pedido:
        raise HTTPException(404, f"Pedido {dados.pedido} não encontrado.")
    nf = _num(dados.nf) or None
    if not pedido and not nf:
        raise HTTPException(400, "Digite a nota fiscal ou o pedido.")
    canhoto_em = None
    if nf:
        q = select(NotaFiscalPedido).where(NotaFiscalPedido.nf == nf)
        if pedido:
            q = q.where(NotaFiscalPedido.numero_pedido == pedido.numero_pedido)
        ligacao = session.exec(q).first()
        if ligacao and ligacao.canhoto and str(ligacao.canhoto).strip():
            canhoto_em = ligacao.data_entrega
        if ligacao and not pedido:
            pedido = session.get(Pedido, ligacao.numero_pedido)
    hoje = hoje_brasil()
    prazo = ler_prazos(session)["posvenda_prazo"]
    fora = bool(canhoto_em and (hoje - canhoto_em).days > prazo)
    if fora and not (dados.justificativa or "").strip():
        raise HTTPException(400, f"Está fora do prazo de {prazo} dias: escreva por que vai abrir assim mesmo.")
    ultimo = session.exec(select(func.max(CasoPosVenda.id))).one() or 0
    cliente = (pedido.nome_cliente if pedido else None) or (dados.cliente or "").strip() or None
    vendedor = pedido.vendedor if pedido else None
    if not vendedor and nf:
        it = session.exec(select(ItemFaturado).where(ItemFaturado.nf == nf)).first()
        if it:
            vendedor = it.nome_representante
            cliente = cliente or it.nome_cliente
    numero = f"PV-{ultimo + 1:03d}"
    while session.exec(select(CasoPosVenda).where(CasoPosVenda.numero == numero)).first():
        ultimo += 1
        numero = f"PV-{ultimo + 1:03d}"
    c = CasoPosVenda(
        numero=numero, aberto_em=hoje, aberto_por=por, numero_pedido=pedido.numero_pedido if pedido else None, nf=nf,
        cliente=cliente, vendedor=vendedor, tipo_entrega=pedido.tipo_entrega if pedido else None, canhoto_em=canhoto_em,
        justificativa=((dados.justificativa or "").strip() or None) if fora else None,
        problema=dados.problema.strip(), descricao=dados.descricao.strip()[:2000],
        contato=(dados.contato or "").strip() or None, telefone=(dados.telefone or "").strip() or None,
        responsavel=(dados.responsavel or "").strip() or None, prazo_solucao=dados.prazo_solucao,
    )
    session.add(c)
    session.flush()
    session.add(AtualizacaoPosVenda(caso_id=c.id, data=hoje, por=por, abertura=True,
                                    texto="Caso aberto." + (" Fora do prazo: " + c.justificativa if c.justificativa else ""),
                                    status_depois=c.status, responsavel_depois=c.responsavel, prazo_depois=c.prazo_solucao))
    session.commit()
    return {"ok": True, "id": c.id, "numero": c.numero}


class Atualizacao(BaseModel):
    texto: str
    status: str
    solucao: Optional[str] = None
    causa: Optional[str] = None
    motivo_recusa: Optional[str] = None
    responsavel: Optional[str] = None
    prazo_solucao: Optional[date] = None


@router.post("/posvenda/{caso_id}/atualizacoes")
def atualizar(caso_id: int, dados: Atualizacao, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    c = session.get(CasoPosVenda, caso_id)
    if not c or c.apagado_em:
        raise HTTPException(404, "Caso não encontrado.")
    texto = (dados.texto or "").strip()
    if not texto:
        raise HTTPException(400, "Escreva o que aconteceu.")
    if dados.status not in STATUS:
        raise HTTPException(400, "Status inválido.")
    solucao = (dados.solucao or "").strip() or c.solucao
    if dados.status in ("Em andamento", "Resolvido") and not solucao:
        raise HTTPException(400, "Escolha a solução.")
    encerra = dados.status in ("Resolvido", "Recusado")
    causa = (dados.causa or "").strip() or None
    if encerra and not causa:
        raise HTTPException(400, "Escolha a causa para encerrar o caso.")
    if dados.status == "Recusado":
        if not (dados.motivo_recusa or "").strip():
            raise HTTPException(400, "Escreva por que foi recusado.")
        texto += " Motivo da recusa: " + dados.motivo_recusa.strip()
    a = AtualizacaoPosVenda(
        caso_id=c.id, data=hoje_brasil(), por=por, texto=texto[:2000],
        status_antes=c.status, status_depois=dados.status, solucao_antes=c.solucao, solucao_depois=solucao,
        causa_antes=c.causa, causa_depois=causa if encerra else c.causa,
        responsavel_antes=c.responsavel, responsavel_depois=(dados.responsavel or "").strip() or c.responsavel,
        prazo_antes=c.prazo_solucao, prazo_depois=dados.prazo_solucao or c.prazo_solucao,
    )
    c.status, c.solucao, c.causa = a.status_depois, a.solucao_depois, a.causa_depois
    c.responsavel, c.prazo_solucao = a.responsavel_depois, a.prazo_depois
    session.add(a)
    session.add(c)
    session.commit()
    return {"ok": True, "id": a.id}


@router.delete("/posvenda/{caso_id}/atualizacoes/{at_id}")
def desfazer(caso_id: int, at_id: int, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    """Desfaz uma atualização: só a última que vale (dá para ir desfazendo uma a uma). Não apaga: marca como desfeita."""
    c = session.get(CasoPosVenda, caso_id)
    if not c or c.apagado_em:
        raise HTTPException(404, "Caso não encontrado.")
    a = session.exec(select(AtualizacaoPosVenda).where(AtualizacaoPosVenda.caso_id == caso_id, AtualizacaoPosVenda.desfeita_em == None)  # noqa: E711
                     .order_by(AtualizacaoPosVenda.id.desc())).first()
    if not a or a.abertura:
        raise HTTPException(400, "Não há atualização para desfazer (a abertura do caso não se desfaz: apague o caso).")
    if a.id != at_id:
        raise HTTPException(409, "Outra atualização foi registrada depois desta. Desfaça a mais recente primeiro.")
    c.status = a.status_antes or c.status
    c.solucao, c.causa = a.solucao_antes, a.causa_antes
    c.responsavel, c.prazo_solucao = a.responsavel_antes, a.prazo_antes
    a.desfeita_em = datetime.utcnow()
    a.desfeita_por = por
    session.add(a)
    session.add(c)
    session.commit()
    return {"ok": True}


class EditarCaso(BaseModel):
    contato: Optional[str] = None
    telefone: Optional[str] = None
    endereco: Optional[str] = None


@router.put("/posvenda/{caso_id}")
def editar(caso_id: int, dados: EditarCaso, session: Session = Depends(get_session)):
    """Só os dados de contato e o endereço do romaneio (o resto muda por atualização)."""
    c = session.get(CasoPosVenda, caso_id)
    if not c or c.apagado_em:
        raise HTTPException(404, "Caso não encontrado.")
    for campo in ("contato", "telefone", "endereco"):
        v = getattr(dados, campo)
        if v is not None:
            setattr(c, campo, v.strip()[:500] or None)
    session.add(c)
    session.commit()
    return {"ok": True}


@router.delete("/posvenda/{caso_id}")
def apagar(caso_id: int, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    c = session.get(CasoPosVenda, caso_id)
    if not c or c.apagado_em:
        raise HTTPException(404, "Caso não encontrado.")
    c.apagado_em = datetime.utcnow()
    c.apagado_por = por
    session.add(c)
    session.commit()
    return {"ok": True}


@router.post("/posvenda/{caso_id}/restaurar")
def restaurar(caso_id: int, session: Session = Depends(get_session)):
    c = session.get(CasoPosVenda, caso_id)
    if not c:
        raise HTTPException(404, "Caso não encontrado.")
    c.apagado_em = None
    c.apagado_por = None
    session.add(c)
    session.commit()
    return {"ok": True}
