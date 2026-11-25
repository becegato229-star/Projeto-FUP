"""
Motor de importação e cruzamento das 3 planilhas do FlowLog.

Detecta automaticamente qual das 3 planilhas foi enviada, com base
nas colunas presentes, e atualiza (upsert) a tabela Pedido.
"""
from datetime import date, datetime, timedelta
import re
import numpy as np
import pandas as pd
from sqlmodel import Session, select

from .models import Pedido, NotaFiscalPedido, PedidoItem, ItemFaturado
from .fuso import hoje_brasil
from .configuracoes import ler_prazos, datas_feriados

# Dias úteis desde o faturamento a partir dos quais aparece um "Aviso"
# (pedido faturado, sem canhoto, além do prazo esperado pro tipo de entrega).
# Baseado em análise real de dados históricos (ago/2026).
LIMITES_AVISO_POR_TIPO = {
    "Entrega": 4,
    "Transportadora": 4,
    "Retira": 6,
}
LIMITE_AVISO_PADRAO = 4  # usado se o tipo de entrega vier desconhecido


# ---------------------------------------------------------------------
# Detecção do tipo de planilha
# ---------------------------------------------------------------------
def _achar_coluna(colunas, nome_alvo: str):
    """Acha uma coluna pelo nome, ignorando maiúsculas/minúsculas (ex: 'Pedido' == 'pedido')."""
    for c in colunas:
        if c.strip().lower() == nome_alvo.strip().lower():
            return c
    return None


def detectar_tipo_planilha(df: pd.DataFrame) -> str:
    cols = set(c.strip() for c in df.columns)

    # v2: Dashboard de vendas (uma linha por item de NF; também vem como "Gd_Edicao")
    if {"Nº Nota Fiscal", "Seq. Item NF"}.issubset(cols):
        return "vendas"
    # v2: Carteira de pedidos (o Mega chama de "Gd_Edicao"; reconhece pelas colunas)
    if {"Documento de Venda", "Código do item"}.issubset(cols):
        return "carteira"
    if {"Nº do documento", "Situação"}.issubset(cols):
        return "follow_up_vendas"
    if {"Cód. da OE", "Cód. do pedido"}.issubset(cols):
        return "oe"
    if _achar_coluna(cols, "Pedido") and {"NF", "Canhoto"}.issubset(cols):
        return "pedidos_mubec"
    # Fallback: aceita mesmo se não achar nenhuma coluna parecida com "Pedido"
    # (ex: cabeçalho corrompido com texto errado colado por engano) — mas
    # exige um conjunto maior de colunas exclusivas dessa planilha específica,
    # pra não confundir com outra aba parecida do mesmo arquivo.
    if {"NF", "Canhoto", "CLIENTE", "Data de\nFaturamento", "Data de\nentrega"}.issubset(cols):
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
    texto = str(value).strip()
    try:
        # "2026-11-04" (ano primeiro) não pode virar 11/04: só usa dia-primeiro em "04/11/2026"
        if re.match(r"^\d{4}-\d{2}-\d{2}", texto):
            return pd.to_datetime(texto[:10], format="%Y-%m-%d").date()
        return pd.to_datetime(value, dayfirst=True).date()
    except Exception:
        return None


def _limpar_numero(valor) -> str | None:
    """Número de pedido/NF como texto, sem ".0" de planilha e sem ponto de
    milhar ("113.720" -> "113720")."""
    if valor is None or (not isinstance(valor, str) and pd.isna(valor)):
        return None
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    texto = str(valor).strip()
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", texto):
        return texto.replace(".", "")
    if re.fullmatch(r"\d+\.0+", texto):
        return texto.split(".")[0]
    return texto or None


