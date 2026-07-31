"""
Motor de importação e cruzamento das 3 planilhas do FlowLog.

Detecta automaticamente qual das 3 planilhas foi enviada, com base
nas colunas presentes, e atualiza (upsert) a tabela Pedido.
"""
from datetime import date, datetime
import numpy as np
import pandas as pd
from sqlmodel import Session, select

from .models import Pedido

# Limite de dias úteis após o faturamento para considerar "atraso de entrega"
LIMITE_DIAS_UTEIS_ENTREGA = 2


# ---------------------------------------------------------------------
# Detecção do tipo de planilha
# ---------------------------------------------------------------------
def detectar_tipo_planilha(df: pd.DataFrame) -> str:
    cols = set(c.strip() for c in df.columns)

    if {"Nº do documento", "Situação"}.issubset(cols):
        return "follow_up_vendas"
    if {"Cód. da OE", "Cód. do pedido"}.issubset(cols):
        return "oe"
    if {"Pedido", "NF", "Canhoto"}.issubset(cols):
        return "pedidos_mubec"

    raise ValueError(
        "Não foi possível identificar o tipo da planilha. "
        "Colunas encontradas: " + ", ".join(cols)
    )


def _to_date(value) -> date | None:
    if pd.isna(value):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return pd.to_datetime(value).date()
    except Exception:
        return None


def _tipo_entrega_from_cod(cod) -> str:
    if pd.isna(cod):
        return "Desconhecido"
    cod_str = str(cod).strip().split(".")[0]  # remove .0 de floats
    if cod_str == "100":
        return "Entrega"
    if cod_str == "1000":
        return "Retira"
    return "Transportadora"


# ---------------------------------------------------------------------
# Upsert helper
# ---------------------------------------------------------------------
# Cache local por chamada de importação: evita tentar criar o mesmo
# numero_pedido duas vezes antes do commit (planilhas têm 1 linha por
# item, então o mesmo pedido pode repetir várias vezes na mesma leitura).
def _get_or_create(session: Session, numero_pedido: str, cache: dict) -> Pedido:
    if numero_pedido in cache:
        return cache[numero_pedido]
    pedido = session.get(Pedido, numero_pedido)
    if pedido is None:
        pedido = Pedido(numero_pedido=numero_pedido)
        session.add(pedido)
    cache[numero_pedido] = pedido
    return pedido


# ---------------------------------------------------------------------
# Importadores específicos
# ---------------------------------------------------------------------
def importar_follow_up_vendas(df: pd.DataFrame, session: Session) -> int:
    count = 0
    cache: dict = {}
    for _, row in df.iterrows():
        numero_pedido = str(row["Nº do documento"]).strip().split(".")[0]
        if not numero_pedido or numero_pedido == "nan":
            continue
        pedido = _get_or_create(session, numero_pedido, cache)
        pedido.data_emissao = _to_date(row.get("Data de emissão"))
        pedido.cod_cliente = str(row.get("Cód. do cliente", "")).split(".")[0] or None
        pedido.nome_cliente = row.get("Nome fantasia") or pedido.nome_cliente
        pedido.situacao_erp = str(row.get("Situação", "")).strip() or None
        cod_transp = row.get("Cód. da transportadora")
        pedido.cod_transportadora = (
            str(cod_transp).split(".")[0] if not pd.isna(cod_transp) else None
        )
        pedido.tipo_entrega = _tipo_entrega_from_cod(cod_transp)
        pedido.updated_at = datetime.utcnow()
        count += 1
    return count


def importar_oe(df: pd.DataFrame, session: Session) -> int:
    count = 0
    cache: dict = {}
    for _, row in df.iterrows():
        numero_pedido = str(row.get("Cód. do pedido", "")).strip().split(".")[0]
        if not numero_pedido or numero_pedido == "nan":
            continue
        pedido = _get_or_create(session, numero_pedido, cache)
        # Não sobrescreve se já veio (por item duplicado); primeira ocorrência vale
        if not pedido.numero_oe:
            pedido.numero_oe = str(row.get("Cód. da OE", "")).split(".")[0] or None
        if not pedido.data_entrega_prevista:
            pedido.data_entrega_prevista = _to_date(row.get("Data de entrega"))
        pedido.nome_cliente = pedido.nome_cliente or row.get("Nome fantasia do cliente")
        pedido.updated_at = datetime.utcnow()
        count += 1
    return count


