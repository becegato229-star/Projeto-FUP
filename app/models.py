from datetime import date, datetime
from .fuso import hoje_brasil
from typing import List, Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import UniqueConstraint


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

    # --- v2 (colunas novas, vazias nos pedidos antigos) ---
    vendedor: Optional[str] = None               # "Nome representante" da Carteira de pedidos
    transportadora_nome: Optional[str] = None    # "Nome transportadora" da Carteira de pedidos
    nova_data_quem: Optional[str] = None         # quem pediu a nova data: "Cliente" | "MUBEC"
    nova_data_motivo: Optional[str] = None
    nova_data_por: Optional[str] = None          # quem registrou a nova data
    cancelado_por: Optional[str] = None
    aguardando_cliente_desde: Optional[date] = None   # v2 (25/11): pronto, depende do cliente -> não é atraso
    aguardando_cliente_motivo: Optional[str] = None
    aguardando_cliente_por: Optional[str] = None
    uf: Optional[str] = None                     # "U.F." do Dashboard de vendas (pela NF)
    municipio: Optional[str] = None              # "Município" do Dashboard de vendas (pela NF)

    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FupRegistro(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    numero_pedido: str = Field(index=True, foreign_key="pedido.numero_pedido")
    data_referencia: date = Field(default_factory=hoje_brasil)
    previsao_atraso: bool = False  # mantido por compatibilidade com registros antigos; não usado mais
    situacao: Optional[str] = None  # "ok" | "previsto_atraso" | "atraso" — None = registro antigo (trata como "atraso")
    motivo_atraso: Optional[str] = None
    observacao: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    registrado_por: Optional[str] = None  # v2: nome de quem registrou (vazio nos antigos)


class FupRegistroCreate(SQLModel):
    """Schema de entrada da API — separado do modelo de tabela para evitar
    um bug do SQLModel/FastAPI onde datas recebidas via JSON não são
    convertidas corretamente de string para date antes do INSERT."""
    numero_pedido: str
    data_referencia: date = Field(default_factory=hoje_brasil)
    situacao: str  # "ok" | "previsto_atraso" | "atraso"
    motivo_atraso: Optional[str] = None
    observacao: Optional[str] = None


class MotivoFup(SQLModel, table=True):
    """Lista de motivos de atraso, gerenciável pelo próprio usuário (adicionar,
    editar, apagar) — substitui a lista fixa que só eu conseguia mudar."""
    id: Optional[int] = Field(default=None, primary_key=True)
    texto: str = Field(unique=True)
    # v2: motivo já usado em FUP não se apaga, só se desativa (some dos
    # formulários e continua no histórico). None = registro antigo = ativo.
    ativo: Optional[bool] = True


class MotivoFupCreate(SQLModel):
    texto: str


class AvisoRegistro(SQLModel, table=True):
    """Investigação de um Aviso (pedido faturado, sem canhoto, além do prazo
    esperado). Separado do FUP porque é um contexto de negócio diferente:
    FUP é sobre atraso de produção, Aviso é sobre atraso de coleta/entrega
    pós-faturamento."""
    id: Optional[int] = Field(default=None, primary_key=True)
    numero_pedido: str = Field(index=True, foreign_key="pedido.numero_pedido")
    data_registro: date = Field(default_factory=hoje_brasil)
    motivo: str                                  # texto livre, ex: "liguei pra transportadora, falou X"
    proxima_data_limite: Optional[date] = None    # "soneca": se passar sem canhoto, volta pra lista de Avisos
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # v2 (vazios nos registros antigos): NF a que o acompanhamento se refere
    # (vazio = vale para todas as NFs do pedido) e quem registrou
    nf: Optional[str] = None
    registrado_por: Optional[str] = None


class AvisoRegistroCreate(SQLModel):
    """Schema de entrada — mesmo motivo do FupRegistroCreate (bug de data)."""
    numero_pedido: str
    data_registro: date = Field(default_factory=hoje_brasil)
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
class _CamposDanfe(SQLModel):
    """Campos extraídos do PDF da nota (DANFE) — tudo opcional, porque um
    registro pode ter sido criado no manual (sem PDF) ou o PDF pode não
    trazer algum campo específico. Compartilhado entre NotaSaida e
    NotaRetorno pra não duplicar a lista duas vezes."""
    chave_acesso: Optional[str] = Field(default=None, index=True)  # 44 dígitos, único por nota — identificador definitivo
    serie: Optional[str] = None
    cnpj_fornecedor: Optional[str] = None
    natureza_operacao: Optional[str] = None
    protocolo_autorizacao: Optional[str] = None
    data_autorizacao: Optional[str] = None  # "dd/mm/aaaa hh:mm:ss", só informativo
    data_saida_entrada: Optional[date] = None
    hora_saida: Optional[str] = None
    peso_bruto: Optional[float] = None
    peso_liquido: Optional[float] = None
    valor_total_produtos: Optional[float] = None
    valor_total_nota: Optional[float] = None
    valor_frete: Optional[float] = None
    valor_seguro: Optional[float] = None
    valor_desconto: Optional[float] = None
    valor_outras_despesas: Optional[float] = None
    valor_ipi: Optional[float] = None
    numero_fatura: Optional[str] = None
    parcelas_json: Optional[str] = None  # lista de {numero, vencimento, valor} serializada
    transportador_nome: Optional[str] = None
    transportador_cnpj: Optional[str] = None
    texto_bruto: Optional[str] = None  # texto completo extraído do PDF — rede de segurança, nada se perde


class NotaSaida(_CamposDanfe, table=True):
    """Nota de remessa: material saindo da Mubec pro fornecedor terceirizado."""
    numero_nota: str = Field(primary_key=True, index=True)
    data_nota: date
    fornecedor: str = Field(default="JJ LESTE GALVANIZACAO LTDA", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    apagada_em: Optional[datetime] = None  # v2: apagada na tela nova (some das listas; dá para desfazer)
    apagada_por: Optional[str] = None


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


class NotaRetorno(_CamposDanfe, table=True):
    """Nota de retorno: material processado voltando do fornecedor pra Mubec."""
    numero_nota: str = Field(primary_key=True, index=True)
    data_nota: date
    fornecedor: str = Field(default="JJ LESTE GALVANIZACAO LTDA", index=True)
    numero_nota_saida: Optional[str] = Field(default=None, index=True)  # vínculo, se encontrado
    informacoes_adicionais: Optional[str] = None  # texto colado, guardado pra referência/auditoria
    vinculo_manual: bool = False  # True se o vínculo foi escolhido manualmente (não veio da extração automática)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    apagada_em: Optional[datetime] = None  # v2: apagada na tela nova (some das listas; dá para desfazer)
    apagada_por: Optional[str] = None


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


class NotaItem(SQLModel, table=True):
    """Um item de uma nota (saída ou retorno), vindo da leitura do PDF.
    Não usa chave estrangeira de verdade porque referencia uma de duas
    tabelas (NotaSaida ou NotaRetorno) dependendo de `tipo_nota` — quem
    apaga/renomeia uma nota precisa cuidar manualmente de apagar/mover os
    itens correspondentes (ver apagar_nota_saida/retorno em main.py)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    numero_nota: str = Field(index=True)
    tipo_nota: str = Field(index=True)  # "saida" ou "retorno"
    codigo_produto: str = Field(index=True)
    descricao: Optional[str] = None
    ncm: Optional[str] = None
    cst: Optional[str] = None
    cfop: Optional[str] = None
    unidade: Optional[str] = None
    quantidade: Optional[float] = None
    valor_unitario: Optional[float] = None
    valor_total: Optional[float] = None
    base_icms: Optional[float] = None
    valor_icms: Optional[float] = None
    valor_ipi: Optional[float] = None
    peso_unitario: Optional[float] = None  # resolvido do catálogo (ProdutoCatalogo) na hora da importação
    peso_total: Optional[float] = None  # quantidade * peso_unitario, já calculado
    acabamento: Optional[str] = None  # só nota de saída: "GE" ou "BICRO" (vazio = GE) — como o item deve voltar da galvanização


class ProdutoCatalogo(SQLModel, table=True):
    """Catálogo de produtos (peso por unidade), importado da planilha
    Gd_Produtos do ERP. Reimportável a qualquer momento — cada importação
    atualiza (upsert) pelo código do item, nunca duplica."""
    codigo_item: str = Field(primary_key=True)
    descricao: Optional[str] = None
    ncm: Optional[str] = None
    unidade: Optional[str] = None
    peso_liquido: Optional[float] = None
    peso_bruto: Optional[float] = None
    atualizado_em: datetime = Field(default_factory=datetime.utcnow)


class NotaPdfItemPayload(SQLModel):
    """Um item, no formato que viaja entre a pré-visualização da leitura do
    PDF e a confirmação de importação (o usuário pode revisar antes)."""
    codigo_produto: str
    descricao: Optional[str] = None
    ncm: Optional[str] = None
    cst: Optional[str] = None
    cfop: Optional[str] = None
    unidade: Optional[str] = None
    quantidade: Optional[float] = None
    valor_unitario: Optional[float] = None
    valor_total: Optional[float] = None
    base_icms: Optional[float] = None
    valor_icms: Optional[float] = None
    valor_ipi: Optional[float] = None


class NotaPdfPayload(SQLModel):
    """Dados de uma nota lidos do PDF — devolvidos pela pré-visualização
    (/importar-pdf) e reenviados pra confirmação (/confirmar-importacao),
    já com qualquer correção que o usuário tenha feito na revisão."""
    numero_nota: Optional[str] = None
    data_nota: Optional[date] = None
    fornecedor: Optional[str] = None
    serie: Optional[str] = None
    chave_acesso: Optional[str] = None
    cnpj_fornecedor: Optional[str] = None
    natureza_operacao: Optional[str] = None
    protocolo_autorizacao: Optional[str] = None
    data_autorizacao: Optional[str] = None
    data_saida_entrada: Optional[date] = None
    hora_saida: Optional[str] = None
    peso_bruto: Optional[float] = None
    peso_liquido: Optional[float] = None
    valor_total_produtos: Optional[float] = None
    valor_total_nota: Optional[float] = None
    valor_frete: Optional[float] = None
    valor_seguro: Optional[float] = None
    valor_desconto: Optional[float] = None
    valor_outras_despesas: Optional[float] = None
    valor_ipi: Optional[float] = None
    numero_fatura: Optional[str] = None
    parcelas: list = []
    transportador_nome: Optional[str] = None
    transportador_cnpj: Optional[str] = None
    informacoes_complementares: Optional[str] = None
    numero_nota_saida: Optional[str] = None  # só faz sentido pra retorno; o vínculo final (auto ou corrigido na revisão)
    vinculo_detectado_automaticamente: Optional[str] = None  # o que a extração achou sozinha, pra comparar
    texto_bruto: Optional[str] = None
    pdf_token: Optional[str] = None  # arquivo PDF guardado temporariamente na pré-visualização; vira definitivo ao confirmar
    itens: List[NotaPdfItemPayload] = []


# =======================================================================
# Cobrança — boletos vencidos, importados diariamente do relatório do banco.
# Totalmente independente do fluxo de Pedidos/Avisos/FUP.
# =======================================================================
class Boleto(SQLModel, table=True):
    """Um boleto vencido, identificado pelo 'Seu Número' (nosso próprio
    número de documento, único por boleto). Some da planilha diária = foi
    pago (regra automática); pode ser corrigido manualmente se estiver
    errado."""
    seu_numero: str = Field(primary_key=True, index=True)

    # --- Dados vindos da planilha do banco ---
    pagador: Optional[str] = None
    cnpj_cpf: Optional[str] = None
    tipo: Optional[str] = None
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
    proxima_cobranca: Optional[date] = None  # espelhado do último registro — quando ligar de novo

    # --- v2 (colunas novas, vazias nos boletos antigos) ---
    nosso_numero: Optional[str] = None     # "Nosso Número" do banco
    status_motivo: Optional[str] = None    # por que o status foi mudado à mão (obrigatório na v2)
    status_por: Optional[str] = None
    status_em: Optional[datetime] = None
    apagado_em: Optional[datetime] = None  # apagado na tela nova (some da lista; volta se reaparecer no relatório)
    apagado_por: Optional[str] = None

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
    seu_numero: str = Field(index=True, foreign_key="boleto.seu_numero")
    data_registro: date = Field(default_factory=hoje_brasil)
    motivo: str  # texto livre, ex: "liguei, cliente disse que paga sexta"
    proxima_data_cobranca: Optional[date] = None  # quando ligar de novo, se souber
    created_at: datetime = Field(default_factory=datetime.utcnow)
    registrado_por: Optional[str] = None  # v2
    grupo: Optional[str] = None           # v2: mesma conversa com o cliente, vários boletos


class CobrancaRegistroCreate(SQLModel):
    seu_numero: str
    data_registro: date = Field(default_factory=hoje_brasil)
    motivo: str
    proxima_data_cobranca: Optional[date] = None


# =======================================================================
# Snapshot diário — retrato de cada pedido ativo, guardado uma vez por dia.
# Existe porque o estado atual do pedido (status, atraso_producao, etc) é
# sempre recalculado por cima do valor anterior — sem isso, não tem como
# reconstruir "como estava a operação há 2 meses", só o momento atual.
# =======================================================================
class SnapshotPedidoDiario(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    data: date = Field(index=True)
    numero_pedido: str = Field(index=True)
    status: Optional[str] = None
    atraso_producao: bool = False
    dias_atraso_producao: int = 0
    tipo_entrega: Optional[str] = None
    nome_cliente: Optional[str] = None


# =======================================================================
# Verificação de transportadora — controle independente do "Aviso" de
# canhoto: assim que um pedido Transportadora é Faturado, precisa de
# confirmação manual de que a coleta foi chamada, sem esperar dia nenhum
# (diferente do Aviso, que só dispara depois de X dias sem canhoto).
# =======================================================================
class TransportadoraRegistro(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    numero_pedido: str = Field(index=True, foreign_key="pedido.numero_pedido")
    data_registro: date = Field(default_factory=hoje_brasil)
    chamado: bool = False
    quem_chamou: Optional[str] = None
    observacao: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # v2 (vazios nos registros antigos; antigo com chamado=True = "coleta chamada")
    nf: Optional[str] = None                       # vazio = vale para todas as NFs do pedido
    evento: Optional[str] = None                   # "chamada" | "coletado"
    hora: Optional[str] = None                     # "HH:MM" da chamada
    codigo_coleta: Optional[str] = None
    previsao_retirada: Optional[date] = None
    registrado_por: Optional[str] = None


class TransportadoraRegistroCreate(SQLModel):
    numero_pedido: str
    data_registro: date = Field(default_factory=hoje_brasil)
    chamado: bool = False
    quem_chamou: Optional[str] = None
    observacao: Optional[str] = None


class ItemAcabamentoPayload(SQLModel):
    acabamento: str  # "GE" ou "BICRO"


# =======================================================================
# v2 — Configurações (prazos, feriados, listas, senha, histórico de
# importações e backups). Tudo em tabelas novas: o banco antigo não muda.
# =======================================================================
class Configuracao(SQLModel, table=True):
    """Pares chave/valor: prazos editáveis e o hash da senha de
    administrador. Valor ausente = usa o padrão do código."""
    chave: str = Field(primary_key=True)
    valor: Optional[str] = None
    atualizado_em: datetime = Field(default_factory=datetime.utcnow)
    atualizado_por: Optional[str] = None


class Feriado(SQLModel, table=True):
    """Dia que não conta como dia útil (atrasos, avisos, prazos)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    data: date = Field(index=True, unique=True)
    nome: str
    abrangencia: Optional[str] = None  # "Nacional", "Estadual · SP", "Municipal · São Paulo", "Ponte / recesso da MUBEC"
    criado_em: datetime = Field(default_factory=datetime.utcnow)
    criado_por: Optional[str] = None


class OpcaoLista(SQLModel, table=True):
    """Opções das listas usadas nos formulários (menos os motivos de FUP,
    que continuam na tabela MotivoFup por compatibilidade com a tela antiga)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    lista: str = Field(index=True)  # "problemas" | "solucoes" | "causas" | "responsaveis" | "quemchama"
    texto: str
    ativo: Optional[bool] = True
    fixo: Optional[bool] = False  # "Outro": não pode ser apagado nem desativado
    ordem: Optional[int] = 0
    criado_em: datetime = Field(default_factory=datetime.utcnow)


class ImportacaoRegistro(SQLModel, table=True):
    """Histórico de importações (planilhas e PDFs), para a aba Importar."""
    id: Optional[int] = Field(default=None, primary_key=True)
    tipo: str = Field(index=True)  # "follow" | "oe" | "expedicao" | "carteira" | "boletos" | "catalogo" | "pdfs"
    arquivo: Optional[str] = None
    quando: datetime = Field(default_factory=datetime.utcnow)
    por: Optional[str] = None
    resumo: Optional[str] = None
    avisos_json: Optional[str] = None  # lista de textos


class BackupRegistro(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    quando: datetime = Field(default_factory=datetime.utcnow)
    por: Optional[str] = None
    arquivo: Optional[str] = None
    tamanho_bytes: Optional[int] = None


# =======================================================================
# v2 — várias NFs por pedido e itens do pedido (tabelas novas)
# =======================================================================
class NotaFiscalPedido(SQLModel, table=True):
    """Uma NF de um pedido (entrega parcial = várias NFs). Vem da planilha
    Pedidos Mubec 2.0 (aba Expedição). NF cancelada continua aqui, marcada."""
    __table_args__ = (UniqueConstraint("numero_pedido", "nf", name="uq_nf_pedido"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    numero_pedido: str = Field(index=True)
    nf: str = Field(index=True)
    data_faturamento: Optional[date] = None
    data_entrega: Optional[date] = None
    canhoto: Optional[str] = None
    cancelada: Optional[bool] = False
    cancelada_motivo: Optional[str] = None
    cancelada_em: Optional[datetime] = None
    cancelada_por: Optional[str] = None
    origem: Optional[str] = None  # "planilha" | "migracao" (veio do campo nf antigo do pedido)
    # True = o pedido veio na última planilha da expedição e esta NF não veio
    # (ex.: número digitado errado e corrigido). Não conta, mas não é apagada.
    fora_da_planilha: Optional[bool] = False
    atualizado_em: datetime = Field(default_factory=datetime.utcnow)


class PedidoItem(SQLModel, table=True):
    """Um item de pedido, da Carteira de pedidos (Gd_Edicao). Quando o
    pedido sai da carteira (faturado), os itens ficam guardados com
    na_carteira = False — nunca são apagados por isso."""
    id: Optional[int] = Field(default=None, primary_key=True)
    numero_pedido: str = Field(index=True)
    linha: int = 0                        # ordem dentro do pedido (linhas repetidas ficam as duas)
    codigo_item: Optional[str] = None
    alternativo: Optional[str] = None
    descricao: Optional[str] = None
    quantidade: Optional[float] = None
    unidade: Optional[str] = None
    data_entrega: Optional[date] = None
    situacao_item: Optional[str] = None
    na_carteira: Optional[bool] = True
    origem: Optional[str] = "carteira"
    atualizado_em: datetime = Field(default_factory=datetime.utcnow)


class ItemFaturado(SQLModel, table=True):
    """Um item de nota fiscal de venda, do Dashboard de vendas do Mega.
    A planilha não traz o número do pedido: liga ao pedido pela NF (que vem
    da planilha da expedição). Chave: NF + "Seq. Item NF". Nunca é apagado."""
    __table_args__ = (UniqueConstraint("nf", "seq", name="uq_item_faturado"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    nf: str = Field(index=True)
    seq: int = 0
    data_emissao: Optional[date] = None
    codigo_item: Optional[str] = None
    alternativo: Optional[str] = None
    descricao: Optional[str] = None
    unidade: Optional[str] = None
    quantidade: Optional[float] = None
    valor_unitario: Optional[float] = None
    valor_total: Optional[float] = None
    cod_cliente: Optional[str] = None
    nome_cliente: Optional[str] = None
    cod_representante: Optional[str] = None
    nome_representante: Optional[str] = None
    uf: Optional[str] = None
    municipio: Optional[str] = None
    grupo_estoque: Optional[str] = None
    tipo_venda: Optional[str] = None
    atualizado_em: datetime = Field(default_factory=datetime.utcnow)


class CasoPosVenda(SQLModel, table=True):
    """v2 — caso de pós-venda (problema depois da entrega). Coordenação: Norma.
    Status com as palavras dela: Encontrar solução → Em andamento → Resolvido / Recusado."""
    id: Optional[int] = Field(default=None, primary_key=True)
    numero: str = Field(index=True, unique=True)          # "PV-001"
    aberto_em: date = Field(default_factory=hoje_brasil)
    aberto_por: Optional[str] = None
    numero_pedido: Optional[str] = Field(default=None, index=True)
    nf: Optional[str] = Field(default=None, index=True)
    cliente: Optional[str] = None
    vendedor: Optional[str] = None
    tipo_entrega: Optional[str] = None
    canhoto_em: Optional[date] = None                     # data da entrega com canhoto (início dos 30 dias)
    justificativa: Optional[str] = None                   # aberto fora do prazo de 30 dias
    problema: Optional[str] = None
    descricao: Optional[str] = None                       # o que o cliente disse
    contato: Optional[str] = None
    telefone: Optional[str] = None
    responsavel: Optional[str] = None
    prazo_solucao: Optional[date] = None
    status: str = "Encontrar solução"
    solucao: Optional[str] = None
    causa: Optional[str] = None
    endereco: Optional[str] = None                        # para o romaneio (digitado)
    apagado_em: Optional[datetime] = None
    apagado_por: Optional[str] = None
    criado_em: datetime = Field(default_factory=datetime.utcnow)


class AtualizacaoPosVenda(SQLModel, table=True):
    """Uma atualização do caso (linha do tempo). Guarda o antes e o depois para o Desfazer."""
    id: Optional[int] = Field(default=None, primary_key=True)
    caso_id: int = Field(index=True)
    data: date = Field(default_factory=hoje_brasil)
    por: Optional[str] = None
    texto: str
    abertura: Optional[bool] = False                      # a abertura do caso não se desfaz
    status_antes: Optional[str] = None
    status_depois: Optional[str] = None
    solucao_antes: Optional[str] = None
    solucao_depois: Optional[str] = None
    causa_antes: Optional[str] = None
    causa_depois: Optional[str] = None
    responsavel_antes: Optional[str] = None
    responsavel_depois: Optional[str] = None
    prazo_antes: Optional[date] = None
    prazo_depois: Optional[date] = None
    desfeita_em: Optional[datetime] = None                # "Desfazer" não apaga: marca e some da linha do tempo
    desfeita_por: Optional[str] = None
    criado_em: datetime = Field(default_factory=datetime.utcnow)
