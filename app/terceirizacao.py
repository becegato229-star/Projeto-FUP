"""
Lógica de negócio do controle de Terceirização (lead time de industrialização).

Extrai o vínculo entre nota de saída e nota de retorno a partir do texto de
"Informações Adicionais" da nota fiscal, usando reconhecimento de padrão
(regex) em vez de posição fixa de caractere — funciona mesmo com pequenas
variações de formatação (ponto vs vírgula, espaços extras, etc).
"""
import re
from datetime import date
from typing import Optional

import numpy as np
from sqlmodel import Session, select

from .models import NotaSaida, NotaRetorno

# Reconhece o padrão observado: "/obs.nfe116858 nfe9186 jjleste /" — e variações
# como "OBS:No NFE116921 No NFE9196" (com texto extra entre os dois números) e
# números que vieram com ponto no meio por engano (ex: "117.104" = 117104).
PADRAO_VINCULO = re.compile(r"nfe\s*([\d.]+?)[^\d]{0,25}?nfe\s*([\d.]+)", re.IGNORECASE)


def _normalizar_numero(bruto: str) -> str:
    """Remove pontos que às vezes aparecem no meio do número por engano
    (ex: separador de milhar digitado sem querer: '117.104' -> '117104')."""
    return bruto.replace(".", "").lstrip("0") or "0"


def extrair_numero_nota_saida(texto: Optional[str]) -> Optional[str]:
    """Lê o texto de 'Informações Adicionais' e retorna o número da nota de
    saída vinculada, se o padrão for reconhecido. Retorna None se não achar."""
    if not texto:
        return None
    match = PADRAO_VINCULO.search(texto)
    if not match:
        return None
    return _normalizar_numero(match.group(1))


def _dias_uteis_entre(d1: date, d2: date) -> int:
    if d2 <= d1:
        return 0
    return int(np.busday_count(d1, d2))


def calcular_lead_time_dias(data_saida: date, data_retorno: date) -> int:
    """Dias corridos entre saída e retorno (igual à planilha original, que
    usava dias corridos, não úteis — mantido para bater com o histórico)."""
    return (data_retorno - data_saida).days


def montar_pares(session: Session, fornecedor: Optional[str] = None) -> dict:
    """Monta a visão completa: pares vinculados (com lead time calculado),
    notas de saída (com a contagem de retornos já vinculados a cada uma —
    uma nota de saída pode ter mais de um retorno vinculado, ex: devolução
    parcial em mais de uma remessa), e notas de retorno sem vínculo
    encontrado (precisam de atenção manual)."""
    query_saida = select(NotaSaida)
    query_retorno = select(NotaRetorno)
    if fornecedor:
        query_saida = query_saida.where(NotaSaida.fornecedor == fornecedor)
        query_retorno = query_retorno.where(NotaRetorno.fornecedor == fornecedor)

    saidas = session.exec(query_saida).all()
    retornos = session.exec(query_retorno).all()

    saidas_por_numero = {s.numero_nota: s for s in saidas}
    retornos_por_saida: dict = {}
    for r in retornos:
        if r.numero_nota_saida:
            retornos_por_saida.setdefault(r.numero_nota_saida, []).append(r)

    pares = []
    sem_vinculo = []
    for r in retornos:
        if not r.numero_nota_saida or r.numero_nota_saida not in saidas_por_numero:
            sem_vinculo.append(r)
            continue
        s = saidas_por_numero[r.numero_nota_saida]
        pares.append({
            "nota_saida": s.numero_nota,
            "data_saida": s.data_nota,
            "nota_retorno": r.numero_nota,
            "data_retorno": r.data_nota,
            "fornecedor": r.fornecedor,
            "dias_lead_time": calcular_lead_time_dias(s.data_nota, r.data_nota),
        })

    # Todas as notas de saída aparecem aqui — não somem mais assim que um
    # retorno é vinculado, já que pode ter mais de um (devolução parcial).
    notas_saida = [
        {
            "numero_nota": s.numero_nota,
            "data_nota": s.data_nota,
            "fornecedor": s.fornecedor,
            "retornos_vinculados": len(retornos_por_saida.get(s.numero_nota, [])),
        }
        for s in saidas
    ]
    aguardando_retorno_n = sum(1 for n in notas_saida if n["retornos_vinculados"] == 0)

    dias_lista = [p["dias_lead_time"] for p in pares]
    stats = {
        "total_pares": len(pares),
        "lead_time_medio": round(sum(dias_lista) / len(dias_lista), 1) if dias_lista else 0,
        "lead_time_minimo": min(dias_lista) if dias_lista else 0,
        "lead_time_maximo": max(dias_lista) if dias_lista else 0,
        "aguardando_retorno_n": aguardando_retorno_n,
        "sem_vinculo_n": len(sem_vinculo),
    }

    pares.sort(key=lambda p: p["data_retorno"], reverse=True)
    notas_saida.sort(key=lambda n: n["data_nota"], reverse=True)
    sem_vinculo.sort(key=lambda r: r.data_nota, reverse=True)

    return {
        "pares": pares,
        "notas_saida": notas_saida,
        "sem_vinculo": sem_vinculo,
        "stats": stats,
    }
