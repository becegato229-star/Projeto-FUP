"""
v2 — rotas da tela nova (/novo). Prefixo /api/v2.

Regras de segurança dos dados:
- Nada aqui apaga dado importado do ERP nem registro feito por alguém,
  exceto feriados e opções de lista nunca usadas (que têm "Desfazer").
- Mudanças nas Configurações e o backup pedem a senha de administrador.
- Importar planilhas NÃO pede senha (o n8n e a Silvia importam todo dia).
"""
import json
from datetime import date
from typing import List, Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, func, select

from .configuracoes import (
    LISTAS, PRAZOS_PADRAO, agora_brasil, conferir_senha, definir_senha, ler_prazos,
    salvar_prazos, senha_definida,
)
from .database import get_session
from .models import (
    BackupRegistro, Feriado, FupRegistro, ImportacaoRegistro, MotivoFup, OpcaoLista,
    TransportadoraRegistro,
)

router = APIRouter(prefix="/api/v2")


# ---------------------------------------------------------------------
# Quem está usando (sem login: nome escolhido na própria tela) e senha
# ---------------------------------------------------------------------
def usuario_atual(x_usuario: Optional[str] = Header(default=None)) -> Optional[str]:
    if not x_usuario:
        return None
    nome = unquote(x_usuario).strip()
    return nome[:40] or None


