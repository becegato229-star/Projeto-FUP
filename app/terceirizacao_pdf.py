"""
Leitura de DANFE (PDF de nota fiscal) de Terceirização — extrai tudo que o
documento oferece de útil: identificação da nota, pesos, valores, dados
fiscais, itens detalhados e o texto bruto completo (como rede de segurança,
caso algum campo não seja reconhecido).

Usa pdfplumber (puro Python, sem binário de sistema) em vez de pdftotext,
porque o Railway não garante poppler-utils instalado — só pacotes do
requirements.txt. A extração padrão do pdfplumber (sem layout) já devolve
uma linha por campo pro padrão de DANFE que a Sefaz exige, o que facilita
muito o parsing por regex linha a linha.

Importante: isto foi construído e testado contra um DANFE real de saída
(remessa pra industrialização, CFOP 5.901) e um de retorno (CFOP 5.124).
Caso um fornecedor emita notas com um layout visivelmente diferente (outro
software emissor), alguns campos podem não ser reconhecidos — por isso
TODO campo aqui é opcional e o texto bruto completo é sempre guardado, pra
nada se perder mesmo quando o parser não entende uma parte da nota.
"""
import re
from datetime import date, datetime
from typing import Optional

import pdfplumber

from .terceirizacao import extrair_numero_nota_saida, _normalizar_numero

# CFOPs padrão de remessa/retorno de industrialização por encomenda.
# 5.xxx/6.xxx = operação dentro do estado / interestadual.
CFOPS_SAIDA = {"5901", "6901", "5915", "6915"}
CFOPS_RETORNO = {"5124", "6124", "5902", "6902"}

RE_CHAVE_ACESSO = re.compile(r"(\d{4}(?:\s\d{4}){10})")
RE_NUMERO_NOTA = re.compile(r"Nº\s*([\d.]+)")
RE_SERIE = re.compile(r"Série\s+(\d+)")
RE_RECEBEMOS_DE = re.compile(r"RECEBEMOS DE (.+?) OS PRODUTOS", re.IGNORECASE)
RE_CNPJ = re.compile(r"(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})")
RE_DATA = re.compile(r"(\d{2}/\d{2}/\d{4})")
RE_HORA = re.compile(r"(\d{2}:\d{2}:\d{2})")
RE_MOEDA = re.compile(r"\d[\d.]*,\d{2,3}")

RE_ITEM = re.compile(
    r"^(\d+)\s+(.+?)\s+(\d{8})\s+(\d{2,4})\s+(\d\.\d{3})\s+([A-Za-z]{1,4})\s+"
    r"([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$"
)

NOME_MUBEC_TRECHO = "MUBEC"


