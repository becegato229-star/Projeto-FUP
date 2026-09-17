"""
Captura diária do estado dos pedidos ativos — a fundação pra permitir
análises históricas no futuro (ex: evolução mensal de % atrasado, aging
histórico de qualquer data passada) que o estado atual, sempre recalculado
por cima do valor anterior, não permite reconstruir sozinho.

Roda inteiramente dentro do próprio processo do FlowLog, sem depender de
n8n nem de nenhuma ferramenta externa: uma tarefa em segundo plano (inicia
junto com o servidor) dorme até o próximo horário de captura e tira o
retrato do dia. Se o servidor reiniciar perto da meia-noite e perder o
horário, o próprio startup do app confere se já existe uma captura pro
dia de hoje e, se não existir, tira na hora — nunca fica sem foto de um
dia inteiro só por causa de um reinício mal cronometrado.

Só captura pedidos "ativos" (Bloqueado/Aprovado) — é onde o conceito de
"atraso de produção" faz sentido; Faturado/Encerrado/Cancelado não entram.
"""
import asyncio
import traceback
from datetime import datetime, timedelta

from sqlmodel import Session, select

from .fuso import agora_brasil, hoje_brasil
from .models import Pedido, SnapshotPedidoDiario

HORARIO_CAPTURA = (23, 50)  # hora, minuto — sempre no fuso do Brasil


def ja_capturou_hoje(session: Session) -> bool:
    hoje = hoje_brasil()
    existe = session.exec(
        select(SnapshotPedidoDiario).where(SnapshotPedidoDiario.data == hoje)
    ).first()
    return existe is not None


def capturar_snapshot_do_dia(session: Session) -> int:
    """Salva um retrato de todo pedido ativo pro dia de hoje. Não faz nada
    se já existir uma captura pra hoje (evita duplicar se rodar mais de
    uma vez no mesmo dia — ex: startup + horário agendado coincidindo)."""
    if ja_capturou_hoje(session):
        return 0

    hoje = hoje_brasil()
    pedidos_ativos = session.exec(
        select(Pedido).where(Pedido.status.in_(["Bloqueado", "Aprovado"]))
    ).all()

    for p in pedidos_ativos:
        session.add(SnapshotPedidoDiario(
            data=hoje,
            numero_pedido=p.numero_pedido,
            status=p.status,
            atraso_producao=p.atraso_producao,
            dias_atraso_producao=p.dias_atraso_producao,
            tipo_entrega=p.tipo_entrega,
            nome_cliente=p.nome_cliente,
        ))
    session.commit()
    return len(pedidos_ativos)


def _proximo_horario_captura() -> datetime:
    agora = agora_brasil()
    hora, minuto = HORARIO_CAPTURA
    alvo = agora.replace(hour=hora, minute=minuto, second=0, microsecond=0)
    if alvo <= agora:
        alvo += timedelta(days=1)
    return alvo


async def loop_captura_diaria(engine):
    """Roda pra sempre em segundo plano, junto com o servidor: dorme até o
    próximo horário de captura (23:50, Brasil), tira o retrato, repete."""
    while True:
        alvo = _proximo_horario_captura()
        segundos_ate_alvo = (alvo - agora_brasil()).total_seconds()
        await asyncio.sleep(max(segundos_ate_alvo, 1))
        try:
            with Session(engine) as session:
                capturar_snapshot_do_dia(session)
        except Exception:
            # nunca deixa a tarefa em segundo plano morrer de vez por causa
            # de um erro pontual — tenta de novo no próximo horário
            traceback.print_exc()
