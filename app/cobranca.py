"""
Lógica de negócio do controle de Cobrança (boletos vencidos).

Importa o relatório diário de boletos vencidos do banco e aplica a regra:
- Boleto que sumiu da planilha (estava "Em aberto" e não veio hoje) -> "Pago"
- Boleto novo -> "Em aberto"
- Boleto que estava "Pago" e reaparece -> volta pra "Em aberto", marcado
  com aviso de que reapareceu (mas o registro de quando foi pago antes
  não se perde, fica disponível no histórico do próprio boleto)

O formato da planilha do banco varia um pouco entre exportações (às vezes
vem com linhas de cabeçalho extra tipo "Agência"/"Conta" antes da tabela,
às vezes não; a coluna "Carteira" nem sempre aparece) — a leitura localiza
a linha de cabeçalho de verdade procurando a célula "Pagador", em vez de
assumir uma posição fixa.
"""
from datetime import date, datetime
from typing import Optional

import pandas as pd
from sqlmodel import Session, select

from .models import Boleto

COLUNAS_ESPERADAS = {"Pagador", "Seu Número", "Data Vencimento"}


def _to_date(value) -> Optional[date]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return pd.to_datetime(value, dayfirst=True).date()
    except Exception:
        return None


def _to_float(value) -> Optional[float]:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _localizar_linha_cabecalho(raw_df: pd.DataFrame) -> Optional[int]:
    """Procura a linha que contém 'Pagador' numa das células — essa é a
    linha de cabeçalho de verdade, ignorando qualquer preâmbulo acima."""
    for i in range(min(len(raw_df), 15)):  # não precisa olhar o arquivo inteiro
        valores = set(str(v).strip() for v in raw_df.iloc[i].tolist() if v is not None)
        if "Pagador" in valores:
            return i
    return None


def importar_boletos(file_bytes, session: Session) -> dict:
    """Lê a planilha de boletos vencidos e aplica a regra de pago/em-aberto.
    Retorna um resumo do que aconteceu nessa importação."""
    raw = pd.read_excel(file_bytes, header=None)
    linha_cabecalho = _localizar_linha_cabecalho(raw)
    if linha_cabecalho is None:
        raise ValueError(
            "Não encontrei a linha de cabeçalho (coluna 'Pagador') nessa planilha. "
            "Confirma se é o relatório de consulta de boletos certo."
        )

    df = pd.read_excel(file_bytes, header=linha_cabecalho)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")

    faltando = COLUNAS_ESPERADAS - set(df.columns)
    if faltando:
        raise ValueError(
            "Essa planilha não parece ser o relatório de boletos vencidos — "
            "faltam as colunas: " + ", ".join(faltando)
        )

    hoje = date.today()
    numeros_na_planilha = set()
    novos = 0
    atualizados = 0
    reapareceram = 0

    for _, row in df.iterrows():
        seu_numero_raw = row.get("Seu Número")
        if pd.isna(seu_numero_raw):
            continue
        seu_numero = str(seu_numero_raw).strip()
        if not seu_numero:
            continue
        numeros_na_planilha.add(seu_numero)

        boleto = session.get(Boleto, seu_numero)
        era_novo = boleto is None
        if boleto is None:
            boleto = Boleto(seu_numero=seu_numero)

        if not era_novo and boleto.status == "Pago":
            boleto.reapareceu = True
            reapareceram += 1

        boleto.pagador = row.get("Pagador") or boleto.pagador
        boleto.cnpj_cpf = row.get("CPF/CNPJ Pagador") or boleto.cnpj_cpf
        boleto.tipo = row.get("Tipo") or boleto.tipo
        if "Carteira" in df.columns and not pd.isna(row.get("Carteira")):
            boleto.carteira = str(row.get("Carteira"))
        boleto.data_emissao = _to_date(row.get("Data Emissão")) or boleto.data_emissao
        boleto.data_vencimento = _to_date(row.get("Data Vencimento")) or boleto.data_vencimento
        boleto.data_pagamento_banco = _to_date(row.get("Data Pagamento"))
        boleto.data_baixa = _to_date(row.get("Data Baixa"))
        boleto.valor_titulo = _to_float(row.get("Valor Título (R$)")) or boleto.valor_titulo
        boleto.valor_pago = _to_float(row.get("Valor Pago (R$)"))
        boleto.status_planilha = row.get("Status") or boleto.status_planilha
        boleto.status = "Em aberto"
        boleto.updated_at = datetime.utcnow()

        session.add(boleto)
        if era_novo:
            novos += 1
        else:
            atualizados += 1

    session.commit()

    # Regra automática: quem estava "Em aberto" e não veio nessa planilha, pagou.
    em_aberto = session.exec(select(Boleto).where(Boleto.status == "Em aberto")).all()
    marcados_pagos = 0
    for boleto in em_aberto:
        if boleto.seu_numero not in numeros_na_planilha:
            boleto.status = "Pago"
            boleto.data_pago_sistema = hoje
            boleto.reapareceu = False
            session.add(boleto)
            marcados_pagos += 1
    session.commit()

    return {
        "registros_processados": len(numeros_na_planilha),
        "novos": novos,
        "atualizados": atualizados,
        "reapareceram": reapareceram,
        "marcados_pagos": marcados_pagos,
    }
