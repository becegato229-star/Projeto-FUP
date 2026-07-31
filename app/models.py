from datetime import date, datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class Pedido(SQLModel, table=True):
    # numero_pedido é a chave de cruzamento entre as 3 planilhas
    numero_pedido: str = Field(primary_key=True, index=True)

    # --- Vem da planilha "Follow up de vendas" (ERP Mega Senior) ---
    data_emissao: Optional[date] = None
    cod_cliente: Optional[str] = None
    nome_cliente: Optional[str] = None
    situacao_erp: Optional[str] = None          # texto cru vindo do ERP
    cod_transportadora: Optional[str] = None
    tipo_entrega: Optional[str] = None          # Entrega / Retira / Transportadora (derivado)

    # --- Vem da planilha "OE" (com reserva na planilha "Pedidos Mubec") ---
    numero_oe: Optional[str] = None
    data_entrega_prevista: Optional[date] = None

    # --- Vem da planilha "Pedidos Mubec" (aba Expedição) ---
    nf: Optional[str] = None
    data_faturamento: Optional[date] = None
    data_entrega_real: Optional[date] = None
    canhoto: Optional[str] = None

    # --- Preenchido manualmente no sistema ---
    cancelado: bool = False
    motivo_cancelamento: Optional[str] = None
    data_cancelamento: Optional[date] = None

    # --- Calculado automaticamente ---
    status: Optional[str] = None                # Bloqueado / Aprovado / Faturado / Encerrado / Cancelado
    atraso_producao: bool = False
    atraso_entrega: bool = False
    dias_atraso_producao: int = 0
    dias_atraso_entrega: int = 0
    motivo_atraso_fup: Optional[str] = None      # último motivo de atraso lançado no FUP (espelhado p/ facilitar filtro)

    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FupRegistro(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    numero_pedido: str = Field(index=True, foreign_key="pedido.numero_pedido")
    data_referencia: date = Field(default_factory=date.today)
    previsao_atraso: bool = False
    motivo_atraso: Optional[str] = None
    observacao: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# Lista pré-definida de motivos de atraso (usuário pode digitar texto livre também)
MOTIVOS_ATRASO_PADRAO = [
    "Falta de matéria-prima",
    "Fila de produção",
    "Problema de qualidade / retrabalho",
    "Falta de transportadora / veículo",
    "Cliente não retirou",
    "Pendência financeira do cliente",
    "Erro de pedido / especificação",
    "Manutenção de máquina",
    "Outro",
]