def importar_pedidos_mubec(df: pd.DataFrame, session: Session) -> int:
    """
    Usa a aba 'Expedição'. Também serve de RESERVA para número da OE
    e data de entrega prevista, caso não tenham vindo da planilha de OE.
    """
    count = 0
    cache: dict = {}
    for _, row in df.iterrows():
        numero_pedido_raw = row.get("Pedido")
        if pd.isna(numero_pedido_raw):
            continue
        numero_pedido = str(numero_pedido_raw).split(".")[0]
        pedido = _get_or_create(session, numero_pedido, cache)

        # Campos principais desta planilha
        nf = row.get("NF")
        pedido.nf = str(nf).split(".")[0] if not pd.isna(nf) else pedido.nf
        pedido.data_faturamento = _to_date(row.get("Data de\nFaturamento")) or pedido.data_faturamento
        pedido.data_entrega_real = _to_date(row.get("Data de\nentrega")) or pedido.data_entrega_real
        canhoto = row.get("Canhoto")
        pedido.canhoto = str(canhoto).strip() if not pd.isna(canhoto) and str(canhoto).strip() else pedido.canhoto

        # Reserva: OE e data de entrega prevista, só se ainda não existirem
        if not pedido.numero_oe:
            oe = row.get("OE")
            pedido.numero_oe = str(oe).split(".")[0] if not pd.isna(oe) else pedido.numero_oe
        if not pedido.data_entrega_prevista:
            pedido.data_entrega_prevista = _to_date(row.get("Data Prev\nde Entrega"))

        pedido.nome_cliente = pedido.nome_cliente or row.get("CLIENTE")
        pedido.updated_at = datetime.utcnow()
        count += 1
    return count


IMPORTADORES = {
    "follow_up_vendas": importar_follow_up_vendas,
    "oe": importar_oe,
    "pedidos_mubec": importar_pedidos_mubec,
}


def importar_planilha(file_bytes, session: Session) -> dict:
    """Recebe bytes de um .xlsx, detecta o tipo e importa."""
    # tenta cada aba até achar uma que bata com o formato esperado
    xls = pd.ExcelFile(file_bytes)
    erros = []
    for sheet_name in xls.sheet_names:
        df = xls.parse(sheet_name)
        df.columns = [str(c).strip() for c in df.columns]
        try:
            tipo = detectar_tipo_planilha(df)
        except ValueError as e:
            erros.append(f"{sheet_name}: {e}")
            continue

        with session.no_autoflush:
            n = IMPORTADORES[tipo](df, session)
        session.commit()
        return {"tipo_detectado": tipo, "aba_usada": sheet_name, "registros_processados": n}

    raise ValueError(
        "Nenhuma aba da planilha correspondeu a um formato conhecido. " + " | ".join(erros)
    )


# ---------------------------------------------------------------------
# Cálculo de status e atraso — roda depois de qualquer importação
# ---------------------------------------------------------------------
def _dias_uteis_entre(d1: date, d2: date) -> int:
    """Dias úteis entre d1 (exclusive) e d2 (inclusive), d2 >= d1."""
    if d2 <= d1:
        return 0
    return int(np.busday_count(d1, d2))


def recalcular_status_e_atrasos(session: Session) -> None:
    hoje = date.today()
    pedidos = session.exec(select(Pedido)).all()

    for p in pedidos:
        # --- Status ---
        situacao_lower = (p.situacao_erp or "").lower()
        if p.cancelado or "cancelado" in situacao_lower:
            p.status = "Cancelado"
        elif p.canhoto:
            p.status = "Encerrado"
        elif p.data_faturamento or "faturado" in situacao_lower:
            p.status = "Faturado"
        elif "bloqueado" in situacao_lower:
            p.status = "Bloqueado"
        elif "aprovado" in situacao_lower or "aberto" in situacao_lower:
            p.status = "Aprovado"
        else:
            p.status = p.situacao_erp or "Indefinido"

        # --- Atraso de produção: ainda não faturado e a data prevista original já passou ---
        # (a "nova data de entrega" é só informativa; não altera se o pedido conta como atrasado)
        p.atraso_producao = False
        p.dias_atraso_producao = 0
        if p.status in ("Bloqueado", "Aprovado") and p.data_entrega_prevista:
            dias = _dias_uteis_entre(p.data_entrega_prevista, hoje)
            if dias > 0:
                p.atraso_producao = True
                p.dias_atraso_producao = dias

        # --- Atraso de entrega: faturado, mas não encerrado, há mais de N dias úteis ---
        p.atraso_entrega = False
        p.dias_atraso_entrega = 0
        if p.status == "Faturado" and p.data_faturamento:
            dias = _dias_uteis_entre(p.data_faturamento, hoje)
            if dias > LIMITE_DIAS_UTEIS_ENTREGA:
                p.atraso_entrega = True
                p.dias_atraso_entrega = dias - LIMITE_DIAS_UTEIS_ENTREGA

        session.add(p)

    session.commit()
