"""
v2 — rotas da tela Pedidos (e do registro de FUP, usado também pela tela FUP).
Prefixo /api/v2. Nada aqui apaga dado: cancelar pedido/NF só marca.
"""
import io
import time
from datetime import date, datetime, timedelta
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from .configuracoes import agora_brasil
from .database import get_session
from .fuso import hoje_brasil
from .models import (
    AtualizacaoPosVenda, AvisoRegistro, CasoPosVenda, FupRegistro, ItemFaturado, NotaFiscalPedido, Pedido, PedidoItem, TransportadoraRegistro,
)
from .rotas_novo import exigir_senha, usuario_atual

from .canhotos_drive import fotos_por_nf  # noqa: E402

router = APIRouter(prefix="/api/v2")

_ultimo_recalculo = 0.0


def recalcular_se_necessario(session: Session, forcar: bool = False) -> None:
    """Atraso e aviso mudam com o dia, mesmo sem importar nada: recalcula
    no máximo uma vez por minuto."""
    global _ultimo_recalculo
    from .importer import recalcular_status_e_atrasos
    if forcar or time.time() - _ultimo_recalculo > 60:
        recalcular_status_e_atrasos(session)
        _ultimo_recalculo = time.time()


def _iso(d) -> Optional[str]:
    return d.isoformat() if d else None


def _nf_json(n: NotaFiscalPedido) -> dict:
    return {"nf": n.nf, "faturamento": _iso(n.data_faturamento), "entrega": _iso(n.data_entrega),
            "canhoto": bool(n.canhoto), "canhoto_drive": (n.canhoto or "").startswith("drive:"), "cancelada": bool(n.cancelada) or bool(n.fora_da_planilha),
            "fora_da_planilha": bool(n.fora_da_planilha), "cancelada_motivo": n.cancelada_motivo if n.cancelada else ("não está mais na planilha da expedição" if n.fora_da_planilha else None),
            "cancelada_por": n.cancelada_por}


def _situacao_fup(f: Optional[FupRegistro]) -> Optional[dict]:
    if not f:
        return None
    return {"data": _iso(f.data_referencia), "situacao": f.situacao or "atraso", "motivo": f.motivo_atraso,
            "observacao": f.observacao, "por": f.registrado_por}


def listar_pedidos_v2(session: Session, numeros: Optional[set] = None) -> list:
    recalcular_se_necessario(session)
    pedidos = session.exec(select(Pedido)).all()
    if numeros is not None:
        pedidos = [p for p in pedidos if p.numero_pedido in numeros]
    nfs: dict = {}
    for n in session.exec(select(NotaFiscalPedido).order_by(NotaFiscalPedido.data_faturamento, NotaFiscalPedido.id)).all():
        nfs.setdefault(n.numero_pedido, []).append(n)
    itens_qtd: dict = {}
    na_carteira: dict = {}
    for numero, na in session.exec(select(PedidoItem.numero_pedido, PedidoItem.na_carteira)).all():
        itens_qtd[numero] = itens_qtd.get(numero, 0) + 1
        if na:
            na_carteira[numero] = na_carteira.get(numero, 0) + 1
    pv_aberto = set(session.exec(select(CasoPosVenda.numero_pedido).where(
        CasoPosVenda.apagado_em == None, CasoPosVenda.status.in_(["Encontrar solução", "Em andamento"]))).all())  # noqa: E711
    ultimos_fup: dict = {}
    for f in session.exec(select(FupRegistro).order_by(FupRegistro.data_referencia, FupRegistro.id)).all():
        ultimos_fup[f.numero_pedido] = f
    saida = []
    for p in pedidos:
        lista_nf = nfs.get(p.numero_pedido, [])
        entregas = [n.data_entrega for n in lista_nf if n.data_entrega and not n.cancelada]
        entrega_efetiva = max(entregas) if entregas else p.data_entrega_real
        saida.append({
            "pedido": p.numero_pedido, "cliente": p.nome_cliente, "cod_cliente": p.cod_cliente,
            "emissao": _iso(p.data_emissao), "prometida": _iso(p.data_entrega_prevista),
            "nova_data": _iso(p.nova_data_entrega), "nova_data_quem": p.nova_data_quem,
            "aguardando": ({"desde": _iso(p.aguardando_cliente_desde), "motivo": p.aguardando_cliente_motivo, "por": p.aguardando_cliente_por}
                           if p.aguardando_cliente_desde else None),
            "entrega_efetiva": _iso(entrega_efetiva), "tipo": p.tipo_entrega or "Desconhecido",
            "status": p.status, "situacao_erp": p.situacao_erp,
            "atrasado": bool(p.atraso_producao), "dias_atraso": p.dias_atraso_producao or 0,
            "aviso": bool(p.aviso_entrega), "dias_sem_canhoto": p.dias_uteis_desde_faturamento or 0,
            "oe": p.numero_oe, "nfs": [_nf_json(n) for n in lista_nf],
            "motivo_fup": p.motivo_atraso_fup, "fup": _situacao_fup(ultimos_fup.get(p.numero_pedido)),
            "vendedor": p.vendedor, "transportadora": p.transportadora_nome, "uf": p.uf, "municipio": p.municipio,
            "itens": itens_qtd.get(p.numero_pedido, 0), "itens_na_carteira": na_carteira.get(p.numero_pedido, 0),
            "cancelado": bool(p.cancelado), "motivo_cancelamento": p.motivo_cancelamento,
            "posvenda_aberto": p.numero_pedido in pv_aberto,
        })
    saida.sort(key=lambda x: (x["emissao"] or "", x["pedido"]), reverse=True)
    return saida


