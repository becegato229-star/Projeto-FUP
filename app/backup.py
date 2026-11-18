"""Backup protegido por senha (passo 1 do lançamento da v2).

Só LÊ os dados: faz uma cópia consistente do banco + os PDFs guardados e
entrega um .zip. Nada no sistema muda ao baixar.

Como o FlowLog não tem login, o backup pede uma senha de administrador
(guardada só como hash PBKDF2 com sal, nunca a senha em si). Quem abrir o
backup pela primeira vez define a senha. É o MESMO formato da v2: a senha
criada aqui continua valendo quando a v2 subir.

As duas tabelas novas (configuracao e backupregistro) são idênticas às da v2.
"""
import hashlib
import hmac
import os
import shutil
import sqlite3
import tempfile
import time
import zipfile
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Field, Session, SQLModel
from starlette.background import BackgroundTask

from .database import DB_PATH, get_session

router = APIRouter()

PASTA_PDFS = os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "pdfs")
_CHAVE_SENHA = "senha_admin"
_ITERACOES = 200_000
_TENTATIVAS = {"erros": 0, "bloqueado_ate": 0.0}  # 5 erros seguidos -> espera 1 minuto


class Configuracao(SQLModel, table=True):
    """Pares chave/valor: prazos editáveis e o hash da senha de
    administrador. Valor ausente = usa o padrão do código."""
    chave: str = Field(primary_key=True)
    valor: Optional[str] = None
    atualizado_em: datetime = Field(default_factory=datetime.utcnow)
    atualizado_por: Optional[str] = None


class BackupRegistro(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    quando: datetime = Field(default_factory=datetime.utcnow)
    por: Optional[str] = None
    arquivo: Optional[str] = None
    tamanho_bytes: Optional[int] = None


def _agora_brasil() -> datetime:
    from datetime import timezone, timedelta
    return datetime.now(timezone(timedelta(hours=-3))).replace(tzinfo=None)


def _hash(senha: str, sal: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), sal, _ITERACOES).hex()


def _senha_definida(session: Session) -> bool:
    cfg = session.get(Configuracao, _CHAVE_SENHA)
    return bool(cfg and cfg.valor)


def _conferir(session: Session, senha: str) -> bool:
    agora = time.time()
    if agora < _TENTATIVAS["bloqueado_ate"]:
        raise HTTPException(429, "Muitas tentativas de senha errada. Espere 1 minuto e tente de novo.")
    cfg = session.get(Configuracao, _CHAVE_SENHA)
    certa = False
    if cfg and cfg.valor and senha:
        try:
            sal_hex, hash_hex = cfg.valor.split("$", 1)
            certa = hmac.compare_digest(_hash(senha, bytes.fromhex(sal_hex)), hash_hex)
        except ValueError:
            certa = False
    if certa:
        _TENTATIVAS["erros"] = 0
    elif senha:
        _TENTATIVAS["erros"] += 1
        if _TENTATIVAS["erros"] >= 5:
            _TENTATIVAS["erros"] = 0
            _TENTATIVAS["bloqueado_ate"] = agora + 60
    return certa


@router.get("/api/backup/senha")
def backup_senha_definida(session: Session = Depends(get_session)):
    return {"definida": _senha_definida(session)}


@router.post("/api/backup/senha")
def backup_definir_senha(nova: str = Form(""), atual: str = Form(""), session: Session = Depends(get_session)):
    """Primeira vez: define a senha. Depois: só troca quem sabe a atual."""
    if _senha_definida(session) and not _conferir(session, atual):
        raise HTTPException(401, "Senha atual errada.")
    if len(nova or "") < 8:
        raise HTTPException(400, "A senha precisa ter pelo menos 8 caracteres.")
    sal = os.urandom(16)
    cfg = session.get(Configuracao, _CHAVE_SENHA) or Configuracao(chave=_CHAVE_SENHA)
    cfg.valor = sal.hex() + "$" + _hash(nova, sal)
    cfg.atualizado_em = _agora_brasil()
    session.add(cfg)
    session.commit()
    return {"ok": True}


def _apagar_pasta(pasta: str) -> None:
    shutil.rmtree(pasta, ignore_errors=True)


@router.post("/api/backup")
def baixar_backup(senha: str = Form(""), session: Session = Depends(get_session)):
    if not _senha_definida(session):
        raise HTTPException(403, "Defina a senha de administrador primeiro.")
    if not _conferir(session, senha):
        raise HTTPException(401, "Senha errada. Nada foi baixado.")
    pasta_tmp = tempfile.mkdtemp(prefix="flowlog_backup_")  # fora do volume /data
    try:
        copia = os.path.join(pasta_tmp, "flowlog.db")
        origem = sqlite3.connect(f"file:{os.path.abspath(DB_PATH)}?mode=ro", uri=True, timeout=30)  # só leitura
        destino = sqlite3.connect(copia)
        try:
            origem.backup(destino)
        finally:
            destino.close()
            origem.close()
        nome_zip = f"flowlog_backup_{_agora_brasil().strftime('%Y-%m-%d_%H%M')}.zip"
        caminho_zip = os.path.join(pasta_tmp, nome_zip)
        with zipfile.ZipFile(caminho_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(copia, "flowlog.db")
            if os.path.isdir(PASTA_PDFS):
                for raiz, pastas, arquivos in os.walk(PASTA_PDFS):
                    pastas[:] = [p for p in pastas if not (raiz == PASTA_PDFS and p == "tmp")]
                    for arquivo in arquivos:
                        completo = os.path.join(raiz, arquivo)
                        zf.write(completo, os.path.join("pdfs", os.path.relpath(completo, PASTA_PDFS)))
        os.remove(copia)
    except Exception:
        _apagar_pasta(pasta_tmp)
        raise
    try:
        session.add(BackupRegistro(quando=_agora_brasil(), arquivo=nome_zip, tamanho_bytes=os.path.getsize(caminho_zip)))
        session.commit()
    except Exception:
        session.rollback()  # o histórico nunca impede o backup
    return FileResponse(caminho_zip, media_type="application/zip", filename=nome_zip,
                        background=BackgroundTask(_apagar_pasta, pasta_tmp))