def _nfs_da_celula(valor) -> list:
    """Uma célula de NF pode trazer mais de uma nota ("116611 / 116612").
    Devolve a lista de números (só dígitos, 4 ou mais)."""
    texto = _limpar_numero(valor)
    if not texto or texto.lower() == "nan":
        return []
    if re.fullmatch(r"\d+", texto):
        return [texto] if len(texto) >= 4 and int(texto) > 0 else []
    sem_milhar = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", texto)
    return re.findall(r"\d{4,}", sem_milhar)


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
    nf_cache: dict = {}
    # Normalmente a coluna se chama "Pedido" (às vezes "pedido", minúsculo).
    # Se não achar de jeito nenhum, cai pra primeira coluna da planilha, que
    # é sempre o pedido (cobre o caso de cabeçalho corrompido/texto errado).
    col_pedido = _achar_coluna(df.columns, "Pedido") or df.columns[0]

    for _, row in df.iterrows():
        numero_pedido_raw = row.get(col_pedido)
        if pd.isna(numero_pedido_raw):
            continue
        numero_pedido = str(numero_pedido_raw).split(".")[0]
        pedido = _get_or_create(session, numero_pedido, cache)

        # Campos principais desta planilha
        nf = row.get("NF")
        pedido.nf = str(nf).split(".")[0] if not pd.isna(nf) else pedido.nf
        # v2: cada NF do pedido guardada separadamente (entrega parcial = várias NFs)
        _guardar_nfs_da_linha(session, numero_pedido, row, nf_cache)
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
    _marcar_nfs_fora_da_planilha(session, nf_cache)
    ligar_vendas_aos_pedidos(session)
    return count


def _marcar_nfs_fora_da_planilha(session: Session, nf_cache: dict) -> None:
    """Para cada pedido que veio na planilha da expedição, a NF que já
    existia e não veio desta vez fica marcada "fora da planilha" (não conta
    para status nem aviso). Não apaga nada; se a NF voltar, volta a contar."""
    pedidos = {p for (p, _nf) in nf_cache}
    if not pedidos:
        return
    for nota in session.exec(select(NotaFiscalPedido).where(NotaFiscalPedido.numero_pedido.in_(list(pedidos)))).all():
        if (nota.numero_pedido, nota.nf) not in nf_cache and nota.origem in ("planilha", "migracao"):
            nota.fora_da_planilha = True
            session.add(nota)


def _numero_br(valor):
    """Quantidade da planilha: número, ou texto "1.234,5" / "1234.5"."""
    if valor is None or (not isinstance(valor, str) and pd.isna(valor)):
        return None
    if isinstance(valor, (int, float, np.integer, np.floating)):
        return float(valor)
    texto = str(valor).strip().replace(" ", "")
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    try:
        return float(texto)
    except ValueError:
        return None


def _guardar_nfs_da_linha(session: Session, numero_pedido: str, row, nf_cache: dict) -> None:
    """Cria ou atualiza a(s) NF(s) desta linha. Nunca apaga um canhoto ou
    uma data que já existiam por causa de uma célula vazia."""
    numeros = _nfs_da_celula(row.get("NF"))
    if not numeros:
        return
    faturamento = _to_date(row.get("Data de\nFaturamento"))
    entrega = _to_date(row.get("Data de\nentrega"))
    canhoto = row.get("Canhoto")
    canhoto = str(canhoto).strip() if not pd.isna(canhoto) and str(canhoto).strip() else None
    for numero in numeros:
        chave = (numero_pedido, numero)
        nota = nf_cache.get(chave)
        if nota is None:
            nota = session.exec(select(NotaFiscalPedido).where(
                NotaFiscalPedido.numero_pedido == numero_pedido, NotaFiscalPedido.nf == numero)).first()
        if nota is None:
            nota = NotaFiscalPedido(numero_pedido=numero_pedido, nf=numero, origem="planilha")
            session.add(nota)
        primeira_vez_na_planilha = nota.origem == "migracao" and chave not in nf_cache
        nf_cache[chave] = nota
        if primeira_vez_na_planilha:
            # a NF copiada do 1.0 pode ter recebido o canhoto/datas de outra NF
            # do mesmo pedido: na primeira vez que a planilha traz esta NF, ela manda
            nota.data_faturamento = faturamento
            nota.data_entrega = entrega
            nota.canhoto = canhoto
            nota.origem = "planilha"
        else:
            nota.data_faturamento = faturamento or nota.data_faturamento
            nota.data_entrega = entrega or nota.data_entrega
            nota.canhoto = canhoto or nota.canhoto
        nota.fora_da_planilha = False
        nota.atualizado_em = datetime.utcnow()


def migrar_nfs_antigas(session: Session) -> int:
    """Uma vez por pedido: o FlowLog 1.0 guardava só uma NF por pedido
    (campos nf/data_faturamento/canhoto do Pedido). Copia essa NF para a
    tabela nova, sem mexer no pedido. Pode rodar quantas vezes quiser."""
    com_nf = {n for n in session.exec(select(NotaFiscalPedido.numero_pedido)).all()}
    criadas = 0
    for p in session.exec(select(Pedido).where(Pedido.nf.is_not(None))).all():
        if p.numero_pedido in com_nf:
            continue
        for numero in _nfs_da_celula(p.nf):
            session.add(NotaFiscalPedido(
                numero_pedido=p.numero_pedido, nf=numero, data_faturamento=p.data_faturamento,
                data_entrega=p.data_entrega_real, canhoto=p.canhoto, origem="migracao",
            ))
            criadas += 1
        com_nf.add(p.numero_pedido)
    session.commit()
    return criadas


