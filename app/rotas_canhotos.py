"""v2 (25/11) — Canhotos da pasta do Google Drive: situação e botão
"Sincronizar canhotos" (só com a senha de administrador)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlmodel import Session

from .canhotos_drive import resumo, sincronizar
from .database import engine, get_session
from .rotas_novo import exigir_senha, usuario_atual

router = APIRouter(prefix="/api/v2/canhotos")


@router.get("")
def situacao(session: Session = Depends(get_session)):
    return resumo(session)


@router.post("/sincronizar", dependencies=[Depends(exigir_senha)])
async def sincronizar_agora(por: Optional[str] = Depends(usuario_atual)):
    try:
        return await run_in_threadpool(sincronizar, engine, por or "botão")
    except RuntimeError as e:
        raise HTTPException(409, str(e))