@router.get("/pedidos")
def listar(session: Session = Depends(get_session)):
    return {"hoje": hoje_brasil().isoformat(), "pedidos": listar_pedidos_v2(session)}


@router.get("/pedidos/{numero}")
def detalhe(numero: str, session: Session = Depends(get_session)):
    p = session.get(Pedido, numero)
    if not p:
        raise HTTPException(404, "Pedido não encontrado.")
    itens = session.exec(select(PedidoItem).where(PedidoItem.numero_pedido == numero).order_by(PedidoItem.linha, PedidoItem.id)).all()
    nfs = session.exec(select(NotaFiscalPedido).where(NotaFiscalPedido.numero_pedido == numero).order_by(NotaFiscalPedido.data_faturamento, NotaFiscalPedido.id)).all()
    fups = session.exec(select(FupRegistro).where(FupRegistro.numero_pedido == numero).order_by(FupRegistro.data_referencia.desc(), FupRegistro.id.desc())).all()
    transp = session.exec(select(TransportadoraRegistro).where(TransportadoraRegistro.numero_pedido == numero).order_by(TransportadoraRegistro.data_registro.desc(), TransportadoraRegistro.id.desc())).all()
    avisos = session.exec(select(AvisoRegistro).where(AvisoRegistro.numero_pedido == numero).order_by(AvisoRegistro.data_registro.desc(), AvisoRegistro.id.desc())).all()
    casos = session.exec(select(CasoPosVenda).where(CasoPosVenda.numero_pedido == numero, CasoPosVenda.apagado_em == None)  # noqa: E711
                         .order_by(CasoPosVenda.id.desc())).all()
    ultima_at = {}
    if casos:
        for a in session.exec(select(AtualizacaoPosVenda).where(AtualizacaoPosVenda.caso_id.in_([c.id for c in casos]),
                                                                 AtualizacaoPosVenda.desfeita_em == None)  # noqa: E711
                              .order_by(AtualizacaoPosVenda.data, AtualizacaoPosVenda.id)).all():
            ultima_at[a.caso_id] = a
    numeros_nf = [n.nf for n in nfs]
    faturados = session.exec(select(ItemFaturado).where(ItemFaturado.nf.in_(numeros_nf)).order_by(ItemFaturado.nf, ItemFaturado.seq)).all() if numeros_nf else []
    linha = listar_pedidos_v2(session, {numero})
    fotos = fotos_por_nf(session, numeros_nf)  # canhotos na pasta do Google Drive (só o link)
    return {
        "linha": linha[0] if linha else None,
        "pedido": numero, "vendedor": p.vendedor, "transportadora": p.transportadora_nome,
        "nova_data": _iso(p.nova_data_entrega), "nova_data_quem": p.nova_data_quem, "nova_data_motivo": p.nova_data_motivo,
        "nova_data_por": p.nova_data_por, "cancelado_por": p.cancelado_por,
        "data_cancelamento": _iso(p.data_cancelamento), "motivo_cancelamento": p.motivo_cancelamento,
        "itens": [{"codigo": i.codigo_item, "alternativo": i.alternativo, "descricao": i.descricao, "quantidade": i.quantidade,
                   "unidade": i.unidade, "entrega": _iso(i.data_entrega), "situacao": i.situacao_item,
                   "na_carteira": i.na_carteira is not False} for i in itens],
        "nfs": [dict(_nf_json(n), fotos=fotos.get(n.nf, [])) for n in nfs],
        "uf": p.uf, "municipio": p.municipio,
        "itens_faturados": [{"nf": i.nf, "seq": i.seq, "emissao": _iso(i.data_emissao), "codigo": i.codigo_item,
                             "alternativo": i.alternativo, "descricao": i.descricao, "quantidade": i.quantidade,
                             "unidade": i.unidade} for i in faturados],
        "fups": [_situacao_fup(f) | {"id": f.id} for f in fups],
        "posvenda": [{"numero": c.numero, "aberto_em": _iso(c.aberto_em), "problema": c.problema, "status": c.status,
                      "responsavel": c.responsavel, "prazo": _iso(c.prazo_solucao), "nf": c.nf, "solucao": c.solucao,
                      "ultima": ({"data": _iso(ultima_at[c.id].data), "por": ultima_at[c.id].por, "texto": ultima_at[c.id].texto}
                                 if c.id in ultima_at else None)} for c in casos],
        "transportadora_registros": [{"data": _iso(t.data_registro), "chamado": t.chamado, "quem": t.quem_chamou,
                                       "observacao": t.observacao} for t in transp],
        "avisos_registros": [{"data": _iso(a.data_registro), "texto": a.motivo, "proxima": _iso(a.proxima_data_limite)} for a in avisos],
    }