def importar_carteira(df: pd.DataFrame, session: Session) -> dict:
    """Carteira de pedidos: um item de pedido pendente por linha.
    - Pedido que está na planilha: os itens dele são trocados pelos da planilha.
    - Pedido que estava na carteira e não veio: os itens ficam guardados,
      marcados como "saiu da carteira" (faturado) — nunca são apagados.
    - Pedidos com situação "Aberto" são ignorados (decisão do Rian, 04/11).
    - Linhas repetidas ficam as duas."""
    agora = datetime.utcnow()
    cache: dict = {}
    por_pedido: dict = {}
    ignorados_aberto = set()
    for _, row in df.iterrows():
        numero = _limpar_numero(row.get("Documento de Venda"))
        if not numero or numero.lower() == "nan":
            continue
        sit_doc = str(row.get("Situação do documento", "") or "").strip()
        if sit_doc.lower() == "aberto":
            ignorados_aberto.add(numero)
            continue
        por_pedido.setdefault(numero, []).append(row)

    na_carteira_antes = set(session.exec(
        select(PedidoItem.numero_pedido).where(PedidoItem.na_carteira == True, PedidoItem.origem == "carteira")  # noqa: E712
    ).all())
    qtd_invalida = 0
    for numero, linhas in por_pedido.items():
        pedido = _get_or_create(session, numero, cache)
        primeira = linhas[0]
        rep_nome = str(primeira.get("Nome representante", "") or "").strip()
        transp = str(primeira.get("Nome transportadora", "") or "").strip()
        if rep_nome and rep_nome.lower() != "nan":
            pedido.vendedor = rep_nome
        if transp and transp.lower() != "nan":
            pedido.transportadora_nome = transp
        nome = primeira.get("Nome Fantasia")
        if not pedido.nome_cliente and nome is not None and not pd.isna(nome):
            pedido.nome_cliente = str(nome).strip()
        if not pedido.situacao_erp:
            sit = primeira.get("Situação do documento")
            pedido.situacao_erp = str(sit).strip() if sit is not None and not pd.isna(sit) else None
        # Nunca apaga: os itens antigos do pedido viram "saiu da carteira" e
        # cada linha da planilha reaproveita um item igual (código, quantidade,
        # data) ou cria um novo. O que não voltou fica guardado como saído.
        antigos = session.exec(select(PedidoItem).where(PedidoItem.numero_pedido == numero, PedidoItem.origem == "carteira")
                               .order_by(PedidoItem.linha, PedidoItem.id)).all()
        livres = list(antigos)
        for item in antigos:
            item.na_carteira = False
        for i, row in enumerate(linhas):
            qtd = _numero_br(row.get("Quantidade do documento"))
            if qtd is None and not pd.isna(row.get("Quantidade do documento")):
                qtd_invalida += 1
            codigo = _limpar_numero(row.get("Código do item"))
            entrega = _to_date(row.get("Data de entrega"))
            item = next((x for x in livres if x.codigo_item == codigo and x.quantidade == qtd and x.data_entrega == entrega), None)
            if item:
                livres.remove(item)
            else:
                item = PedidoItem(numero_pedido=numero, origem="carteira")
            item.linha = i
            item.codigo_item = codigo
            item.alternativo = _limpar_numero(row.get("Alternativo do item"))
            item.descricao = str(row.get("Descrição do item")).strip() if not pd.isna(row.get("Descrição do item")) else None
            item.quantidade = qtd
            item.unidade = str(row.get("Unidade")).strip() if not pd.isna(row.get("Unidade")) else None
            item.data_entrega = entrega
            item.situacao_item = str(row.get("Situação do item")).strip() if not pd.isna(row.get("Situação do item")) else None
            item.na_carteira = True
            item.atualizado_em = agora
            session.add(item)
        pedido.updated_at = agora

    avisos = []
    sairam = 0
    nao_vieram = na_carteira_antes - set(por_pedido) - ignorados_aberto
    parcial = len(na_carteira_antes) >= 10 and len(por_pedido) < 0.5 * len(na_carteira_antes)
    if parcial:
        avisos.append(
            f"A planilha tem {len(por_pedido)} pedidos e a carteira tinha {len(na_carteira_antes)}: parece uma exportação parcial "
            "(filtrada). Os itens dos pedidos que não vieram foram mantidos na carteira. Se ela estava completa, avise o Rian."
        )
    else:
        for item in session.exec(select(PedidoItem).where(PedidoItem.na_carteira == True, PedidoItem.origem == "carteira")).all():  # noqa: E712
            if item.numero_pedido in nao_vieram:
                item.na_carteira = False
                item.atualizado_em = agora
                session.add(item)
                sairam += 1
    if qtd_invalida:
        avisos.append(f"{qtd_invalida} linha(s) com quantidade ilegível ficaram sem quantidade.")

    total_itens = sum(len(v) for v in por_pedido.values())
    repetidas = 0
    for numero, linhas in por_pedido.items():
        vistos = set()
        for row in linhas:
            chave = (_limpar_numero(row.get("Código do item")), row.get("Quantidade do documento"), str(row.get("Data de entrega")))
            if chave in vistos:
                repetidas += 1
            vistos.add(chave)
    if repetidas:
        avisos.append(f"{repetidas} linha(s) repetida(s) (mesmo pedido, item, quantidade e data) foram mantidas como linhas separadas.")
    if ignorados_aberto:
        avisos.append(f"{len(ignorados_aberto)} pedido(s) com situação \"Aberto\" foram ignorados: " + ", ".join(sorted(ignorados_aberto)[:10]) + ".")
    return {
        "registros_processados": total_itens,
        "resumo": f"{total_itens} itens · {len(por_pedido)} pedidos" + (f" · {sairam} itens saíram da carteira" if sairam else ""),
        "avisos": avisos,
    }


