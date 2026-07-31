import io
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from .database import init_db, get_session
from .models import Pedido, FupRegistro, MOTIVOS_ATRASO_PADRAO
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
    tipo_entrega: Optional[str] = None,
    apenas_atrasados: bool = False,
    data_de: Optional[date] = None,
    data_ate: Optional[date] = None,
    cliente: Optional[str] = None,
    session: Session = Depends(get_session),
):
    query = select(Pedido)
    pedidos = session.exec(query).all()

    def bate_filtros(p: Pedido) -> bool:
        if aba == "antes_faturar" and p.status not in ("Bloqueado", "Aprovado"):
            return False
        if aba == "depois_faturar" and p.status not in ("Faturado", "Encerrado"):
            return False
        if tipo_entrega and p.tipo_entrega != tipo_entrega:
            return False
        if apenas_atrasados and not (p.atraso_producao or p.atraso_entrega):
            return False
        if data_de and (not p.data_emissao or p.data_emissao < data_de):
            return False
        if data_ate and (not p.data_emissao or p.data_emissao > data_ate):
            return False
        if cliente and (not p.nome_cliente or cliente.lower() not in p.nome_cliente.lower()):
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
def criar_fup(fup: FupRegistro, session: Session = Depends(get_session)):
    if not session.get(Pedido, fup.numero_pedido):
        raise HTTPException(404, "Pedido não encontrado")
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
    session: Session = Depends(get_session),
):
    pedidos = listar_pedidos(aba=aba, session=session)  # type: ignore
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
# Frontend estático
# ---------------------------------------------------------------------
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")