class Aguardando(BaseModel):
    motivo: str


@router.post("/pedidos/{numero}/aguardando")
def marcar_aguardando(numero: str, dados: Aguardando, session: Session = Depends(get_session),
                      por: Optional[str] = Depends(usuario_atual)):
    """Pedido pronto que depende do cliente (ex.: Retira sem agendamento): sai dos atrasados."""
    from .importer import recalcular_status_e_atrasos
    p = session.get(Pedido, numero)
    if not p:
        raise HTTPException(404, "Pedido não encontrado.")
    motivo = (dados.motivo or "").strip()
    if not motivo:
        raise HTTPException(400, "Escreva o motivo.")
    p.aguardando_cliente_desde = hoje_brasil()
    p.aguardando_cliente_motivo = motivo[:300]
    p.aguardando_cliente_por = por
    session.add(p)
    session.commit()
    recalcular_status_e_atrasos(session)
    session.commit()
    return {"ok": True}


@router.delete("/pedidos/{numero}/aguardando")
def tirar_aguardando(numero: str, session: Session = Depends(get_session)):
    from .importer import recalcular_status_e_atrasos
    p = session.get(Pedido, numero)
    if not p:
        raise HTTPException(404, "Pedido não encontrado.")
    p.aguardando_cliente_desde = None
    p.aguardando_cliente_motivo = None
    p.aguardando_cliente_por = None
    session.add(p)
    session.commit()
    recalcular_status_e_atrasos(session)
    session.commit()
    return {"ok": True}


class NovaData(BaseModel):
    data: Optional[date] = None   # vazio = volta ao prazo original
    quem: Optional[str] = None    # "Cliente" | "MUBEC"
    motivo: Optional[str] = None