def _texto(valor):
    if valor is None or (not isinstance(valor, str) and pd.isna(valor)):
        return None
    t = str(valor).strip()
    return t if t and t.lower() != "nan" else None


def importar_vendas(df: pd.DataFrame, session: Session) -> dict:
    """Dashboard de vendas: uma linha por item de nota fiscal.
    - Chave: NF + "Seq. Item NF". Linha que já existe é atualizada; nada é apagado.
    - Não tem o número do pedido: o item liga ao pedido pela NF (planilha da expedição)."""
    agora = datetime.utcnow()
    existentes = {(i.nf, i.seq): i for i in session.exec(select(ItemFaturado)).all()}
    novos = atualizados = sem_chave = 0
    nfs = set()
    vistos = set()
    for _, row in df.iterrows():
        nf = _limpar_numero(row.get("Nº Nota Fiscal"))
        seq_txt = _limpar_numero(row.get("Seq. Item NF"))
        if not nf or not seq_txt or not seq_txt.isdigit() or not nf.isdigit():
            sem_chave += 1
            continue
        chave = (nf, int(seq_txt))
        if chave in vistos:
            continue  # repetida na mesma planilha: vale a primeira
        vistos.add(chave)
        item = existentes.get(chave)
        if item:
            atualizados += 1
        else:
            item = ItemFaturado(nf=nf, seq=chave[1])
            existentes[chave] = item
            novos += 1
        nfs.add(nf)
        item.data_emissao = _to_date(row.get("Data de Emissão")) or item.data_emissao
        item.codigo_item = _limpar_numero(row.get("Item")) or item.codigo_item
        item.alternativo = _limpar_numero(row.get("Alternativo do Item")) or item.alternativo
        item.descricao = _texto(row.get("Descrição do Item")) or item.descricao
        item.unidade = _texto(row.get("Unidade")) or item.unidade
        qtd = _numero_br(row.get("Quantidade"))
        item.quantidade = qtd if qtd is not None else item.quantidade
        vu = _numero_br(row.get("Valor Unitário"))
        item.valor_unitario = vu if vu is not None else item.valor_unitario
        vt = _numero_br(row.get("Valor Total"))
        item.valor_total = vt if vt is not None else item.valor_total
        item.cod_cliente = _limpar_numero(row.get("Cód. Cliente")) or item.cod_cliente
        item.nome_cliente = _texto(row.get("Nome do Cliente")) or item.nome_cliente
        item.cod_representante = _limpar_numero(row.get("Cód. Representante")) or item.cod_representante
        item.nome_representante = _texto(row.get("Nome do Representante")) or item.nome_representante
        item.uf = _texto(row.get("U.F.")) or item.uf
        item.municipio = _texto(row.get("Município")) or item.municipio
        item.grupo_estoque = _texto(row.get("Grupo de Estoque")) or item.grupo_estoque
        item.tipo_venda = _texto(row.get("Tipo de Venda")) or item.tipo_venda
        item.atualizado_em = agora
        session.add(item)
    ligados = ligar_vendas_aos_pedidos(session)
    avisos = []
    if sem_chave:
        avisos.append(f"{sem_chave} linha(s) sem número de NF ou sem \"Seq. Item NF\" foram ignoradas.")
    sem_pedido = len(nfs) - ligados["nfs_com_pedido"]
    if sem_pedido > 0:
        avisos.append(f"{sem_pedido} NF(s) ainda não aparecem na planilha da expedição; os itens ficam guardados e "
                      "ligam ao pedido quando a NF chegar por ela.")
    return {
        "registros_processados": len(vistos),
        "resumo": f"{len(vistos)} itens · {len(nfs)} NFs · {novos} novos, {atualizados} atualizados",
        "avisos": avisos,
    }


