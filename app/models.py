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
    nova_data_entrega: Optional[date] = None    # data renegociada manualmente (substitui a prevista no cálculo de atraso)

    # --- Calculado automaticamente ---
    status: Optional[str] = None                # Bloqueado / Aprovado / Faturado / Encerrado / Cancelado
    atraso_producao: bool = False
    dias_atraso_producao: int = 0
    aviso_entrega: bool = False                  # faturado, sem canhoto, além do prazo esperado pro tipo de entrega
    dias_uteis_desde_faturamento: int = 0
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


class FupRegistroCreate(SQLModel):
    """Schema de entrada da API — separado do modelo de tabela para evitar
    um bug do SQLModel/FastAPI onde datas recebidas via JSON não são
    convertidas corretamente de string para date antes do INSERT."""
    numero_pedido: str
    data_referencia: date = Field(default_factory=date.today)
    previsao_atraso: bool = False
    motivo_atraso: Optional[str] = None
    observacao: Optional[str] = None


class AvisoRegistro(SQLModel, table=True):
    """Investigação de um Aviso (pedido faturado, sem canhoto, além do prazo
    esperado). Separado do FUP porque é um contexto de negócio diferente:
    FUP é sobre atraso de produção, Aviso é sobre atraso de coleta/entrega
    pós-faturamento."""
    id: Optional[int] = Field(default=None, primary_key=True)
    numero_pedido: str = Field(index=True, foreign_key="pedido.numero_pedido")
    data_registro: date = Field(default_factory=date.today)
    motivo: str                                  # texto livre, ex: "liguei pra transportadora, falou X"
    proxima_data_limite: Optional[date] = None    # "soneca": se passar sem canhoto, volta pra lista de Avisos
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AvisoRegistroCreate(SQLModel):
    """Schema de entrada — mesmo motivo do FupRegistroCreate (bug de data)."""
    numero_pedido: str
    data_registro: date = Field(default_factory=date.today)
    motivo: str
    proxima_data_limite: Optional[date] = None


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


# =======================================================================
# Terceirização — lead time de industrialização (ex: zincagem na JJ Leste)
# Totalmente independente do fluxo de Pedidos.
# =======================================================================
class NotaSaida(SQLModel, table=True):
    """Nota de remessa: material saindo da Mubec pro fornecedor terceirizado."""
    numero_nota: str = Field(primary_key=True, index=True)
    data_nota: date
    fornecedor: str = Field(default="JJ LESTE GALVANIZACAO LTDA", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class NotaSaidaCreate(SQLModel):
    numero_nota: str
    data_nota: date
    fornecedor: str = "JJ LESTE GALVANIZACAO LTDA"


class NotaSaidaEditar(SQLModel):
    """Permite trocar até o número da nota (o identificador). Se o número
    mudar, os retornos já vinculados a essa saída são atualizados junto,
    pra não perder o vínculo."""
    numero_nota: str
    data_nota: date
    fornecedor: str


class NotaRetorno(SQLModel, table=True):
    """Nota de retorno: material processado voltando do fornecedor pra Mubec."""
    numero_nota: str = Field(primary_key=True, index=True)
    data_nota: date
    fornecedor: str = Field(default="JJ LESTE GALVANIZACAO LTDA", index=True)
    numero_nota_saida: Optional[str] = Field(default=None, index=True)  # vínculo, se encontrado
    informacoes_adicionais: Optional[str] = None  # texto colado, guardado pra referência/auditoria
    vinculo_manual: bool = False  # True se o vínculo foi escolhido manualmente (não veio da extração automática)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class NotaRetornoCreate(SQLModel):
    numero_nota: str
    data_nota: date
    fornecedor: str = "JJ LESTE GALVANIZACAO LTDA"
    numero_nota_saida: Optional[str] = None
    informacoes_adicionais: Optional[str] = None


class NotaRetornoEditar(SQLModel):
    """Permite trocar número, data, fornecedor e o vínculo (ou remover o
    vínculo, deixando None) de um lançamento já existente."""
    numero_nota: str
    data_nota: date
    fornecedor: str
    numero_nota_saida: Optional[str] = None
    informacoes_adicionais: Optional[str] = None


# =======================================================================
# Cobrança — boletos vencidos, importados diariamente do relatório do banco.
# Totalmente independente do fluxo de Pedidos/Avisos/FUP.
# =======================================================================
class Boleto(SQLModel, table=True):
    """Um boleto vencido, identificado pelo 'Nosso Número' (número único
    atribuído pelo banco). Some da planilha diária = foi pago (regra
    automática); pode ser corrigido manualmente se estiver errado."""
    nosso_numero: str = Field(primary_key=True, index=True)

    # --- Dados vindos da planilha do banco ---
    pagador: Optional[str] = None
    cnpj_cpf: Optional[str] = None
    tipo: Optional[str] = None
    seu_numero: Optional[str] = None
    carteira: Optional[str] = None
    data_emissao: Optional[date] = None
    data_vencimento: Optional[date] = None
    data_pagamento_banco: Optional[date] = None  # campo "Data Pagamento" do banco, se vier preenchido
    data_baixa: Optional[date] = None
    valor_titulo: Optional[float] = None
    valor_pago: Optional[float] = None
    status_planilha: Optional[str] = None  # texto cru vindo do banco (ex: "vencida")

    # --- Controlado pelo FlowLog ---
    status: str = "Em aberto"           # "Em aberto" | "Pago"
    data_pago_sistema: Optional[date] = None  # data em que sumiu da planilha (pagamento inferido)
    reapareceu: bool = False            # true = tinha sido marcado Pago e voltou a aparecer
    motivo_cobranca_recente: Optional[str] = None  # último motivo espelhado (facilita listagem)

    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BoletoEditar(SQLModel):
    """Edição manual de um boleto — inclusive corrigir o status, já que a
    regra automática pode errar (ex: negociação, não necessariamente pago)."""
    status: str
    data_vencimento: Optional[date] = None
    valor_titulo: Optional[float] = None
    valor_pago: Optional[float] = None
    data_pago_sistema: Optional[date] = None


class CobrancaRegistro(SQLModel, table=True):
    """Registro de cobrança feita ao cliente — mesmo espírito do FUP, mas
    específico do contexto de boletos vencidos."""
    id: Optional[int] = Field(default=None, primary_key=True)
    nosso_numero: str = Field(index=True, foreign_key="boleto.nosso_numero")
    data_registro: date = Field(default_factory=date.today)
    motivo: str  # texto livre, ex: "liguei, cliente disse que paga sexta"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CobrancaRegistroCreate(SQLModel):
    nosso_numero: str
    data_registro: date = Field(default_factory=date.today)
    motivo: str