def _num_br(texto: Optional[str]) -> Optional[float]:
    """Converte '1.775,10' -> 1775.10. Retorna None se não for número."""
    if not texto:
        return None
    try:
        return float(texto.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def _data_br(texto: Optional[str]) -> Optional[date]:
    if not texto:
        return None
    try:
        return datetime.strptime(texto, "%d/%m/%Y").date()
    except ValueError:
        return None


def _linha_apos(linhas: list, marcador: str, offset: int = 1) -> Optional[str]:
    """Acha a linha que contém `marcador` e devolve a linha `offset` posições
    depois (padrão: a linha seguinte) — é assim que o pdfplumber separa
    cabeçalho de tabela e os valores logo abaixo."""
    for i, l in enumerate(linhas):
        if marcador in l:
            idx = i + offset
            if 0 <= idx < len(linhas):
                return linhas[idx].strip()
    return None


def _extrair_itens(texto: str) -> list:
    itens = []
    for linha in texto.split("\n"):
        m = RE_ITEM.match(linha.strip())
        if not m:
            continue
        (codigo, descricao, ncm, cst, cfop, unidade, quant, vunit, vtotal,
         bc_icms, v_icms, v_ipi, aliq_icms, aliq_ipi) = m.groups()
        itens.append({
            "codigo_produto": _normalizar_numero(codigo),
            "descricao": descricao.strip(),
            "ncm": ncm,
            "cst": cst,
            "cfop": cfop.replace(".", ""),
            "unidade": unidade,
            "quantidade": _num_br(quant),
            "valor_unitario": _num_br(vunit),
            "valor_total": _num_br(vtotal),
            "base_icms": _num_br(bc_icms),
            "valor_icms": _num_br(v_icms),
            "valor_ipi": _num_br(v_ipi),
        })
    return itens


def _detectar_direcao(itens: list) -> Optional[str]:
    """'saida' ou 'retorno', decidido pelo CFOP dos itens (muito mais
    confiável que tentar ler o indicador visual '0-Entrada/1-Saída' do
    DANFE, que o pdfplumber às vezes embaralha com outros campos)."""
    cfops = {item["cfop"] for item in itens if item.get("cfop")}
    if cfops & CFOPS_SAIDA:
        return "saida"
    if cfops & CFOPS_RETORNO:
        return "retorno"
    return None


def parse_danfe_pdf(conteudo_pdf: bytes) -> dict:
    """Lê um PDF de DANFE e devolve um dict com tudo que conseguiu extrair.
    Todo campo pode vir None se o layout da nota não bater com o esperado —
    quem chama decide o que fazer quando um campo essencial falta. O campo
    'texto_bruto' sempre vem preenchido, como registro completo da nota."""
    paginas_texto = []
    with pdfplumber.open(__import__("io").BytesIO(conteudo_pdf)) as pdf:
        for pagina in pdf.pages:
            paginas_texto.append(pagina.extract_text() or "")
    texto = "\n".join(paginas_texto)
    linhas = texto.split("\n")

    itens = _extrair_itens(texto)
    direcao = _detectar_direcao(itens)

    numero_nota = None
    m = RE_NUMERO_NOTA.search(texto)
    if m:
        numero_nota = _normalizar_numero(m.group(1))

    serie = None
    m = RE_SERIE.search(texto)
    if m:
        serie = m.group(1)

    chave_acesso = None
    m = RE_CHAVE_ACESSO.search(texto)
    if m:
        chave_acesso = m.group(1).replace(" ", "")

    # Fornecedor: é quem, entre "RECEBEMOS DE X" (o emitente da nota) e o
    # nome do bloco DESTINATÁRIO/REMETENTE, NÃO é a MUBEC — funciona tanto
    # pra saída (MUBEC emite, fornecedor é o destinatário) quanto pra
    # retorno (fornecedor emite, MUBEC é o destinatário), sem depender do
    # CFOP ter sido lido corretamente.
    nome_emitente = None
    m = RE_RECEBEMOS_DE.search(texto)
    if m:
        nome_emitente = m.group(1).strip()

    # O CNPJ do emitente da nota fica no cabeçalho, antes do bloco
    # DESTINATÁRIO/REMETENTE — é sempre o 1º CNPJ que aparece no texto (o
    # 2º é o do destinatário, capturado logo abaixo).
    todos_cnpj = RE_CNPJ.findall(texto)
    cnpj_emitente = todos_cnpj[0] if todos_cnpj else None

    linha_destinatario = _linha_apos(linhas, "NOME RAZÃO SOCIAL", 1)
    nome_destinatario = None
    cnpj_destinatario = None
    if linha_destinatario:
        mc = RE_CNPJ.search(linha_destinatario)
        if mc:
            cnpj_destinatario = mc.group(1)
            nome_destinatario = linha_destinatario[:mc.start()].strip()

    fornecedor = None
    cnpj_fornecedor = None
    if nome_emitente and NOME_MUBEC_TRECHO not in nome_emitente.upper():
        fornecedor = nome_emitente
        cnpj_fornecedor = cnpj_emitente
    elif nome_destinatario and NOME_MUBEC_TRECHO not in nome_destinatario.upper():
        fornecedor = nome_destinatario
        cnpj_fornecedor = cnpj_destinatario

    # Datas e protocolo de autorização (ficam na linha logo após o
    # cabeçalho "NATUREZA DA OPERAÇÃO ... PROTOCOLO DE AUTORIZAÇÃO DE USO")
    natureza_operacao = None
    protocolo_autorizacao = None
    data_autorizacao = None
    linha_natureza = _linha_apos(linhas, "NATUREZA DA OPERAÇÃO", 1)
    if linha_natureza:
        m_prot = re.search(r"(\d{15})\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})", linha_natureza)
        if m_prot:
            protocolo_autorizacao = m_prot.group(1)
            data_autorizacao = f"{m_prot.group(2)} {m_prot.group(3)}"
            natureza_operacao = linha_natureza[:m_prot.start()].strip()
        else:
            natureza_operacao = linha_natureza.strip()

    data_emissao = None
    data_saida_entrada = None
    hora_saida = None
    if linha_destinatario:
        datas = RE_DATA.findall(linha_destinatario)
        if datas:
            data_emissao = _data_br(datas[0])
    linha_endereco = _linha_apos(linhas, "ENDEREÇO", 1) if linhas else None
    if linha_endereco:
        datas = RE_DATA.findall(linha_endereco)
        if datas:
            data_saida_entrada = _data_br(datas[-1])
    linha_municipio = _linha_apos(linhas, "MUNICÍPIO", 1)
    if linha_municipio:
        m_hora = RE_HORA.search(linha_municipio)
        if m_hora:
            hora_saida = m_hora.group(1)

    peso_bruto = None
    peso_liquido = None
    linha_peso = _linha_apos(linhas, "PESO BRUTO")
    if linha_peso:
        numeros = RE_MOEDA.findall(linha_peso)
        if len(numeros) >= 2:
            peso_bruto = _num_br(numeros[-2])
            peso_liquido = _num_br(numeros[-1])
        elif len(numeros) == 1:
            peso_bruto = peso_liquido = _num_br(numeros[0])

    valor_total_produtos = None
    valor_total_nota = None
    valor_frete = valor_seguro = valor_desconto = valor_outras_despesas = valor_ipi = None
    linha_icms = _linha_apos(linhas, "BASE DE CÁLCULO DO ICMS")
    if linha_icms:
        numeros = RE_MOEDA.findall(linha_icms)
        if numeros:
            valor_total_produtos = _num_br(numeros[-1])
    linha_frete = _linha_apos(linhas, "VALOR DO FRETE")
    if linha_frete:
        numeros = RE_MOEDA.findall(linha_frete)
        if len(numeros) >= 6:
            valor_frete, valor_seguro, valor_desconto, valor_outras_despesas, valor_ipi, valor_total_nota = \
                [_num_br(n) for n in numeros[:6]]
        elif numeros:
            valor_total_nota = _num_br(numeros[-1])

    numero_fatura = None
    parcelas = []
    linha_fatura = _linha_apos(linhas, "VALOR LÍQUIDO DA FATURA")
    if linha_fatura:
        partes = linha_fatura.split()
        # o número da fatura nunca tem vírgula (ex: "009336"); um valor
        # monetário sempre tem (ex: "8.047,36") — se a 1ª parte não tem
        # vírgula, é o número da fatura; senão, a linha só traz os totais
        # (fatura em branco, caso comum na remessa de saída).
        if partes and "," not in partes[0]:
            numero_fatura = partes[0]
    linha_parcelas = _linha_apos(linhas, "NÚMERO VENCIMENTO VALOR")
    if linha_parcelas:
        for m_parc in re.finditer(r"(\d+)\s+(\d{2}/\d{2}/\d{4})\s+([\d.,]+)", linha_parcelas):
            parcelas.append({
                "numero": m_parc.group(1),
                "vencimento": _data_br(m_parc.group(2)).isoformat() if _data_br(m_parc.group(2)) else None,
                "valor": _num_br(m_parc.group(3)),
            })

    transportador_nome = None
    transportador_cnpj = None
    linha_transportador = _linha_apos(linhas, "RAZÃO SOCIAL", 1) if "TRANSPORTADOR" in texto else None
    # a 1ª ocorrência de "RAZÃO SOCIAL" é do destinatário; a do transportador
    # é a que vem depois do cabeçalho "TRANSPORTADOR/VOLUMES TRANSPORTADOS"
    idx_transp = texto.find("TRANSPORTADOR/VOLUMES")
    if idx_transp != -1:
        linhas_apos_transp = texto[idx_transp:].split("\n")
        linha_t = _linha_apos(linhas_apos_transp, "RAZÃO SOCIAL", 1)
        if linha_t and linha_t.strip() and "Dest/Rem" not in linha_t and "Emitente" not in linha_t:
            mc = RE_CNPJ.search(linha_t)
            if mc:
                transportador_cnpj = mc.group(1)
                transportador_nome = linha_t[:mc.start()].strip() or None

    # No DANFE, "INFORMAÇÕES COMPLEMENTARES" e "RESERVADO AO FISCO" são só
    # os 2 rótulos lado a lado de uma mesma linha de cabeçalho — o
    # conteúdo de verdade vem na(s) linha(s) seguinte(s), até o fim do
    # texto da página (é sempre o último campo do documento).
    informacoes_complementares = None
    for i, l in enumerate(linhas):
        if "INFORMAÇÕES COMPLEMENTARES" in l:
            resto = "\n".join(linhas[i + 1:]).strip()
            informacoes_complementares = resto or None
            break

    vinculo_nota_saida = None
    if direcao == "retorno" and informacoes_complementares:
        vinculo_nota_saida = extrair_numero_nota_saida(informacoes_complementares)

    return {
        "direcao": direcao,
        "numero_nota": numero_nota,
        "serie": serie,
        "chave_acesso": chave_acesso,
        "fornecedor": fornecedor,
        "cnpj_fornecedor": cnpj_fornecedor,
        "natureza_operacao": natureza_operacao,
        "protocolo_autorizacao": protocolo_autorizacao,
        "data_autorizacao": data_autorizacao,
        "data_emissao": data_emissao,
        "data_saida_entrada": data_saida_entrada,
        "hora_saida": hora_saida,
        "peso_bruto": peso_bruto,
        "peso_liquido": peso_liquido,
        "valor_total_produtos": valor_total_produtos,
        "valor_total_nota": valor_total_nota,
        "valor_frete": valor_frete,
        "valor_seguro": valor_seguro,
        "valor_desconto": valor_desconto,
        "valor_outras_despesas": valor_outras_despesas,
        "valor_ipi": valor_ipi,
        "numero_fatura": numero_fatura,
        "parcelas": parcelas,
        "transportador_nome": transportador_nome,
        "transportador_cnpj": transportador_cnpj,
        "informacoes_complementares": informacoes_complementares,
        "vinculo_nota_saida": vinculo_nota_saida,
        "itens": itens,
        "texto_bruto": texto,
    }