def ligar_vendas_aos_pedidos(session: Session, nfs_alvo=None) -> dict:
    """Preenche no pedido o Estado (U.F.), o município e — só se estiver
    vazio — o vendedor, a partir dos itens faturados das NFs dele. A Carteira
    continua mandando no vendedor; aqui só completa o que falta."""
    session.flush()
    por_nf = {}
    for nf, uf, mun, rep in session.exec(select(ItemFaturado.nf, ItemFaturado.uf, ItemFaturado.municipio,
                                                ItemFaturado.nome_representante)).all():
        if nf not in por_nf or (uf and not por_nf[nf][0]):
            por_nf[nf] = (uf, mun, rep)
    if not por_nf:
        return {"nfs_com_pedido": 0}
    nfs_com_pedido = set()
    pedidos = {}
    for n in session.exec(select(NotaFiscalPedido).order_by(NotaFiscalPedido.data_faturamento, NotaFiscalPedido.id)).all():
        dados = por_nf.get(n.nf)
        if not dados:
            continue
        nfs_com_pedido.add(n.nf)
        pedidos[n.numero_pedido] = dados  # a NF mais recente vale
    for numero, (uf, mun, rep) in pedidos.items():
        p = session.get(Pedido, numero)
        if not p:
            continue
        mudou = False
        if uf and p.uf != uf:
            p.uf = uf; mudou = True
        if mun and p.municipio != mun:
            p.municipio = mun; mudou = True
        if rep and not p.vendedor:
            p.vendedor = rep; mudou = True
        if mudou:
            session.add(p)
    return {"nfs_com_pedido": len(nfs_com_pedido)}


