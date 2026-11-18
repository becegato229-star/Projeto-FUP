"""
v2 — regras das Configurações: prazos, feriados, listas, senha de
administrador e histórico de importações/backups.

Nada aqui apaga dado existente. Prazos sem valor salvo usam o padrão
(o mesmo que o FlowLog 1.0 usava fixo no código).
"""
import hashlib
import hmac
import json
import os
from datetime import date
from typing import Optional

from sqlmodel import Session, select

from .fuso import agora_brasil as _agora_brasil_tz
from .models import Configuracao, Feriado, OpcaoLista, ImportacaoRegistro

def agora_brasil():
    """Hora de Brasília sem fuso anexado (o SQLite guarda data/hora sem fuso)."""
    return _agora_brasil_tz().replace(tzinfo=None)


# ---------------------------------------------------------------------
# Prazos
# ---------------------------------------------------------------------
PRAZOS_PADRAO = {
    "aviso_entrega": 4,         # dias úteis sem canhoto até virar aviso (Entrega)
    "aviso_transportadora": 4,  # idem (Transportadora)
    "aviso_retira": 6,          # idem (Retira)
    "folga_retira": 1,          # dias corridos de folga antes de contar atraso de produção (Retira)
    "fup_janela": 2,            # "Para revisar": vence em até N dias úteis
    "posvenda_prazo": 30,       # dias corridos após o canhoto (só informativo)
}
PRAZOS_LIMITES = {
    "aviso_entrega": (1, 30), "aviso_transportadora": (1, 30), "aviso_retira": (1, 30),
    "folga_retira": (0, 10), "fup_janela": (0, 15), "posvenda_prazo": (1, 365),
}


def ler_prazos(session: Session) -> dict:
    prazos = dict(PRAZOS_PADRAO)
    for chave in PRAZOS_PADRAO:
        cfg = session.get(Configuracao, "prazo_" + chave)
        if cfg and cfg.valor is not None:
            try:
                prazos[chave] = int(cfg.valor)
            except ValueError:
                pass  # valor estragado: fica o padrão
    return prazos


def salvar_prazos(session: Session, novos: dict, por: Optional[str]) -> dict:
    for chave, valor in novos.items():
        if chave not in PRAZOS_PADRAO:
            raise ValueError(f"Prazo desconhecido: {chave}")
        minimo, maximo = PRAZOS_LIMITES[chave]
        try:
            valor = int(valor)
        except (TypeError, ValueError):
            raise ValueError(f"Valor inválido para {chave}")
        if not (minimo <= valor <= maximo):
            raise ValueError(f"{chave} precisa ficar entre {minimo} e {maximo}")
        cfg = session.get(Configuracao, "prazo_" + chave) or Configuracao(chave="prazo_" + chave)
        cfg.valor = str(valor)
        cfg.atualizado_em = agora_brasil()
        cfg.atualizado_por = por
        session.add(cfg)
    session.commit()
    return ler_prazos(session)


# ---------------------------------------------------------------------
# Feriados — semeados uma única vez (tabela vazia). Nacionais, estado de
# SP e cidade de São Paulo. Conferir a lista oficial antes de lançar.
# ---------------------------------------------------------------------
FERIADOS_INICIAIS = [
    ("2026-01-01", "Confraternização Universal", "Nacional"),
    ("2026-01-25", "Aniversário de São Paulo", "Municipal · São Paulo"),
    ("2026-04-03", "Sexta-feira Santa", "Nacional"),
    ("2026-04-21", "Tiradentes", "Nacional"),
    ("2026-05-01", "Dia do Trabalho", "Nacional"),
    ("2026-06-04", "Corpus Christi", "Municipal · São Paulo"),
    ("2026-07-09", "Revolução Constitucionalista", "Estadual · SP"),
    ("2026-09-07", "Independência", "Nacional"),
    ("2026-10-12", "Nossa Senhora Aparecida", "Nacional"),
    ("2026-11-02", "Finados", "Nacional"),
    ("2026-11-15", "Proclamação da República", "Nacional"),
    ("2026-11-20", "Consciência Negra", "Nacional"),
    ("2026-12-25", "Natal", "Nacional"),
    ("2027-01-01", "Confraternização Universal", "Nacional"),
    ("2027-01-25", "Aniversário de São Paulo", "Municipal · São Paulo"),
    ("2027-03-26", "Sexta-feira Santa", "Nacional"),
    ("2027-04-21", "Tiradentes", "Nacional"),
    ("2027-05-01", "Dia do Trabalho", "Nacional"),
    ("2027-05-27", "Corpus Christi", "Municipal · São Paulo"),
    ("2027-07-09", "Revolução Constitucionalista", "Estadual · SP"),
    ("2027-09-07", "Independência", "Nacional"),
    ("2027-10-12", "Nossa Senhora Aparecida", "Nacional"),
    ("2027-11-02", "Finados", "Nacional"),
    ("2027-11-15", "Proclamação da República", "Nacional"),
    ("2027-11-20", "Consciência Negra", "Nacional"),
    ("2027-12-25", "Natal", "Nacional"),
]


def _ja_semeado(session: Session, chave: str) -> bool:
    """Semeia uma única vez: se alguém apagar tudo depois, não volta sozinho."""
    return bool(session.get(Configuracao, "semeado_" + chave))


def _marcar_semeado(session: Session, chave: str) -> None:
    session.add(Configuracao(chave="semeado_" + chave, valor="1", atualizado_em=agora_brasil(), atualizado_por="sistema"))


