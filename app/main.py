import io
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from .database import init_db, get_session
from .models import Pedido, FupRegistro, FupRegistroCreate, MOTIVOS_ATRASO_PADRAO
from .importer import importar_planilha, recalcular_status_e_atrasos

app = FastAPI(title="FlowLog (self-hosted)")


@app.on_event("startup")
def on_startup():
    init_db()


# ---------------------------------------------------------------------
# Import de planilhas
# ---------------------------------------------------------------------
@app.post("/api/importar")
async def importar(file: UploadFile = File(...), session: Session = Depends(get_session)):
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Envie um arquivo Excel (.xlsx ou .xls)")
    content = await file.read()
    try:
        resultado = importar_planilha(io.BytesIO(content), session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    recalcular_status_e_atrasos(session)
    return resultado


# ---------------------------------------------------------------------
# Listagem de pedidos com filtros
# ---------------------------------------------------------------------
@app.get("/api/pedidos")
def listar_pedidos(
    aba: str = Query("todos", description="todos | antes_faturar | depois_faturar"),
    tipo_entrega: Optional[str] = Query(None, description="Entrega,Retira,Transportadora (separados por vírgula)"),
    status: Optional[str] = Query(None, description="Bloqueado,Aprovado,Faturado,Encerrado,Cancelado (separados por vírgula)"),
    apenas_atrasados: bool = False,
    data_de: Optional[date] = None,
    data_ate: Optional[date] = None,
    cliente: Optional[str] = None,
    busca: Optional[str] = Query(None, description="busca livre por pedido, OE, NF ou cliente"),
    session: Session = Depends(get_session),
):
    query = select(Pedido)
    pedidos = session.exec(query).all()

    status_list = [s.strip() for s in status.split(",")] if status else None
    tipo_list = [t.strip() for t in tipo_entrega.split(",")] if tipo_entrega else None
    busca_norm = busca.strip().lower() if busca else None

    def bate_filtros(p: Pedido) -> bool:
        if aba == "antes_faturar" and p.status not in ("Bloqueado", "Aprovado"):
            return False
        if aba == "depois_faturar" and p.status not in ("Faturado", "Encerrado"):
            return False
        if tipo_list and p.tipo_entrega not in tipo_list:
            return False
        if status_list and p.status not in status_list:
            return False
        if apenas_atrasados and not (p.atraso_producao or p.atraso_entrega):
            return False
        if data_de and (not p.data_emissao or p.data_emissao < data_de):
            return False
        if data_ate and (not p.data_emissao or p.data_emissao > data_ate):
            return False
        if cliente and (not p.nome_cliente or cliente.lower() not in p.nome_cliente.lower()):
            return False
        if busca_norm:
            campos = [
                p.numero_pedido, p.numero_oe, p.nf, p.nome_cliente, p.cod_cliente,
            ]
            if not any(c and busca_norm in str(c).lower() for c in campos):
                return False
        return True

    resultado = [p for p in pedidos if bate_filtros(p)]
    resultado.sort(key=lambda p: p.data_emissao or date.min, reverse=True)
    return resultado


@app.get("/api/pedidos/{numero_pedido}")
def obter_pedido(numero_pedido: str, session: Session = Depends(get_session)):
    pedido = session.get(Pedido, numero_pedido)
    if not pedido:
        raise HTTPException(404, "Pedido não encontrado")
    fups = session.exec(
        select(FupRegistro)
        .where(FupRegistro.numero_pedido == numero_pedido)
        .order_by(FupRegistro.data_referencia.desc())
    ).all()
    return {"pedido": pedido, "fups": fups}


# ---------------------------------------------------------------------
# Cancelamento manual
# ---------------------------------------------------------------------
@app.post("/api/pedidos/{numero_pedido}/cancelar")
def cancelar_pedido(
    numero_pedido: str,
    motivo: str,
    data_cancelamento: date,
    session: Session = Depends(get_session),
):
    pedido = session.get(Pedido, numero_pedido)
    if not pedido:
        raise HTTPException(404, "Pedido não encontrado")
    pedido.cancelado = True
    pedido.motivo_cancelamento = motivo
    pedido.data_cancelamento = data_cancelamento
    session.add(pedido)
    session.commit()
    recalcular_status_e_atrasos(session)
    return {"ok": True}


# ---------------------------------------------------------------------
# FUP (acompanhamento diário manual)
# ---------------------------------------------------------------------
@app.get("/api/fup/motivos")
def motivos_padrao():
    return MOTIVOS_ATRASO_PADRAO


@app.get("/api/fup")
def listar_fups(session: Session = Depends(get_session)):
    fups = session.exec(select(FupRegistro).order_by(FupRegistro.data_referencia.desc())).all()
    return fups


@app.post("/api/fup")
def criar_fup(dados: FupRegistroCreate, session: Session = Depends(get_session)):
    if not session.get(Pedido, dados.numero_pedido):
        raise HTTPException(404, "Pedido não encontrado")
    fup = FupRegistro(**dados.dict())
    session.add(fup)
    session.commit()
    session.refresh(fup)

    # espelha o motivo mais recente no pedido, para facilitar filtro/exibição
    pedido = session.get(Pedido, fup.numero_pedido)
    pedido.motivo_atraso_fup = fup.motivo_atraso
    session.add(pedido)
    session.commit()
    return fup


# ---------------------------------------------------------------------
# Exportação para Excel
# ---------------------------------------------------------------------
@app.get("/api/exportar")
def exportar_excel(
    aba: str = Query("todos"),
    tipo_entrega: Optional[str] = None,
    status: Optional[str] = None,
    apenas_atrasados: bool = False,
    data_de: Optional[date] = None,
    data_ate: Optional[date] = None,
    cliente: Optional[str] = None,
    busca: Optional[str] = None,
    session: Session = Depends(get_session),
):
    pedidos = listar_pedidos(
        aba=aba, tipo_entrega=tipo_entrega, status=status, apenas_atrasados=apenas_atrasados,
        data_de=data_de, data_ate=data_ate, cliente=cliente, busca=busca, session=session,
    )  # type: ignore
    rows = [p.dict() for p in pedidos]
    df = pd.DataFrame(rows)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Pedidos")
    buffer.seek(0)
    filename = f"flowlog_{aba}_{date.today().isoformat()}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------
# Dashboard — momento atual (foto de agora, sem filtro)
# ---------------------------------------------------------------------
@app.get("/api/dashboard/atual")
def dashboard_atual(session: Session = Depends(get_session)):
    pedidos = session.exec(select(Pedido)).all()

    status_count: dict = {}
    for p in pedidos:
        status_count[p.status or "Indefinido"] = status_count.get(p.status or "Indefinido", 0) + 1

    atraso_por_tipo: dict = {}
    for p in pedidos:
        if p.atraso_producao or p.atraso_entrega:
            k = p.tipo_entrega or "Desconhecido"
            atraso_por_tipo[k] = atraso_por_tipo.get(k, 0) + 1

    atraso_producao_n = sum(1 for p in pedidos if p.atraso_producao)
    atraso_entrega_n = sum(1 for p in pedidos if p.atraso_entrega)

    dias_prod = [p.dias_atraso_producao for p in pedidos if p.atraso_producao]
    dias_ent = [p.dias_atraso_entrega for p in pedidos if p.atraso_entrega]
    media_atraso_producao = round(sum(dias_prod) / len(dias_prod), 1) if dias_prod else 0
    media_atraso_entrega = round(sum(dias_ent) / len(dias_ent), 1) if dias_ent else 0

    atraso_por_cliente: dict = {}
    for p in pedidos:
        if p.atraso_producao or p.atraso_entrega:
            k = p.nome_cliente or "Desconhecido"
            atraso_por_cliente[k] = atraso_por_cliente.get(k, 0) + 1
    top_clientes = sorted(atraso_por_cliente.items(), key=lambda x: x[1], reverse=True)[:8]

    return {
        "status_count": status_count,
        "atraso_por_tipo": atraso_por_tipo,
        "atraso_producao_n": atraso_producao_n,
        "atraso_entrega_n": atraso_entrega_n,
        "media_atraso_producao": media_atraso_producao,
        "media_atraso_entrega": media_atraso_entrega,
        "top_clientes_atraso": top_clientes,
        "total_pedidos": len(pedidos),
    }


# ---------------------------------------------------------------------
# Dashboard — histórico permanente (nunca perde dado, aceita filtro de data)
# ---------------------------------------------------------------------
@app.get("/api/dashboard/historico")
def dashboard_historico(
    data_de: Optional[date] = None,
    data_ate: Optional[date] = None,
    session: Session = Depends(get_session),
):
    fups = session.exec(select(FupRegistro)).all()
    if data_de:
        fups = [f for f in fups if f.data_referencia >= data_de]
    if data_ate:
        fups = [f for f in fups if f.data_referencia <= data_ate]

    motivos_count: dict = {}
    for f in fups:
        if f.motivo_atraso:
            motivos_count[f.motivo_atraso] = motivos_count.get(f.motivo_atraso, 0) + 1
    motivos_ordenados = sorted(motivos_count.items(), key=lambda x: x[1], reverse=True)

    fup_por_data: dict = {}
    for f in fups:
        k = f.data_referencia.isoformat()
        fup_por_data[k] = fup_por_data.get(k, 0) + 1
    fup_timeline = sorted(fup_por_data.items())

    return {
        "motivos_atraso": motivos_ordenados,
        "fup_timeline": fup_timeline,
        "total_fups": len(fups),
    }


# ---------------------------------------------------------------------
# Frontend estático
# ---------------------------------------------------------------------
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")