def exigir_senha(
    x_senha: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> None:
    if not senha_definida(session):
        raise HTTPException(403, "Defina a senha de administrador primeiro (Configurações › Backup).")
    if not conferir_senha(session, unquote(x_senha) if x_senha else None):
        raise HTTPException(401, "Senha errada.")


class SenhaNova(BaseModel):
    nova: str
    atual: Optional[str] = None


class SenhaConferir(BaseModel):
    senha: str


@router.get("/senha")
def status_senha(session: Session = Depends(get_session)):
    return {"definida": senha_definida(session)}


@router.post("/senha")
def criar_ou_trocar_senha(dados: SenhaNova, session: Session = Depends(get_session),
                          por: Optional[str] = Depends(usuario_atual)):
    if senha_definida(session) and not conferir_senha(session, dados.atual):
        raise HTTPException(401, "A senha atual está errada.")
    try:
        definir_senha(session, dados.nova, por)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/senha/conferir")
def conferir(dados: SenhaConferir, session: Session = Depends(get_session)):
    return {"ok": conferir_senha(session, dados.senha), "definida": senha_definida(session)}


@router.get("/contagens")
def contagens_menu(session: Session = Depends(get_session)):
    """Números ao lado de cada item do menu (preenchidos conforme as telas ficam prontas)."""
    from .contagens import contar_menu
    return contar_menu(session)


# ---------------------------------------------------------------------
# Prazos
# ---------------------------------------------------------------------
@router.get("/prazos")
def obter_prazos(session: Session = Depends(get_session)):
    return {"prazos": ler_prazos(session), "padrao": PRAZOS_PADRAO}


@router.put("/prazos", dependencies=[Depends(exigir_senha)])
def mudar_prazos(novos: dict, session: Session = Depends(get_session),
                 por: Optional[str] = Depends(usuario_atual)):
    try:
        prazos = salvar_prazos(session, novos, por)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _recalcular_agora(session)
    return {"prazos": prazos}


def _recalcular_agora(session: Session) -> None:
    # importa aqui para não criar import circular com main/importer
    from .importer import recalcular_status_e_atrasos
    recalcular_status_e_atrasos(session)


# ---------------------------------------------------------------------
# Feriados
# ---------------------------------------------------------------------
class FeriadoNovo(BaseModel):
    data: date
    nome: str
    abrangencia: Optional[str] = None


def _feriado_json(f: Feriado) -> dict:
    return {"id": f.id, "data": f.data.isoformat(), "nome": f.nome, "abrangencia": f.abrangencia,
            "criado_por": f.criado_por}


@router.get("/feriados")
def listar_feriados(session: Session = Depends(get_session)):
    feriados = session.exec(select(Feriado).order_by(Feriado.data)).all()
    return [_feriado_json(f) for f in feriados]


@router.post("/feriados", dependencies=[Depends(exigir_senha)])
def criar_feriado(dados: FeriadoNovo, session: Session = Depends(get_session),
                  por: Optional[str] = Depends(usuario_atual)):
    nome = (dados.nome or "").strip()
    if not nome:
        raise HTTPException(400, "Dê um nome ao feriado.")
    if session.exec(select(Feriado).where(Feriado.data == dados.data)).first():
        raise HTTPException(400, "Já existe um feriado nessa data.")
    f = Feriado(data=dados.data, nome=nome[:80], abrangencia=(dados.abrangencia or "Ponte / recesso da MUBEC")[:60],
                criado_em=agora_brasil(), criado_por=por)
    session.add(f)
    session.commit()
    session.refresh(f)
    _recalcular_agora(session)
    return _feriado_json(f)


@router.delete("/feriados/{feriado_id}", dependencies=[Depends(exigir_senha)])
def apagar_feriado(feriado_id: int, session: Session = Depends(get_session)):
    f = session.get(Feriado, feriado_id)
    if not f:
        raise HTTPException(404, "Feriado não encontrado.")
    copia = _feriado_json(f)
    session.delete(f)
    session.commit()
    _recalcular_agora(session)
    return {"ok": True, "apagado": copia}


# ---------------------------------------------------------------------
# Listas
# ---------------------------------------------------------------------
def _usos_motivos(session: Session) -> dict:
    linhas = session.exec(
        select(FupRegistro.motivo_atraso, func.count()).group_by(FupRegistro.motivo_atraso)
    ).all()
    return {m: n for m, n in linhas if m}


def _usos_quemchama(session: Session) -> dict:
    linhas = session.exec(
        select(TransportadoraRegistro.quem_chamou, func.count()).group_by(TransportadoraRegistro.quem_chamou)
    ).all()
    return {m: n for m, n in linhas if m}


def _itens_lista(lista: str, session: Session) -> list:
    if lista == "motivos":
        usos = _usos_motivos(session)
        motivos = session.exec(select(MotivoFup).order_by(MotivoFup.id)).all()
        return [{"id": m.id, "texto": m.texto, "uso": usos.get(m.texto, 0),
                 "ativo": m.ativo is not False, "fixo": m.texto == "Outro"} for m in motivos]
    usos = _usos_quemchama(session) if lista == "quemchama" else {}
    opcoes = session.exec(
        select(OpcaoLista).where(OpcaoLista.lista == lista).order_by(OpcaoLista.ordem, OpcaoLista.id)
    ).all()
    return [{"id": o.id, "texto": o.texto, "uso": usos.get(o.texto, 0),
             "ativo": o.ativo is not False, "fixo": bool(o.fixo)} for o in opcoes]


def _checar_lista(lista: str) -> None:
    if lista not in LISTAS:
        raise HTTPException(404, "Lista não encontrada.")


@router.get("/listas")
def listar_listas(session: Session = Depends(get_session)):
    return [{"id": k, **v, "itens": _itens_lista(k, session)} for k, v in LISTAS.items()]


@router.get("/listas/{lista}/ativas")
def opcoes_ativas(lista: str, session: Session = Depends(get_session)):
    """Só as opções que aparecem nos formulários."""
    _checar_lista(lista)
    return [i["texto"] for i in _itens_lista(lista, session) if i["ativo"]]


class OpcaoNova(BaseModel):
    texto: str


class OpcaoMudar(BaseModel):
    ativo: bool


@router.post("/listas/{lista}", dependencies=[Depends(exigir_senha)])
def adicionar_opcao(lista: str, dados: OpcaoNova, session: Session = Depends(get_session)):
    _checar_lista(lista)
    texto = (dados.texto or "").strip()[:80]
    if not texto:
        raise HTTPException(400, "Escreva a nova opção.")
    if any(i["texto"].lower() == texto.lower() for i in _itens_lista(lista, session)):
        raise HTTPException(400, "Essa opção já existe nesta lista.")
    if lista == "motivos":
        session.add(MotivoFup(texto=texto, ativo=True))
    else:
        maior = session.exec(select(func.max(OpcaoLista.ordem)).where(OpcaoLista.lista == lista)).one() or 0
        session.add(OpcaoLista(lista=lista, texto=texto, ordem=maior + 1, ativo=True, fixo=False))
    session.commit()
    return {"ok": True}


def _achar_opcao(lista: str, item_id: int, session: Session):
    obj = session.get(MotivoFup, item_id) if lista == "motivos" else session.get(OpcaoLista, item_id)
    if not obj or (lista != "motivos" and obj.lista != lista):
        raise HTTPException(404, "Opção não encontrada.")
    return obj


@router.put("/listas/{lista}/{item_id}", dependencies=[Depends(exigir_senha)])
def ativar_desativar(lista: str, item_id: int, dados: OpcaoMudar, session: Session = Depends(get_session)):
    _checar_lista(lista)
    obj = _achar_opcao(lista, item_id, session)
    if obj.texto == "Outro" or getattr(obj, "fixo", False):
        raise HTTPException(400, "\"Outro\" é fixo e não pode ser desativado.")
    obj.ativo = dados.ativo
    session.add(obj)
    session.commit()
    return {"ok": True}


@router.delete("/listas/{lista}/{item_id}", dependencies=[Depends(exigir_senha)])
def apagar_opcao(lista: str, item_id: int, session: Session = Depends(get_session)):
    """Só apaga opção nunca usada. Opção usada só pode ser desativada."""
    _checar_lista(lista)
    obj = _achar_opcao(lista, item_id, session)
    item = next(i for i in _itens_lista(lista, session) if i["id"] == item_id)
    if item["fixo"]:
        raise HTTPException(400, "\"Outro\" é fixo e não pode ser apagado.")
    if item["uso"] > 0:
        raise HTTPException(400, "Esta opção já foi usada em registros: desative em vez de apagar.")
    session.delete(obj)
    session.commit()
    return {"ok": True, "texto": item["texto"]}


# ---------------------------------------------------------------------
# Histórico de importações e de backups
# ---------------------------------------------------------------------
def _imp_json(r: ImportacaoRegistro) -> dict:
    return {"id": r.id, "tipo": r.tipo, "arquivo": r.arquivo, "quando": r.quando.isoformat() if r.quando else None,
            "por": r.por, "resumo": r.resumo, "avisos": json.loads(r.avisos_json or "[]")}


@router.get("/importacoes")
def historico_importacoes(session: Session = Depends(get_session)):
    """Últimas 5 importações de cada tipo."""
    todas = session.exec(select(ImportacaoRegistro).order_by(ImportacaoRegistro.quando.desc())).all()
    por_tipo: dict = {}
    for r in todas:
        lista = por_tipo.setdefault(r.tipo, [])
        if len(lista) < 5:
            lista.append(_imp_json(r))
    return por_tipo


@router.get("/backups")
def historico_backups(session: Session = Depends(get_session)):
    regs = session.exec(select(BackupRegistro).order_by(BackupRegistro.quando.desc())).all()
    return [{"quando": r.quando.isoformat(), "por": r.por, "arquivo": r.arquivo, "tamanho_bytes": r.tamanho_bytes}
            for r in regs[:30]]
