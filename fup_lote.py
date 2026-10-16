"""
Importação em lote de FUP — lê de volta a planilha que o usuário exportou
("Exportar Excel"), preencheu as colunas "Situação FUP" e "FUP" (e/ou "Nova
Data de Entrega"), e reimporta pra criar os registros de uma vez, sem
precisar digitar pedido por pedido na tela.

Aceita a planilha em qualquer ordem de coluna, com colunas a mais ou a
menos — reconhece pelo NOME da coluna (ignorando maiúsculas/minúsculas,
acentos e espaços em excesso), não pela posição. Só duas colunas são
realmente necessárias: uma que identifique o pedido, e pelo menos uma das
colunas de edição ("Nova Data de Entrega", "Situação FUP"/"FUP").

Nunca mexe em campos que vêm do ERP (cliente, OE, status, tipo, data
original) — mesmo que apareçam na planilha, são ignorados aqui de
propósito, por segurança (evita sobrescrever com dado desatualizado).
"""
from datetime import date, datetime
from typing import Optional

import pandas as pd
from sqlmodel import Session

from .models import Pedido, FupRegistro
from .fuso import hoje_brasil


def _normalizar_cabecalho(texto: str) -> str:
    """Deixa o nome da coluna fácil de comparar: sem acento, minúsculo, sem
    espaço extra nas pontas nem duplicado no meio."""
    import unicodedata
    texto = str(texto).strip()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return " ".join(texto.lower().split())


def _achar_coluna(colunas_normalizadas: dict, *candidatos: str) -> Optional[str]:
    """Procura a primeira coluna cujo nome normalizado bate exatamente com
    algum dos nomes candidatos (também normalizados)."""
    for candidato in candidatos:
        alvo = _normalizar_cabecalho(candidato)
        if alvo in colunas_normalizadas:
            return colunas_normalizadas[alvo]
    return None


def _to_date(value) -> Optional[date]:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    texto = str(value).strip()
    if not texto:
        return None
    try:
        return pd.to_datetime(texto, dayfirst=True).date()
    except Exception:
        return None


def _normalizar_situacao(texto: Optional[str]) -> Optional[str]:
    """Reconhece 'Ok', 'Previsto atraso', 'Atraso' em qualquer variação de
    maiúsculas/acentos. Retorna None se não reconhecer (nesse caso, o
    registro é criado sem situação definida — tratado como 'Atraso' pra
    manter compatibilidade com registros antigos, igual já acontecia)."""
    if not texto or not str(texto).strip():
        return None
    t = _normalizar_cabecalho(str(texto))
    if "previsto" in t:
        return "previsto_atraso"
    if t == "ok" or t.startswith("ok "):
        return "ok"
    if "atraso" in t:
        return "atraso"
    return None


def importar_fup_em_lote(file_bytes, session: Session) -> dict:
    df = pd.read_excel(file_bytes)
    df.columns = [str(c) for c in df.columns]
    colunas_normalizadas = {_normalizar_cabecalho(c): c for c in df.columns}

    col_pedido = _achar_coluna(colunas_normalizadas, "Pedido", "Número do Pedido", "Numero do Pedido", "Nº do Pedido")
    if not col_pedido:
        raise ValueError(
            "Não encontrei nenhuma coluna que identifique o pedido (esperava algo "
            "como 'Pedido' ou 'Número do Pedido'). Confirma se é a planilha certa."
        )

    col_nova_data = _achar_coluna(colunas_normalizadas, "Nova Data de Entrega", "Nova Data")
    col_situacao = _achar_coluna(colunas_normalizadas, "Situação FUP", "Situacao FUP")
    col_fup = _achar_coluna(colunas_normalizadas, "FUP")  # exato — não bate com "FUP 1", "FUP 2" etc (histórico)

    if not col_nova_data and not (col_situacao or col_fup):
        raise ValueError(
            "Não encontrei nem 'Nova Data de Entrega' nem 'Situação FUP'/'FUP' "
            "nessa planilha — não tem nada pra importar. Exporte a planilha de "
            "novo pelo FlowLog pra pegar essas colunas prontas."
        )

    pedidos_nao_encontrados = []
    pedidos_com_fup_novo = []
    datas_atualizadas = 0
    fups_criados = 0
    linhas_ignoradas_sem_dado = 0

    for _, row in df.iterrows():
        numero_raw = row.get(col_pedido)
        if pd.isna(numero_raw):
            continue
        numero_pedido = str(numero_raw).split(".")[0].strip()
        if not numero_pedido:
            continue

        pedido = session.get(Pedido, numero_pedido)
        if not pedido:
            pedidos_nao_encontrados.append(numero_pedido)
            continue

        # --- Nova Data de Entrega (só mexe se a célula tiver algo) ---
        if col_nova_data:
            nova_data = _to_date(row.get(col_nova_data))
            if nova_data:
                pedido.nova_data_entrega = nova_data
                session.add(pedido)
                datas_atualizadas += 1

        # --- Novo registro de FUP (só cria se a coluna "FUP" tiver texto) ---
        texto_fup = row.get(col_fup) if col_fup else None
        texto_fup = str(texto_fup).strip() if texto_fup is not None and not pd.isna(texto_fup) else ""
        if not texto_fup:
            continue

        situacao = _normalizar_situacao(row.get(col_situacao)) if col_situacao else None
        # Sem uma lista de motivo pra escolher nessa planilha — trata o texto
        # digitado como o motivo "Outro" (o sistema já sabe mostrar o texto
        # da observação no lugar do rótulo genérico "Outro" em toda a tela).
        motivo_atraso = None if situacao == "ok" else "Outro"

        fup = FupRegistro(
            numero_pedido=numero_pedido,
            data_referencia=hoje_brasil(),
            situacao=situacao,
            motivo_atraso=motivo_atraso,
            observacao=texto_fup,
        )
        session.add(fup)
        fups_criados += 1
        pedidos_com_fup_novo.append(numero_pedido)

    session.commit()

    return {
        "datas_atualizadas": datas_atualizadas,
        "fups_criados": fups_criados,
        "pedidos_nao_encontrados": sorted(set(pedidos_nao_encontrados)),
        "pedidos_com_fup_novo": sorted(set(pedidos_com_fup_novo)),
    }
