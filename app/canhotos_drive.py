"""v2 (25/11) — Canhotos direto da pasta do Google Drive.

O canhoto em papel é fotografado pelo app do Drive e o arquivo recebe o
número da NF no nome ("118118 2511", "118.118_assinada.pdf"...). Aqui o
FlowLog lê a pasta (só leitura, conta de serviço do Google Cloud), liga
cada arquivo à NF e:
  1. guarda só o link (webViewLink) — a imagem nunca é baixada;
  2. marca a NF como "com canhoto" quando a planilha ainda não marcou.

Segurança dos dados:
- A marcação feita pelo Drive fica com o texto "drive:<id do arquivo>" no
  campo canhoto da NF. Se a planilha trouxer o canhoto, ela manda (e o Drive
  nunca mais mexe naquela NF). Se a foto for apagada/renomeada no Drive e a
  planilha não tiver o canhoto, a marcação do Drive é desfeita sozinha.
- Se a leitura da pasta falhar ou voltar muito menor que da última vez,
  nada é marcado como removido.

Configuração (variáveis de ambiente do Railway, nunca no código):
  FLOWLOG_DRIVE_CREDENCIAIS = conteúdo do arquivo .json da conta de serviço
  FLOWLOG_DRIVE_PASTA       = id da pasta dos canhotos (o trecho da URL depois de /folders/)
"""
import json
import os
import re
import threading
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlmodel import Session, select

from .models import CanhotoArquivo, NotaFiscalPedido

PREFIXO = "drive:"
PASTA_MIME = "application/vnd.google-apps.folder"
INTERVALO_HORAS = 3
_CHAVE_RESULTADO = "canhotos_drive_ultima"
_trava = threading.Lock()
_ultima_execucao = {"quando": 0.0}


# ----------------------------------------------------------------------
# Nome do arquivo -> NF e data
# ----------------------------------------------------------------------
_RE_NOME = re.compile(r"^\s*(?:nf\s*[-:.]?\s*)?(\d[\d.]*)(?:[\s_\-]+(\d{4})(?!\d))?", re.IGNORECASE)


def normalizar_nf(texto) -> Optional[str]:
    """'117.124' / '117124' / '0117124' -> '117124'. Sem número -> None."""
    if texto is None:
        return None
    digitos = re.sub(r"\D", "", str(texto).split(",")[0])
    digitos = digitos.lstrip("0")
    return digitos or None


def ler_nome(nome: str, criado: Optional[date] = None):
    """Tira (nf, data) do nome do arquivo. A NF é o primeiro número do nome
    (pontos de milhar ignorados) e vai até o primeiro espaço, "_" ou "-".
    Um bloco de 4 dígitos logo depois é o dia e o mês ("2511" = 25/11); o ano
    vem da data em que o arquivo foi criado. Nome que não começa com número
    não é canhoto -> (None, None)."""
    base = os.path.splitext(nome or "")[0] if re.search(r"\.[A-Za-z]{2,5}$", nome or "") else (nome or "")
    m = _RE_NOME.match(base)
    if not m:
        return None, None
    bloco = m.group(1).strip(".")
    # pontos só como separador de milhar (117.124); "117.124.5" não é NF
    if "." in bloco and not re.fullmatch(r"\d{1,3}(\.\d{3})+", bloco):
        return None, None
    nf = normalizar_nf(bloco)
    if not nf or len(nf) < 4:
        return None, None
    data = None
    if m.group(2):
        dia, mes = int(m.group(2)[:2]), int(m.group(2)[2:])
        ref = criado or date.today()
        try:
            data = date(ref.year, mes, dia)
            if data > ref + timedelta(days=7):  # ex.: foto de 30/12 enviada em 02/01
                data = date(ref.year - 1, mes, dia)
        except ValueError:
            data = None
    return nf, data