@router.put("/pedidos/{numero}/nova-data")
def nova_data(numero: str, dados: NovaData, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    p = session.get(Pedido, numero)
    if not p:
        raise HTTPException(404, "Pedido não encontrado.")
    if dados.data and dados.quem not in ("Cliente", "MUBEC"):
        raise HTTPException(400, "Diga quem pediu a mudança: Cliente ou MUBEC.")
    antes = {"data": _iso(p.nova_data_entrega), "quem": p.nova_data_quem, "motivo": p.nova_data_motivo}
    p.nova_data_entrega = dados.data
    p.nova_data_quem = dados.quem if dados.data else None
    p.nova_data_motivo = ((dados.motivo or "").strip()[:200] or None) if dados.data else None
    p.nova_data_por = por if dados.data else None
    session.add(p)
    session.commit()
    return {"ok": True, "antes": antes}


class Cancelamento(BaseModel):
    motivo: str
    data: Optional[date] = None


@router.post("/pedidos/{numero}/cancelar")
def cancelar(numero: str, dados: Cancelamento, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    p = session.get(Pedido, numero)
    if not p:
        raise HTTPException(404, "Pedido não encontrado.")
    motivo = (dados.motivo or "").strip()
    if not motivo:
        raise HTTPException(400, "O motivo do cancelamento é obrigatório.")
    if p.cancelado:
        raise HTTPException(400, "Este pedido já está cancelado.")
    p.cancelado = True
    p.motivo_cancelamento = motivo[:300]
    p.data_cancelamento = dados.data or hoje_brasil()
    p.cancelado_por = por
    session.add(p)
    session.commit()
    recalcular_se_necessario(session, forcar=True)
    return {"ok": True}


@router.post("/pedidos/{numero}/descancelar", dependencies=[Depends(exigir_senha)])
def descancelar(numero: str, session: Session = Depends(get_session)):
    """Volta um pedido cancelado por engano (pede a senha de administrador).
    O motivo antigo fica registrado no texto, para não perder a história."""
    p = session.get(Pedido, numero)
    if not p:
        raise HTTPException(404, "Pedido não encontrado.")
    if not p.cancelado:
        raise HTTPException(400, "Este pedido não está cancelado à mão.")
    p.cancelado = False
    p.motivo_cancelamento = None
    p.data_cancelamento = None
    p.cancelado_por = None
    session.add(p)
    session.commit()
    recalcular_se_necessario(session, forcar=True)
    return {"ok": True}


class NfCancelada(BaseModel):
    cancelada: bool
    motivo: Optional[str] = None


@router.post("/pedidos/{numero}/nfs/{nf}/cancelada")
def marcar_nf_cancelada(numero: str, nf: str, dados: NfCancelada, session: Session = Depends(get_session),
                        por: Optional[str] = Depends(usuario_atual)):
    """Marca (ou desmarca) uma NF como cancelada. Ela continua aparecendo,
    riscada, e deixa de contar para status e aviso de canhoto."""
    nota = session.exec(select(NotaFiscalPedido).where(NotaFiscalPedido.numero_pedido == numero, NotaFiscalPedido.nf == nf)).first()
    if not nota:
        raise HTTPException(404, "NF não encontrada neste pedido.")
    if dados.cancelada and not (dados.motivo or "").strip():
        raise HTTPException(400, "Diga por que a NF foi cancelada.")
    nota.cancelada = dados.cancelada
    nota.cancelada_motivo = (dados.motivo or "").strip()[:200] if dados.cancelada else None
    nota.cancelada_em = agora_brasil() if dados.cancelada else None
    nota.cancelada_por = por if dados.cancelada else None
    session.add(nota)
    session.commit()
    recalcular_se_necessario(session, forcar=True)
    return {"ok": True}


# ---------------------------------------------------------------------
# FUP (um ou vários pedidos de uma vez)
# ---------------------------------------------------------------------
class FupItem(BaseModel):
    pedido: str
    situacao: str               # "ok" | "previsto_atraso" | "atraso"
    motivo: Optional[str] = None
    observacao: Optional[str] = None


class FupLote(BaseModel):
    data: Optional[date] = None
    itens: List[FupItem]


@router.post("/fup")
def registrar_fups(dados: FupLote, session: Session = Depends(get_session), por: Optional[str] = Depends(usuario_atual)):
    from .main import _texto_situacao_exibicao  # import tardio: evita import circular
    if not dados.itens:
        raise HTTPException(400, "Nenhum pedido para registrar.")
    erros = []
    for it in dados.itens:
        if not session.get(Pedido, it.pedido):
            erros.append(f"{it.pedido}: pedido não encontrado")
        elif it.situacao not in ("ok", "previsto_atraso", "atraso"):
            erros.append(f"{it.pedido}: situação inválida")
        elif it.situacao != "ok" and not (it.motivo or "").strip():
            erros.append(f"{it.pedido}: o motivo é obrigatório quando não é Ok")
        elif it.situacao != "ok" and it.motivo == "Outro" and not (it.observacao or "").strip():
            erros.append(f"{it.pedido}: com motivo \"Outro\" a observação é obrigatória")
    if erros:
        raise HTTPException(400, "; ".join(erros))
    data = dados.data or hoje_brasil()
    criados = []
    for it in dados.itens:
        motivo = None if it.situacao == "ok" else it.motivo.strip()
        obs = (it.observacao or "").strip() or None
        f = FupRegistro(numero_pedido=it.pedido, data_referencia=data, situacao=it.situacao, motivo_atraso=motivo,
                        observacao=obs, registrado_por=por)
        session.add(f)
        p = session.get(Pedido, it.pedido)
        p.motivo_atraso_fup = _texto_situacao_exibicao(it.situacao, motivo, obs)
        session.add(p)
        session.flush()
        criados.append(f.id)
    session.commit()
    return {"ok": True, "ids": criados}


@router.get("/fup")
def tela_fup(session: Session = Depends(get_session)):
    """Pedidos em produção (Bloqueado/Aprovado) com prazo e último FUP, quais
    estão "Para revisar" e o histórico de FUPs."""
    from .configuracoes import datas_feriados, ler_prazos
    from .importer import _dias_uteis_entre
    recalcular_se_necessario(session)
    hoje = hoje_brasil()
    janela = ler_prazos(session)["fup_janela"]
    feriados = datas_feriados(session)
    pedidos = session.exec(select(Pedido).where(Pedido.status.in_(["Bloqueado", "Aprovado"]))).all()
    todos_fups = session.exec(select(FupRegistro).order_by(FupRegistro.data_referencia, FupRegistro.id)).all()
    ultimos: dict = {}
    for f in todos_fups:
        ultimos[f.numero_pedido] = f
    lista = []
    for p in pedidos:
        if p.aguardando_cliente_desde:
            prazo = {"tipo": "aguardando", "n": None}  # pronto, depende do cliente: não entra em "Para revisar"
        elif p.atraso_producao:
            prazo = {"tipo": "atraso", "n": p.dias_atraso_producao or 0}
        elif p.data_entrega_prevista:
            prazo = {"tipo": "vence", "n": _dias_uteis_entre(hoje, p.data_entrega_prevista, feriados)}
        else:
            prazo = {"tipo": "sem_data", "n": None}
        ult = ultimos.get(p.numero_pedido)
        urgente = prazo["tipo"] == "atraso" or (prazo["tipo"] == "vence" and prazo["n"] <= janela)
        lista.append({
            "pedido": p.numero_pedido, "emissao": _iso(p.data_emissao), "cliente": p.nome_cliente, "status": p.status,
            "vendedor": p.vendedor, "tipo": p.tipo_entrega, "prometida": _iso(p.data_entrega_prevista),
            "nova_data": _iso(p.nova_data_entrega), "prazo": prazo, "atrasado": bool(p.atraso_producao),
            "dias_atraso": p.dias_atraso_producao or 0,
            "aguardando": p.aguardando_cliente_motivo if p.aguardando_cliente_desde else None,
            "uf": p.uf, "transportadora": p.transportadora_nome, "oe": p.numero_oe,
            "fup": _situacao_fup(ult),
            "dias_desde_fup": _dias_uteis_entre(ult.data_referencia, hoje, feriados) if ult else None,
            "revisar": urgente and not (ult and ult.data_referencia == hoje),
        })
    lista.sort(key=lambda x: (0 if x["prazo"]["tipo"] == "atraso" else 1, -(x["prazo"]["n"] or 0) if x["prazo"]["tipo"] == "atraso" else (x["prazo"]["n"] if x["prazo"]["n"] is not None else 9999)))
    clientes = {p.numero_pedido: p.nome_cliente for p in session.exec(select(Pedido)).all()}
    historico = [{"id": f.id, "data": _iso(f.data_referencia), "pedido": f.numero_pedido, "cliente": clientes.get(f.numero_pedido),
                  "situacao": f.situacao or "atraso", "motivo": f.motivo_atraso, "observacao": f.observacao, "por": f.registrado_por}
                 for f in reversed(todos_fups[-1000:])]
    return {"hoje": hoje.isoformat(), "janela": janela, "pedidos": lista, "historico": historico}


@router.delete("/fup/{fup_id}")
def desfazer_fup(fup_id: int, session: Session = Depends(get_session)):
    """Usado pelo botão Desfazer logo depois de registrar."""
    from .main import _recalcular_motivo_espelhado
    f = session.get(FupRegistro, fup_id)
    if not f:
        raise HTTPException(404, "FUP não encontrado.")
    # só o que acabou de ser registrado (botão Desfazer); FUP antigo nunca é apagado por aqui
    if not f.created_at or datetime.utcnow() - f.created_at > timedelta(minutes=15):
        raise HTTPException(400, "Só dá para desfazer logo depois de registrar (até 15 minutos).")
    numero = f.numero_pedido
    session.delete(f)
    session.commit()
    _recalcular_motivo_espelhado(numero, session)
    return {"ok": True}


# ---------------------------------------------------------------------
# Exportar Excel — mesmas colunas do 1.0 (a importação de FUP em lote lê
# de volta "Situação FUP", "FUP" e "Nova Data de Entrega")
# ---------------------------------------------------------------------
class Exportar(BaseModel):
    pedidos: List[str]
    nome: Optional[str] = "pedidos"


@router.post("/pedidos/exportar")
def exportar(dados: Exportar, session: Session = Depends(get_session)):
    from .main import _texto_situacao_excel
    numeros = list(dict.fromkeys(dados.pedidos))
    if not numeros:
        raise HTTPException(400, "Nenhum pedido para exportar.")
    pedidos = {p.numero_pedido: p for p in session.exec(select(Pedido).where(Pedido.numero_pedido.in_(numeros))).all()}
    fups: dict = {}
    for f in session.exec(select(FupRegistro).where(FupRegistro.numero_pedido.in_(numeros))
                          .order_by(FupRegistro.data_referencia, FupRegistro.id)).all():
        fups.setdefault(f.numero_pedido, []).append(f)
    nfs: dict = {}
    for n in session.exec(select(NotaFiscalPedido).where(NotaFiscalPedido.numero_pedido.in_(numeros))).all():
        nfs.setdefault(n.numero_pedido, []).append(n.nf + (" (cancelada)" if n.cancelada else ""))
    max_fups = max((len(v) for v in fups.values()), default=0)
    fmt = lambda d: d.strftime("%d/%m/%Y") if d else ""  # noqa: E731
    linhas = []
    for numero in numeros:
        p = pedidos.get(numero)
        if not p:
            continue
        linha = {
            "Número do Pedido": p.numero_pedido, "Cliente": p.nome_cliente, "Vendedor": p.vendedor or "", "Estado": p.uf or "",
            "Data de Emissão": fmt(p.data_emissao),
            "Data de Entrega Original": fmt(p.data_entrega_prevista), "Nova Data de Entrega": fmt(p.nova_data_entrega),
            "Data Efetiva de Entrega": fmt(p.data_entrega_real), "OE": p.numero_oe, "NF": ", ".join(nfs.get(numero, [])),
            "Status": p.status, "Tipo": p.tipo_entrega, "Dias de atraso": p.dias_atraso_producao or 0,
        }
        lista = fups.get(numero, [])
        for i in range(max_fups):
            linha[f"FUP {i + 1}"] = _texto_situacao_excel(lista[i].situacao, lista[i].motivo_atraso, lista[i].observacao) if i < len(lista) else ""
        linha["Situação FUP"] = ""
        linha["FUP"] = ""
        linhas.append(linha)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        pd.DataFrame(linhas).to_excel(writer, index=False, sheet_name="Pedidos")
    buffer.seek(0)
    nome = "".join(c for c in (dados.nome or "pedidos") if c.isalnum() or c in "-_") or "pedidos"
    return StreamingResponse(buffer, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="flowlog_{nome}_{hoje_brasil().isoformat()}.xlsx"'})
