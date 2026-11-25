"""
v2 — Avisos de canhoto (uma linha por NF) e Transportadora (linha do tempo
por NF). Prefixo /api/v2. Registros antigos (sem NF) valem para todas as
NFs do pedido. Nada aqui apaga registro antigo: o "Desfazer" só apaga o
que acabou de ser criado (até 15 minutos).
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from .configuracoes import datas_feriados, ler_prazos
from .database import get_session
from .fuso import hoje_brasil
from .models import AvisoRegistro, NotaFiscalPedido, Pedido, TransportadoraRegistro
from .rotas_novo import usuario_atual
from .rotas_pedidos import recalcular_se_necessario

from .canhotos_drive import fotos_por_nf  # noqa: E402

router = APIRouter(prefix="/api/v2")
JANELA_DESFAZER = timedelta(minutes=15)


def _iso(d) -> Optional[str]:
    return d.isoformat() if d else None


def _dias_uteis(d1: date, d2: date, feriados) -> int:
    from .importer import _dias_uteis_entre
    return _dias_uteis_entre(d1, d2, feriados)


def _nfs_por_pedido(session: Session) -> dict:
    nfs: dict = {}
    for n in session.exec(select(NotaFiscalPedido).order_by(NotaFiscalPedido.data_faturamento, NotaFiscalPedido.id)).all():
        nfs.setdefault(n.numero_pedido, []).append(n)
    return nfs


def _texto_parcial(nota: NotaFiscalPedido, todas: list) -> str:
    validas = [n for n in todas if not n.cancelada and not n.fora_da_planilha]
    if len(validas) < 2:
        return ""
    ordem = validas.index(nota) + 1 if nota in validas else 0
    outras = [n for n in validas if n is not nota]
    com = [n.nf for n in outras if n.canhoto]
    sem = [n.nf for n in outras if not n.canhoto]
    partes = [f"{ordem}ª de {len(validas)} NFs."]
    if com:
        partes.append("Já têm canhoto: " + ", ".join(com) + ".")
    if sem:
        partes.append("Também sem canhoto: " + ", ".join(sem) + ".")
    return " ".join(partes)


class _SemNF:
    """Linha para pedido sem NF legível (ex.: NF "SEM NF" ou em branco na
    planilha) que o 1.0 já considerava faturado: usa os campos do pedido.
    Registros feitos nela valem para o pedido inteiro (nf vazia)."""
    def __init__(self, p: Pedido):
        self.nf = None
        self.data_faturamento = p.data_faturamento
        self.data_entrega = p.data_entrega_real
        self.canhoto = p.canhoto
        self.cancelada = False
        self.fora_da_planilha = False


def _linhas_do_pedido(p: Pedido, lista: list) -> list:
    validas = [n for n in lista if not n.cancelada and not n.fora_da_planilha and n.data_faturamento]
    return validas


def _pode_desfazer(criado: Optional[datetime]) -> bool:
    return bool(criado) and datetime.utcnow() - criado <= JANELA_DESFAZER


# ---------------------------------------------------------------------
# Avisos de canhoto
# ---------------------------------------------------------------------
@router.get("/avisos")
def listar_avisos(session: Session = Depends(get_session)):
    recalcular_se_necessario(session)
    hoje = hoje_brasil()
    prazos = ler_prazos(session)
    feriados = datas_feriados(session)
    limites = {"Entrega": prazos["aviso_entrega"], "Transportadora": prazos["aviso_transportadora"], "Retira": prazos["aviso_retira"]}
    pedidos = {p.numero_pedido: p for p in session.exec(select(Pedido)).all()}
    nfs = _nfs_por_pedido(session)
    regs: dict = {}
    for r in session.exec(select(AvisoRegistro).order_by(AvisoRegistro.data_registro, AvisoRegistro.id)).all():
        regs.setdefault(r.numero_pedido, []).append(r)

    saida = []
    for numero, p in pedidos.items():
        lista = nfs.get(numero, [])
        linhas = _linhas_do_pedido(p, lista)
        if not linhas and p.aviso_entrega:
            linhas = [_SemNF(p)]  # o 1.0 marcava aviso sem NF legível: não pode sumir
        for n in linhas:
            limite = limites.get(p.tipo_entrega, 4)
            dias = _dias_uteis(n.data_faturamento, hoje, feriados) if n.data_faturamento else (p.dias_uteis_desde_faturamento or 0)
            registros = [r for r in regs.get(numero, []) if r.nf in (None, n.nf)]
            if n.canhoto:
                if not registros:
                    continue  # nunca foi aviso acompanhado: não precisa estar no histórico
                situacao = "hist"
            elif p.cancelado or p.status == "Cancelado":
                if not registros:
                    continue
                situacao = "hist"
            elif dias < limite and n.nf is not None:
                continue
            else:
                ult = registros[-1] if registros else None
                # como no 1.0: registro sem data para verificar de novo = tratado
                situacao = "acomp" if ult and (ult.proxima_data_limite is None or ult.proxima_data_limite > hoje) else "atencao"
            saida.append({
                "pedido": numero, "nf": n.nf, "cliente": p.nome_cliente, "tipo": p.tipo_entrega or "Desconhecido",
                "transportadora": p.transportadora_nome, "vendedor": p.vendedor, "faturamento": _iso(n.data_faturamento),
                "dias": dias, "prazo": limite, "canhoto": bool(n.canhoto), "canhoto_drive": (n.canhoto or "").startswith("drive:"), "entrega": _iso(n.data_entrega),
                "parcial": _texto_parcial(n, lista) if n.nf else "", "situacao": situacao, "pedido_cancelado": bool(p.cancelado),
                "registros": [{"id": r.id, "data": _iso(r.data_registro), "por": r.registrado_por, "texto": r.motivo,
                               "proxima": _iso(r.proxima_data_limite), "pode_desfazer": _pode_desfazer(r.created_at)} for r in registros],
            })
    fotos = fotos_por_nf(session, {a["nf"] for a in saida if a["nf"]})  # canhotos no Google Drive (só o link)
    for a in saida:
        a["fotos"] = fotos.get(a["nf"], []) if a["nf"] else []
    ordem = {"atencao": 0, "acomp": 1, "hist": 2}
    saida.sort(key=lambda a: (ordem[a["situacao"]], -a["dias"]))
    return {"hoje": hoje.isoformat(), "avisos": saida}


class AcompanhamentoNovo(BaseModel):
    pedido: str
    nf: Optional[str] = None
    texto: str
    proxima: date


@router.post("/avisos/registros")
def registrar_acompanhamento(dados: AcompanhamentoNovo, session: Session = Depends(get_session),
                             por: Optional[str] = Depends(usuario_atual)):
    if not session.get(Pedido, dados.pedido):
        raise HTTPException(404, "Pedido não encontrado.")
    texto = (dados.texto or "").strip()
    if not texto:
        raise HTTPException(400, "Escreva o que foi feito.")
    if dados.proxima <= hoje_brasil():
        raise HTTPException(400, "Escolha quando verificar de novo (a partir de amanhã).")
    r = AvisoRegistro(numero_pedido=dados.pedido, nf=dados.nf, motivo=texto[:500], proxima_data_limite=dados.proxima,
                      data_registro=hoje_brasil(), registrado_por=por)
    session.add(r)
    session.commit()
    session.refresh(r)
    return {"ok": True, "id": r.id}


@router.delete("/avisos/registros/{registro_id}")
def desfazer_acompanhamento(registro_id: int, session: Session = Depends(get_session)):
    r = session.get(AvisoRegistro, registro_id)
    if not r:
        raise HTTPException(404, "Registro não encontrado.")
    if not _pode_desfazer(r.created_at):
        raise HTTPException(400, "Só dá para desfazer logo depois de registrar (até 15 minutos).")
    session.delete(r)
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------
# Transportadora
# ---------------------------------------------------------------------
def _evento(r: TransportadoraRegistro) -> Optional[str]:
    if r.evento:
        return r.evento
    return "chamada" if r.chamado else None  # registro antigo


@router.get("/transportadora")
def listar_transportadora(session: Session = Depends(get_session)):
    recalcular_se_necessario(session)
    hoje = hoje_brasil()
    feriados = datas_feriados(session)
    pedidos = {p.numero_pedido: p for p in session.exec(select(Pedido).where(Pedido.tipo_entrega == "Transportadora")).all()}
    nfs = _nfs_por_pedido(session)
    regs: dict = {}
    for r in session.exec(select(TransportadoraRegistro).order_by(TransportadoraRegistro.data_registro, TransportadoraRegistro.id)).all():
        regs.setdefault(r.numero_pedido, []).append(r)
    saida = []
    for numero, p in pedidos.items():
        if p.cancelado:
            continue
        linhas = _linhas_do_pedido(p, nfs.get(numero, []))
        if not linhas and p.status in ("Faturado", "Encerrado"):
            linhas = [_SemNF(p)]  # faturado no 1.0 sem NF legível: não pode sumir
        for n in linhas:
            registros = [r for r in regs.get(numero, []) if r.nf in (None, n.nf)]
            chamadas = [r for r in registros if _evento(r) == "chamada"]
            coletas = [r for r in registros if _evento(r) == "coletado"]
            if n.canhoto:
                etapa = "encerrado"
            elif coletas:
                etapa = "coletado"
            elif chamadas:
                etapa = "chamada"
            else:
                etapa = "chamar"
            dias = _dias_uteis(n.data_faturamento, hoje, feriados) if n.data_faturamento else 0
            ch = chamadas[-1] if chamadas else None
            co = coletas[-1] if coletas else None
            saida.append({
                "pedido": numero, "nf": n.nf, "cliente": p.nome_cliente, "transportadora": p.transportadora_nome,
                "vendedor": p.vendedor, "faturamento": _iso(n.data_faturamento), "dias": dias, "etapa": etapa,
                "alerta": etapa == "chamar" and dias >= 2,
                "chamada": {"data": _iso(ch.data_registro), "hora": ch.hora, "quem": ch.quem_chamou, "codigo": ch.codigo_coleta,
                            "previsao": _iso(ch.previsao_retirada), "obs": ch.observacao, "por": ch.registrado_por} if ch else None,
                "coleta": {"data": _iso(co.data_registro), "obs": co.observacao, "por": co.registrado_por} if co else None,
                "canhoto_em": _iso(n.data_entrega) if n.canhoto else None,
                "canhoto_drive": (n.canhoto or "").startswith("drive:"),
                "registros": [{"id": r.id, "evento": _evento(r) or "nota", "data": _iso(r.data_registro), "hora": r.hora,
                               "quem": r.quem_chamou, "codigo": r.codigo_coleta, "previsao": _iso(r.previsao_retirada),
                               "obs": r.observacao, "por": r.registrado_por, "pode_desfazer": _pode_desfazer(r.created_at)} for r in registros],
            })
    fotos = fotos_por_nf(session, {a["nf"] for a in saida if a["nf"]})  # canhotos no Google Drive (só o link)
    for a in saida:
        a["fotos"] = fotos.get(a["nf"], []) if a["nf"] else []
    ordem = {"chamar": 0, "chamada": 1, "coletado": 2, "encerrado": 3}
    saida.sort(key=lambda a: (ordem[a["etapa"]], a["faturamento"] or ""))
    return {"hoje": hoje.isoformat(), "itens": saida}


class EventoTransportadora(BaseModel):
    pedido: str
    nf: Optional[str] = None
    evento: str                         # "chamada" | "coletado"
    data: date
    hora: Optional[str] = None
    quem: Optional[str] = None
    codigo: Optional[str] = None
    previsao: Optional[date] = None
    obs: Optional[str] = None


@router.post("/transportadora/registros")
def registrar_evento(dados: EventoTransportadora, session: Session = Depends(get_session),
                     por: Optional[str] = Depends(usuario_atual)):
    if not session.get(Pedido, dados.pedido):
        raise HTTPException(404, "Pedido não encontrado.")
    if dados.evento not in ("chamada", "coletado"):
        raise HTTPException(400, "Evento inválido.")
    if dados.data > hoje_brasil():
        raise HTTPException(400, "A data não pode ser no futuro.")
    if dados.evento == "chamada" and not (dados.quem or "").strip():
        raise HTTPException(400, "Diga quem chamou a coleta.")
    r = TransportadoraRegistro(
        numero_pedido=dados.pedido, nf=dados.nf, evento=dados.evento, data_registro=dados.data,
        chamado=dados.evento == "chamada", quem_chamou=(dados.quem or "").strip()[:40] or None,
        hora=(dados.hora or "")[:5] or None, codigo_coleta=(dados.codigo or "").strip()[:40] or None,
        previsao_retirada=dados.previsao, observacao=(dados.obs or "").strip()[:500] or None, registrado_por=por,
    )
    session.add(r)
    session.commit()
    session.refresh(r)
    return {"ok": True, "id": r.id}


@router.delete("/transportadora/registros/{registro_id}")
def desfazer_evento(registro_id: int, session: Session = Depends(get_session)):
    r = session.get(TransportadoraRegistro, registro_id)
    if not r:
        raise HTTPException(404, "Registro não encontrado.")
    if not _pode_desfazer(r.created_at):
        raise HTTPException(400, "Só dá para desfazer logo depois de registrar (até 15 minutos).")
    session.delete(r)
    session.commit()
    return {"ok": True}