def _data_brasil(texto_iso: Optional[str]) -> Optional[datetime]:
    if not texto_iso:
        return None
    try:
        d = datetime.fromisoformat(texto_iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.astimezone(timezone(timedelta(hours=-3))).replace(tzinfo=None)


# ----------------------------------------------------------------------
# Google Drive (só leitura)
# ----------------------------------------------------------------------
def configurado() -> bool:
    return bool(os.environ.get("FLOWLOG_DRIVE_CREDENCIAIS") and os.environ.get("FLOWLOG_DRIVE_PASTA"))


def _sessao_google():
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    info = json.loads(os.environ["FLOWLOG_DRIVE_CREDENCIAIS"])
    cred = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/drive.readonly"])
    return AuthorizedSession(cred)


def listar_pasta_drive(pasta_id: str, sessao=None) -> list:
    """Todos os arquivos da pasta e das subpastas (ano/mês), com paginação.
    Devolve dicts com id, name, mimeType, createdTime, modifiedTime, webViewLink."""
    if sessao is None:
        try:
            sessao = _sessao_google()
        except Exception as e:
            raise RuntimeError(f"A chave do Google (FLOWLOG_DRIVE_CREDENCIAIS) não está certa: {e}") from e
    arquivos, fila, vistas = [], [pasta_id], set()
    while fila:
        pasta = fila.pop(0)
        if pasta in vistas:
            continue
        vistas.add(pasta)
        token = None
        while True:
            params = {
                "q": f"'{pasta}' in parents and trashed = false",
                "fields": "nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, webViewLink)",
                "pageSize": 1000, "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
            }
            if token:
                params["pageToken"] = token
            r = sessao.get("https://www.googleapis.com/drive/v3/files", params=params, timeout=60)
            if r.status_code in (403, 404):
                raise RuntimeError("Sem acesso à pasta dos canhotos. Confira se ela está compartilhada com o e-mail "
                                   "da conta de serviço e se FLOWLOG_DRIVE_PASTA é o id certo.")
            if r.status_code != 200:
                raise RuntimeError(f"Google Drive respondeu {r.status_code}: {r.text[:200]}")
            dados = r.json()
            for f in dados.get("files", []):
                if f.get("mimeType") == PASTA_MIME:
                    fila.append(f["id"])
                else:
                    arquivos.append(f)
            token = dados.get("nextPageToken")
            if not token:
                break
    return arquivos


# ----------------------------------------------------------------------
# Guardar no banco e aplicar nas NFs
# ----------------------------------------------------------------------
def guardar_arquivos(session: Session, arquivos: Iterable[dict], agora: Optional[datetime] = None) -> dict:
    """Atualiza a tabela de canhotos com a lista COMPLETA da pasta. Arquivo
    que sumiu da pasta fica marcado como removido (nunca é apagado)."""
    agora = agora or datetime.utcnow()
    arquivos = list(arquivos)
    existentes = {c.drive_id: c for c in session.exec(select(CanhotoArquivo)).all()}
    ativos_antes = sum(1 for c in existentes.values() if not c.removido_em)
    if ativos_antes >= 20 and len(arquivos) < ativos_antes * 0.5:
        raise RuntimeError(f"A pasta voltou com {len(arquivos)} arquivos e antes tinha {ativos_antes}. "
                           "Por segurança nada foi mudado. Confira se a pasta continua compartilhada.")
    vistos, novos, mudaram = set(), 0, 0
    for f in arquivos:
        criado = _data_brasil(f.get("createdTime"))
        nf, data = ler_nome(f.get("name", ""), criado.date() if criado else None)
        c = existentes.get(f["id"])
        if c is None:
            c = CanhotoArquivo(drive_id=f["id"])
            novos += 1
        elif c.nome != f.get("name") or c.removido_em or c.modificado_em != _data_brasil(f.get("modifiedTime")):
            mudaram += 1
        c.nome = f.get("name")
        c.nf = nf
        c.data_canhoto = data or (criado.date() if criado else None)
        c.link = f.get("webViewLink")
        c.criado_em = criado
        c.modificado_em = _data_brasil(f.get("modifiedTime"))
        c.visto_em = agora
        c.removido_em = None
        session.add(c)
        vistos.add(f["id"])
    removidos = 0
    for drive_id, c in existentes.items():
        if drive_id not in vistos and not c.removido_em:
            c.removido_em = agora
            session.add(c)
            removidos += 1
    session.commit()
    return {"arquivos": len(arquivos), "novos": novos, "mudaram": mudaram, "removidos": removidos}


def aplicar_nas_nfs(session: Session) -> int:
    """Marca o canhoto nas NFs que têm foto no Drive e ainda não têm canhoto
    da planilha; desfaz a marcação do Drive se a foto sumiu. Não faz commit
    (roda dentro do recálculo de status). Devolve quantas NFs mudaram."""
    fotos: dict = {}
    for c in session.exec(select(CanhotoArquivo).where(CanhotoArquivo.removido_em.is_(None), CanhotoArquivo.nf.is_not(None))).all():
        fotos.setdefault(c.nf, []).append(c)
    mudou = 0
    for n in session.exec(select(NotaFiscalPedido)).all():
        lista = fotos.get(normalizar_nf(n.nf) or "")
        canhoto = (n.canhoto or "").strip()
        if canhoto and not canhoto.startswith(PREFIXO):
            continue  # a planilha já marcou: ela manda
        if lista:
            c = sorted(lista, key=lambda x: (x.criado_em or datetime.max, x.drive_id))[0]
            novo = PREFIXO + c.drive_id
            if n.canhoto != novo:
                n.canhoto = novo
                mudou += 1
            if not n.data_entrega and c.data_canhoto:
                n.data_entrega = c.data_canhoto
                mudou += 1
            session.add(n)
        elif canhoto.startswith(PREFIXO):
            antigo = session.exec(select(CanhotoArquivo).where(CanhotoArquivo.drive_id == canhoto[len(PREFIXO):])).first()
            if antigo and n.data_entrega == antigo.data_canhoto:
                n.data_entrega = None
            n.canhoto = None
            session.add(n)
            mudou += 1
    return mudou


def fotos_por_nf(session: Session, nfs: Iterable[str]) -> dict:
    """{nf como está na NF: [{nome, link, data}]} — para as telas."""
    chave = {}
    for nf in nfs:
        k = normalizar_nf(nf)
        if k:
            chave.setdefault(k, []).append(nf)
    if not chave:
        return {}
    saida: dict = {}
    for c in session.exec(select(CanhotoArquivo).where(CanhotoArquivo.removido_em.is_(None), CanhotoArquivo.nf.in_(list(chave)))).all():
        for nf in chave.get(c.nf, []):
            saida.setdefault(nf, []).append({"nome": c.nome, "link": c.link, "data": c.data_canhoto.isoformat() if c.data_canhoto else None})
    for v in saida.values():
        v.sort(key=lambda x: (x["data"] or "", x["nome"] or ""))
    return saida


# ----------------------------------------------------------------------
# Sincronizar (botão, a cada 3 horas e depois da importação)
# ----------------------------------------------------------------------
def resumo(session: Session) -> dict:
    from .models import Configuracao
    cfg = session.get(Configuracao, _CHAVE_RESULTADO)
    ultima = None
    if cfg and cfg.valor:
        try:
            ultima = json.loads(cfg.valor)
        except ValueError:
            ultima = None
    return {"configurado": configurado(), "ultima": ultima, "intervalo_horas": INTERVALO_HORAS}


def _registrar(session: Session, dados: dict) -> None:
    from .models import Configuracao
    cfg = session.get(Configuracao, _CHAVE_RESULTADO) or Configuracao(chave=_CHAVE_RESULTADO)
    cfg.valor = json.dumps(dados, ensure_ascii=False)
    cfg.atualizado_em = datetime.utcnow()
    session.add(cfg)
    session.commit()


def _pendencias(session: Session) -> dict:
    ativos = session.exec(select(CanhotoArquivo).where(CanhotoArquivo.removido_em.is_(None))).all()
    nfs_banco = {normalizar_nf(n) for n in session.exec(select(NotaFiscalPedido.nf)).all()}
    sem_nf = sorted(c.nome for c in ativos if not c.nf)
    por_nf: dict = {}
    for c in ativos:
        if c.nf:
            por_nf.setdefault(c.nf, []).append(c.nome)
    nao_achadas = sorted(nf for nf in por_nf if nf not in nfs_banco)
    repetidas = sorted(nf for nf, nomes in por_nf.items() if len(nomes) > 1)
    return {"ligados": sum(1 for nf in por_nf if nf in nfs_banco), "sem_nf": sem_nf[:50], "qtd_sem_nf": len(sem_nf),
            "nf_nao_encontrada": nao_achadas[:50], "qtd_nf_nao_encontrada": len(nao_achadas),
            "repetidas": repetidas[:50], "qtd_repetidas": len(repetidas)}


def sincronizar(engine, por: Optional[str] = None, arquivos: Optional[list] = None) -> dict:
    """Lê a pasta inteira, guarda os links e recalcula os status. Só uma
    sincronização por vez. `arquivos` é usado só nos testes."""
    from .fuso import agora_brasil
    from .importer import recalcular_status_e_atrasos
    if not _trava.acquire(blocking=False):
        raise RuntimeError("Já tem uma sincronização em andamento. Espere um pouco.")
    inicio = time.time()
    try:
        with Session(engine) as session:
            try:
                if arquivos is None:
                    if not configurado():
                        raise RuntimeError("Drive não configurado (faltam as variáveis FLOWLOG_DRIVE_CREDENCIAIS e FLOWLOG_DRIVE_PASTA).")
                    arquivos = listar_pasta_drive(os.environ["FLOWLOG_DRIVE_PASTA"])
                contagem = guardar_arquivos(session, arquivos)
                recalcular_status_e_atrasos(session)  # aplica nas NFs e atualiza status/avisos
                dados = dict(contagem, **_pendencias(session), ok=True, erro=None)
            except Exception as e:
                session.rollback()
                traceback.print_exc()
                dados = {"ok": False, "erro": str(e)[:300]}
            dados.update(quando=agora_brasil().strftime("%Y-%m-%dT%H:%M"), por=por, segundos=round(time.time() - inicio, 1))
            _registrar(session, dados)
            _ultima_execucao["quando"] = time.time()
            return dados
    finally:
        _trava.release()


def sincronizar_em_segundo_plano(engine, por: Optional[str] = None, se_passou_minutos: int = 10) -> None:
    """Depois de uma importação: roda sem fazer a pessoa esperar, e no
    máximo uma vez a cada 10 minutos (o n8n importa vários arquivos seguidos)."""
    if not configurado() or time.time() - _ultima_execucao["quando"] < se_passou_minutos * 60:
        return
    def _rodar():
        try:
            sincronizar(engine, por)
        except Exception:
            traceback.print_exc()
    threading.Thread(target=_rodar, daemon=True).start()


async def loop_sincronizacao(engine):
    """Em segundo plano, junto com o servidor: a cada 3 horas (a primeira
    2 minutos depois de ligar). Sem Drive configurado, não faz nada."""
    import asyncio
    await asyncio.sleep(120)
    while True:
        if configurado():
            try:
                await asyncio.to_thread(sincronizar, engine, "automático")
            except Exception:
                traceback.print_exc()
        await asyncio.sleep(INTERVALO_HORAS * 3600)