def semear_feriados(session: Session) -> None:
    if _ja_semeado(session, "feriados"):
        return
    if not session.exec(select(Feriado)).first():
        for iso, nome, abrangencia in FERIADOS_INICIAIS:
            session.add(Feriado(data=date.fromisoformat(iso), nome=nome, abrangencia=abrangencia, criado_por="padrão"))
    _marcar_semeado(session, "feriados")
    session.commit()


def datas_feriados(session: Session) -> list:
    return [f.data for f in session.exec(select(Feriado)).all()]


# ---------------------------------------------------------------------
# Listas
# ---------------------------------------------------------------------
LISTAS = {
    "motivos": {"nome": "Motivos de atraso (FUP)", "onde": "Registrar FUP",
                "nota": "\"Outro\" é fixo: com ele a observação passa a ser obrigatória."},
    "problemas": {"nome": "Problemas do pós-venda", "onde": "Novo caso de pós-venda", "nota": ""},
    "solucoes": {"nome": "Soluções do pós-venda", "onde": "Atualização de caso", "nota": ""},
    "causas": {"nome": "Causas do pós-venda", "onde": "Encerrar caso", "nota": ""},
    "responsaveis": {"nome": "Quem resolve (pós-venda)", "onde": "Novo caso e atualização",
                     "nota": "Pessoa que saiu da empresa: desative. Os casos antigos continuam com o nome dela."},
    "quemchama": {"nome": "Quem chama a coleta", "onde": "Registrar coleta chamada", "nota": ""},
}
LISTAS_INICIAIS = {
    "problemas": ["Quantidade faltando", "Quantidade a mais", "Material errado", "Defeito / qualidade",
                  "Atraso na entrega", "Atraso da transportadora", "Avaria no transporte", "NF de devolução",
                  "Erro na NF", "Outro"],
    "solucoes": ["Troca", "Reenvio do que faltou", "Devolução com NF", "Abatimento no boleto",
                 "Prorrogação do boleto", "Carta de correção", "NF de conserto", "Novo banho / retrabalho",
                 "Visita ao cliente", "Outro"],
    "causas": ["Produção", "Expedição", "Vendas", "Transportadora", "Terceirização", "Cliente"],
    "responsaveis": ["Norma", "Calebe", "Silvia", "Expedição", "Vendedor do pedido"],
    "quemchama": ["Rian", "Elizeu", "Outro"],
}


def semear_listas(session: Session) -> None:
    for lista, textos in LISTAS_INICIAIS.items():
        if _ja_semeado(session, "lista_" + lista):
            continue
        if not session.exec(select(OpcaoLista).where(OpcaoLista.lista == lista)).first():
            for i, texto in enumerate(textos):
                session.add(OpcaoLista(lista=lista, texto=texto, ordem=i, ativo=True, fixo=(texto == "Outro")))
        _marcar_semeado(session, "lista_" + lista)
    session.commit()


# ---------------------------------------------------------------------
# Senha de administrador (protege backup e mudanças nas Configurações).
# Guardada só como hash PBKDF2 com sal — nunca a senha em si.
# ---------------------------------------------------------------------
_CHAVE_SENHA = "senha_admin"
_ITERACOES = 200_000


def _hash(senha: str, sal: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), sal, _ITERACOES).hex()


def senha_definida(session: Session) -> bool:
    cfg = session.get(Configuracao, _CHAVE_SENHA)
    return bool(cfg and cfg.valor)


# Limite de tentativas: 5 senhas erradas seguidas -> espera 1 minuto.
# Em memória (zera se o servidor reiniciar) — suficiente para impedir
# alguém de testar milhares de senhas pelo link.
_TENTATIVAS = {"erros": 0, "bloqueado_ate": 0.0}


class SenhaBloqueada(Exception):
    pass


def conferir_senha(session: Session, senha: Optional[str]) -> bool:
    import time
    agora = time.time()
    if agora < _TENTATIVAS["bloqueado_ate"]:
        raise SenhaBloqueada()
    certa = _conferir_senha_sem_limite(session, senha)
    if certa:
        _TENTATIVAS["erros"] = 0
    elif senha:
        _TENTATIVAS["erros"] += 1
        if _TENTATIVAS["erros"] >= 5:
            _TENTATIVAS["erros"] = 0
            _TENTATIVAS["bloqueado_ate"] = agora + 60
    return certa


def _conferir_senha_sem_limite(session: Session, senha: Optional[str]) -> bool:
    cfg = session.get(Configuracao, _CHAVE_SENHA)
    if not cfg or not cfg.valor or not senha:
        return False
    try:
        sal_hex, hash_hex = cfg.valor.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(_hash(senha, bytes.fromhex(sal_hex)), hash_hex)


def definir_senha(session: Session, nova: str, por: Optional[str]) -> None:
    if len(nova or "") < 8:
        raise ValueError("A senha precisa ter pelo menos 8 caracteres.")
    sal = os.urandom(16)
    cfg = session.get(Configuracao, _CHAVE_SENHA) or Configuracao(chave=_CHAVE_SENHA)
    cfg.valor = sal.hex() + "$" + _hash(nova, sal)
    cfg.atualizado_em = agora_brasil()
    cfg.atualizado_por = por
    session.add(cfg)
    session.commit()


# ---------------------------------------------------------------------
# Histórico de importações
# ---------------------------------------------------------------------
def registrar_importacao(session: Session, tipo: str, arquivo: Optional[str], resumo: str,
                         avisos: Optional[list] = None, por: Optional[str] = None) -> None:
    """Nunca deixa uma falha no histórico estragar a importação em si."""
    try:
        session.add(ImportacaoRegistro(
            tipo=tipo, arquivo=arquivo, quando=agora_brasil(), por=por, resumo=resumo,
            avisos_json=json.dumps(avisos or [], ensure_ascii=False),
        ))
        session.commit()
    except Exception:
        session.rollback()