IMPORTADORES = {
    "follow_up_vendas": importar_follow_up_vendas,
    "oe": importar_oe,
    "pedidos_mubec": importar_pedidos_mubec,
    "carteira": importar_carteira,
    "vendas": importar_vendas,
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
        resultado = {"tipo_detectado": tipo, "aba_usada": sheet_name}
        if isinstance(n, dict):
            resultado.update(n)
        else:
            resultado["registros_processados"] = n
        return resultado

    raise ValueError(
        "Nenhuma aba da planilha correspondeu a um formato conhecido. " + " | ".join(erros)
    )


# ---------------------------------------------------------------------
# Cálculo de status e atraso — roda depois de qualquer importação
# ---------------------------------------------------------------------
def _dias_uteis_entre(d1: date, d2: date, feriados=None) -> int:
    """Dias úteis entre d1 e d2 (seg–sex, menos os feriados cadastrados em
    Configurações). Mesma contagem do 1.0 (np.busday_count), só que agora
    descontando feriados."""
    if d2 <= d1:
        return 0
    return int(np.busday_count(d1, d2, holidays=feriados or []))


def recalcular_status_e_atrasos(session: Session) -> None:
    hoje = hoje_brasil()
    pedidos = session.exec(select(Pedido)).all()
    prazos = ler_prazos(session)
    feriados = datas_feriados(session)
    limites_aviso = {
        "Entrega": prazos["aviso_entrega"],
        "Transportadora": prazos["aviso_transportadora"],
        "Retira": prazos["aviso_retira"],
    }
    # v2: NFs de cada pedido (só as válidas) e pedidos com item ainda na carteira
    nfs_por_pedido: dict = {}
    tem_alguma_nf = set()
    for nota in session.exec(select(NotaFiscalPedido)).all():
        tem_alguma_nf.add(nota.numero_pedido)
        if not nota.cancelada and not nota.fora_da_planilha:
            nfs_por_pedido.setdefault(nota.numero_pedido, []).append(nota)
    na_carteira = set(session.exec(
        select(PedidoItem.numero_pedido).where(PedidoItem.na_carteira == True)  # noqa: E712
    ).all())

    for p in pedidos:
        # --- Status ---
        situacao_lower = (p.situacao_erp or "").lower()
        nfs = nfs_por_pedido.get(p.numero_pedido, [])
        # NF sem data de faturamento (ex.: número preenchido antes de faturar)
        # não muda nada: o pedido segue a regra antiga até a NF ser faturada
        faturou = any(n.data_faturamento for n in nfs) or bool(p.data_faturamento) or "faturado" in situacao_lower
        if nfs and not faturou:
            nfs = []
        # todas as NFs canceladas / fora da planilha: os campos antigos do
        # pedido (nf, canhoto, faturamento do 1.0) não valem mais
        so_nfs_invalidas = p.numero_pedido in tem_alguma_nf and not nfs_por_pedido.get(p.numero_pedido)
        if p.cancelado or "cancelado" in situacao_lower:
            p.status = "Cancelado"
        elif so_nfs_invalidas:
            if "faturado" in situacao_lower:
                p.status = "Faturado"
            elif "bloqueado" in situacao_lower:
                p.status = "Bloqueado"
            elif "aprovado" in situacao_lower or "aberto" in situacao_lower:
                p.status = "Aprovado"
            else:
                p.status = p.situacao_erp or "Indefinido"
        elif nfs:
            # v2: com NFs, só encerra quando TODAS as NFs válidas têm canhoto e
            # nada do pedido continua na carteira (entrega parcial não some mais)
            todas_com_canhoto = all(n.canhoto for n in nfs)
            p.status = "Encerrado" if todas_com_canhoto and p.numero_pedido not in na_carteira else "Faturado"
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

        # --- Atraso de produção: ainda não faturado e a data prevista já chegou ---
        # Pedidos "Retira" têm 1 dia de tolerância (o cliente pode buscar até
        # o próprio dia da data prevista); os demais tipos contam a partir do
        # próprio dia. A "nova data de entrega" é só informativa; não altera
        # se o pedido conta como atrasado.
        p.atraso_producao = False
        p.dias_atraso_producao = 0
        # v2 (25/11): o próprio dia prometido não é atraso para nenhum tipo (atrasa a
        # partir do dia seguinte). A Retira continua igual: a folga dela (padrão 1 dia)
        # já tirava o dia prometido. "Aguardando cliente" (marcado à mão) não é atraso.
        if p.status in ("Bloqueado", "Aprovado") and p.data_entrega_prevista and not p.aguardando_cliente_desde:
            folga = max(prazos["folga_retira"] - 1, 0) if p.tipo_entrega == "Retira" else 0
            esta_no_prazo_vencido = hoje > p.data_entrega_prevista + timedelta(days=folga)
            if esta_no_prazo_vencido:
                p.atraso_producao = True
                p.dias_atraso_producao = _dias_uteis_entre(p.data_entrega_prevista, hoje, feriados)

        # --- Aviso: faturado, sem canhoto, além do prazo esperado pro tipo de entrega ---
        p.aviso_entrega = False
        p.dias_uteis_desde_faturamento = 0
        limite = limites_aviso.get(p.tipo_entrega, LIMITE_AVISO_PADRAO)
        if nfs and p.status == "Faturado":
            # v2: aviso por NF — basta uma NF válida sem canhoto passar do prazo
            for n in nfs:
                if n.canhoto or not n.data_faturamento:
                    continue
                dias = _dias_uteis_entre(n.data_faturamento, hoje, feriados)
                p.dias_uteis_desde_faturamento = max(p.dias_uteis_desde_faturamento, dias)
                if dias >= limite:
                    p.aviso_entrega = True
        elif p.status == "Faturado" and p.data_faturamento and not p.canhoto and not so_nfs_invalidas:
            dias = _dias_uteis_entre(p.data_faturamento, hoje, feriados)
            p.dias_uteis_desde_faturamento = dias
            if dias >= limite:
                p.aviso_entrega = True

        session.add(p)

    session.commit()
