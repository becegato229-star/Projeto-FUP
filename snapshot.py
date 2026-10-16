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
from .models import FupRegistro, Pedido, SnapshotPedidoDiario

HORARIO_CAPTURA = (23, 50)  # hora, minuto — sempre no fuso do Brasil


def ja_capturou_hoje(session: Session) -> bool:
    hoje = hoje_brasil()
    existe = session.exec(
        select(SnapshotPedidoDiario).where(SnapshotPedidoDiario.data == hoje)
    ).first()
    return existe is not None


def _atrasado_para_snapshot(numero_pedido: str, session: Session) -> bool:
    """Se o pedido conta como 'atrasado' no retrato diário — critério
    DIFERENTE do usado nos filtros normais da tela. Aqui, quem decide é a
    situação do ÚLTIMO registro de FUP, uma revisão manual, não o cálculo
    automático de calendário:

    - Sem nenhum FUP registrado -> Ok (não atrasado)
    - Último FUP com situação "Ok" -> Ok (não atrasado), mesmo que a data
      já tenha passado
    - Último FUP "Previsto atraso" ou "Atraso" -> atrasado
    - Registro antigo sem 'situacao' salva -> trata como atraso (mesma
      regra usada em outros lugares do sistema pra manter compatibilidade)

    Os filtros normais (aba Todos, "Atrasados", etc) continuam usando
    Pedido.atraso_producao/dias_atraso_producao sem nenhuma mudança — essa
    função só afeta o que fica gravado no histórico diário."""
    ultimo_fup = session.exec(
        select(FupRegistro)
        .where(FupRegistro.numero_pedido == numero_pedido)
        .order_by(FupRegistro.data_referencia.desc(), FupRegistro.id.desc())
    ).first()
    if ultimo_fup is None:
        return False
    situacao = ultimo_fup.situacao or "atraso"
    return situacao in ("previsto_atraso", "atraso")


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
            atraso_producao=_atrasado_para_snapshot(p.numero_pedido, session),
            # dias_atraso_producao continua sendo o cálculo de calendário puro,
            # só informativo aqui — não é o que decide se conta como atraso
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
