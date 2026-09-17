"""
Fuso horário do Brasil, centralizado — usado em todo lugar do sistema que
precisa saber "que dia é hoje" pra cálculo de negócio (atraso, avisos, FUP,
cobrança, nome de arquivo exportado, etc).

O motivo de existir: o servidor (Railway) roda o relógio em UTC, não no
horário de Brasília. Sem isso, `date.today()` do Python usa o relógio do
servidor — e como o Brasil está 3 horas atrás de UTC, o sistema "virava o
dia" 3 horas mais cedo do que deveria (por volta das 21h, já era o dia
seguinte no cálculo, mesmo ainda sendo "hoje" pra qualquer pessoa no
Brasil). Isso causava atraso calculado errado, e registros de FUP/aviso
datados com o dia errado quando lançados à noite.

Usa um deslocamento fixo de -3h (não um fuso horário "de verdade" via
biblioteca de timezone) de propósito: o Brasil não tem mais horário de
verão desde 2019, então -3h é sempre correto o ano inteiro, e isso evita
depender de um pacote de dados de fuso horário (tzdata) que pode não estar
instalado no ambiente do servidor.
"""
from datetime import date, datetime, timezone, timedelta

FUSO_BRASIL = timezone(timedelta(hours=-3))


def agora_brasil() -> datetime:
    return datetime.now(FUSO_BRASIL)


def hoje_brasil() -> date:
    return agora_brasil().date()
