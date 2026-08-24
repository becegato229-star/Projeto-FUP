import io
import time
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from .database import init_db, get_session, engine
from .models import (
    Pedido, FupRegistro, FupRegistroCreate, MOTIVOS_ATRASO_PADRAO, MotivoFup, MotivoFupCreate,
    AvisoRegistro, AvisoRegistroCreate,
    NotaSaida, NotaSaidaCreate, NotaSaidaEditar, NotaRetorno, NotaRetornoCreate, NotaRetornoEditar,
    Boleto, BoletoEditar, CobrancaRegistro, CobrancaRegistroCreate,
)
from .importer import importar_planilha, recalcular_status_e_atrasos
from .terceirizacao import extrair_numero_nota_saida, montar_pares
from .cobranca import importar_boletos

app = FastAPI(title="FlowLog (self-hosted)")


@app.exception_handler(Exception)
async def erro_inesperado_handler(request, exc: Exception):
    """Garante que QUALQUER erro inesperado volte como JSON legível pro
    frontend, em vez de uma página de erro em texto puro que quebra o
    'await res.json()' da tela com uma mensagem confusa de 'JSON inválido'."""
    import traceback
    traceback.print_exc()  # traceback completo ainda aparece no log do Railway pra debug

    if isinstance(exc, IntegrityError):
        # pega a causa raiz de verdade (ex: "NOT NULL constraint failed: boleto.x"),
        # sem o SQL inteiro nem a lista de parâmetros, que pode ficar gigante
        causa_raiz = str(getattr(exc, "orig", exc)).split("\n")[0]
        if len(causa_raiz) > 200:
            causa_raiz = causa_raiz[:200] + "…"
        mensagem = (
            "Conflito ao salvar os dados no banco. "
            f"Detalhe técnico: {causa_raiz}"
        )
    else:
        # corta mensagens muito longas (ex: erros de SQL trazem a query inteira)
        texto = str(exc)
        if len(texto) > 200:
            texto = texto[:200] + "…"
        mensagem = f"Erro interno inesperado: {type(exc).__name__}: {texto}"

    return JSONResponse(status_code=500, content={"detail": mensagem})


@app.on_event("startup")
def on_startup():
    init_db()
    with Session(engine) as session:
        # recalcula status/atraso de todos os pedidos com a lógica mais recente
        # (sem isso, correções de cálculo só apareceriam na próxima importação)
        recalcular_status_e_atrasos(session)

        pedidos_com_fup = session.exec(
            select(FupRegistro.numero_pedido).distinct()
        ).all()
        for numero in pedidos_com_fup:
            _recalcular_motivo_espelhado(numero, session)

        # semeia a lista de motivos personalizável com os padrões, só na primeira vez
        if not session.exec(select(MotivoFup)).first():
            for texto in MOTIVOS_ATRASO_PADRAO:
                session.add(MotivoFup(texto=texto))
            session.commit()


# ---------------------------------------------------------------------
# Import de planilhas
# ---------------------------------------------------------------------
@app.post("/api/importar")
async def importar(file: UploadFile = File(...), session: Session = Depends(get_session)):
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Envie um arquivo Excel (.xlsx ou .xls)")
    content = await file.read()
    try:
        resultado = importar_planilha(io.BytesIO(content), session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except IntegrityError as e1:
        # Desfaz e tenta mais uma vez (cobre o caso raro de condição de corrida).
        session.rollback()
        try:
            resultado = importar_planilha(io.BytesIO(content), session)
        except IntegrityError as e2:
            session.rollback()
            raise HTTPException(409, f"Conflito ao salvar os dados. Detalhe técnico: {_detalhe_integrity_error(e2)}")
    recalcular_status_e_atrasos(session)
    return resultado


def _detalhe_integrity_error(exc: IntegrityError) -> str:
    """Extrai o máximo de informação útil de um IntegrityError pra facilitar
    o diagnóstico — qual restrição foi violada e com qual(is) valor(es)."""
    causa = str(exc.orig) if getattr(exc, "orig", None) else str(exc)
    valores = ""
    try:
        params = exc.params
        if isinstance(params, list) and params:
            # tenta achar o(s) numero_pedido envolvido(s) nos parâmetros do INSERT
            candidatos = []
            for p in params:
                if isinstance(p, (list, tuple)) and p:
                    candidatos.append(str(p[0]))
                elif isinstance(p, dict) and "numero_pedido" in p:
                    candidatos.append(str(p["numero_pedido"]))
            if candidatos:
                valores = " | pedido(s) envolvido(s): " + ", ".join(candidatos[:10])
    except Exception:
        pass
    return f"{causa}{valores}"


# ---------------------------------------------------------------------
# Listagem de pedidos com filtros
# ---------------------------------------------------------------------
_ultimo_recalculo_ts = 0.0
_RECALCULO_INTERVALO_SEGUNDOS = 60  # evita recalcular a cada requisição; no máximo 1x/minuto


def _recalcular_se_necessario(session: Session):
    """Garante que o atraso reflita o dia de hoje, mesmo sem reimportar
    planilhas — mas sem recalcular a cada request (throttle de 60s)."""
    global _ultimo_recalculo_ts
    agora = time.time()
    if agora - _ultimo_recalculo_ts > _RECALCULO_INTERVALO_SEGUNDOS:
        recalcular_status_e_atrasos(session)
        _ultimo_recalculo_ts = agora


@app.get("/api/pedidos")
def listar_pedidos(
    aba: str = Query("todos", description="reservado para uso futuro; hoje sempre 'todos'"),
    tipo_entrega: Optional[str] = Query(None, description="Entrega,Retira,Transportadora (separados por vírgula)"),
    status: Optional[str] = Query(None, description="Bloqueado,Aprovado,Faturado,Encerrado,Cancelado (separados por vírgula)"),
    apenas_atrasados: bool = False,
    data_de: Optional[date] = None,
    data_ate: Optional[date] = None,
    campo_data: str = Query("entrega", description="qual data usar no filtro data_de/data_ate: entrega | emissao | entrega_efetiva"),
    cliente: Optional[str] = None,
    busca: Optional[str] = Query(None, description="busca livre por pedido, OE, NF ou cliente"),
    session: Session = Depends(get_session),
):
    _recalcular_se_necessario(session)
    query = select(Pedido)
    pedidos = session.exec(query).all()

    status_list = [s.strip() for s in status.split(",")] if status else None
    tipo_list = [t.strip() for t in tipo_entrega.split(",")] if tipo_entrega else None
    busca_norm = busca.strip().lower() if busca else None

    campo_data_map = {
        "entrega": "data_entrega_prevista",
        "emissao": "data_emissao",
        "entrega_efetiva": "data_entrega_real",
    }
    atributo_data = campo_data_map.get(campo_data, "data_entrega_prevista")

    def bate_filtros(p: Pedido) -> bool:
        if tipo_list and p.tipo_entrega not in tipo_list:
            return False
        if status_list and p.status not in status_list:
            return False
        if apenas_atrasados and not (p.atraso_producao or p.aviso_entrega):
            return False
        valor_data = getattr(p, atributo_data)
        if data_de and (not valor_data or valor_data < data_de):
            return False
        if data_ate and (not valor_data or valor_data > data_ate):
            return False
        if cliente and (not p.nome_cliente or cliente.lower() not in p.nome_cliente.lower()):
            return False
        if busca_norm:
            campos = [
                p.numero_pedido, p.numero_oe, p.nf, p.nome_cliente, p.cod_cliente,
            ]
            if not any(c and busca_norm in str(c).lower() for c in campos):
                return False
        return True

    resultado = [p for p in pedidos if bate_filtros(p)]
    resultado.sort(key=lambda p: p.data_emissao or date.min, reverse=True)
    return resultado


@app.get("/api/pedidos/{numero_pedido}")
def obter_pedido(numero_pedido: str, session: Session = Depends(get_session)):
    pedido = session.get(Pedido, numero_pedido)
    if not pedido:
        raise HTTPException(404, "Pedido não encontrado")
    fups = session.exec(
        select(FupRegistro)
        .where(FupRegistro.numero_pedido == numero_pedido)
        .order_by(FupRegistro.data_referencia.desc())
    ).all()
    avisos = session.exec(
        select(AvisoRegistro)
        .where(AvisoRegistro.numero_pedido == numero_pedido)
        .order_by(AvisoRegistro.data_registro.desc())
    ).all()
    return {"pedido": pedido, "fups": fups, "avisos": avisos}


# ---------------------------------------------------------------------
# Cancelamento manual
# ---------------------------------------------------------------------
@app.post("/api/pedidos/{numero_pedido}/cancelar")
def cancelar_pedido(
    numero_pedido: str,
    motivo: str,
    data_cancelamento: date,
    session: Session = Depends(get_session),
):
    pedido = session.get(Pedido, numero_pedido)
    if not pedido:
        raise HTTPException(404, "Pedido não encontrado")
    pedido.cancelado = True
    pedido.motivo_cancelamento = motivo
    pedido.data_cancelamento = data_cancelamento
    session.add(pedido)
    session.commit()
    recalcular_status_e_atrasos(session)
    return {"ok": True}


# ---------------------------------------------------------------------
# Nova data de entrega (renegociação manual do prazo)
# ---------------------------------------------------------------------
@app.post("/api/pedidos/{numero_pedido}/nova-data-entrega")
def definir_nova_data_entrega(
    numero_pedido: str,
    nova_data: Optional[date] = None,  # omitir ou vazio limpa a renegociação, voltando ao prazo original
    session: Session = Depends(get_session),
):
    pedido = session.get(Pedido, numero_pedido)
    if not pedido:
        raise HTTPException(404, "Pedido não encontrado")
    pedido.nova_data_entrega = nova_data
    session.add(pedido)
    session.commit()
    recalcular_status_e_atrasos(session)
    return {"ok": True}


# ---------------------------------------------------------------------
# FUP (acompanhamento diário manual)
# ---------------------------------------------------------------------
def _texto_motivo_exibicao(motivo: Optional[str], observacao: Optional[str]) -> Optional[str]:
    """Quando o motivo é 'Outro' e existe observação, mostra a observação
    no lugar do texto genérico 'Outro' (na tela e na exportação)."""
    if motivo == "Outro" and observacao:
        return observacao
    return motivo


def _texto_situacao_exibicao(situacao: Optional[str], motivo: Optional[str], observacao: Optional[str]) -> Optional[str]:
    """Texto espelhado no pedido, considerando a situação do FUP. Registros
    antigos (de antes dessa mudança) não têm 'situacao' salva — nesse caso,
    trata como 'atraso', igual já funcionava antes."""
    situacao = situacao or "atraso"
    if situacao == "ok":
        return f"✓ Ok — {observacao}" if observacao else "✓ Ok"
    texto_motivo = _texto_motivo_exibicao(motivo, observacao)
    if situacao == "previsto_atraso":
        return f"⚠ Previsto: {texto_motivo}" if texto_motivo else "⚠ Previsto atraso"
    return texto_motivo  # situacao == "atraso"


def _recalcular_motivo_espelhado(numero_pedido: str, session: Session):
    """Depois de editar/apagar um FUP, atualiza o motivo mais recente
    espelhado no pedido (usado nas colunas/filtros da tela principal)."""
    ultimo = session.exec(
        select(FupRegistro)
        .where(FupRegistro.numero_pedido == numero_pedido)
        .order_by(FupRegistro.data_referencia.desc(), FupRegistro.id.desc())
    ).first()
    pedido = session.get(Pedido, numero_pedido)
    if pedido:
        pedido.motivo_atraso_fup = _texto_situacao_exibicao(ultimo.situacao, ultimo.motivo_atraso, ultimo.observacao) if ultimo else None
        session.add(pedido)
        session.commit()


@app.get("/api/fup/motivos")
def listar_motivos(session: Session = Depends(get_session)):
    motivos = session.exec(select(MotivoFup).order_by(MotivoFup.id)).all()
    return motivos


@app.post("/api/fup/motivos")
def criar_motivo(dados: MotivoFupCreate, session: Session = Depends(get_session)):
    texto = dados.texto.strip()
    if not texto:
        raise HTTPException(400, "Informe o texto do motivo")
    existente = session.exec(select(MotivoFup).where(MotivoFup.texto == texto)).first()
    if existente:
        raise HTTPException(409, f"O motivo '{texto}' já existe")
    motivo = MotivoFup(texto=texto)
    session.add(motivo)
    session.commit()
    session.refresh(motivo)
    return motivo


@app.put("/api/fup/motivos/{motivo_id}")
def editar_motivo(motivo_id: int, dados: MotivoFupCreate, session: Session = Depends(get_session)):
    motivo = session.get(MotivoFup, motivo_id)
    if not motivo:
        raise HTTPException(404, "Motivo não encontrado")
    texto = dados.texto.strip()
    if not texto:
        raise HTTPException(400, "Informe o texto do motivo")
    texto_antigo = motivo.texto
    motivo.texto = texto
    session.add(motivo)
    session.commit()
    # atualiza os registros de FUP já feitos com o texto antigo, pra não
    # ficarem "órfãos" de um motivo que não existe mais na lista
    if texto_antigo != texto:
        afetados = session.exec(select(FupRegistro).where(FupRegistro.motivo_atraso == texto_antigo)).all()
        for fup in afetados:
            fup.motivo_atraso = texto
            session.add(fup)
        session.commit()
    session.refresh(motivo)
    return motivo


@app.delete("/api/fup/motivos/{motivo_id}")
def apagar_motivo(motivo_id: int, session: Session = Depends(get_session)):
    motivo = session.get(MotivoFup, motivo_id)
    if not motivo:
        raise HTTPException(404, "Motivo não encontrado")
    session.delete(motivo)
    session.commit()
    return {"ok": True}


@app.get("/api/fup")
def listar_fups(session: Session = Depends(get_session)):
    fups = session.exec(select(FupRegistro).order_by(FupRegistro.data_referencia.desc())).all()
    return fups


def _validar_fup(dados: FupRegistroCreate):
    if dados.situacao not in ("ok", "previsto_atraso", "atraso"):
        raise HTTPException(400, "Situação inválida — precisa ser 'ok', 'previsto_atraso' ou 'atraso'")
    if dados.situacao in ("previsto_atraso", "atraso"):
        if not dados.motivo_atraso:
            raise HTTPException(400, "Motivo é obrigatório quando a situação não é 'Ok'")
        if dados.motivo_atraso == "Outro" and not (dados.observacao and dados.observacao.strip()):
            raise HTTPException(400, "Observação é obrigatória quando o motivo é 'Outro'")


@app.post("/api/fup")
def criar_fup(dados: FupRegistroCreate, session: Session = Depends(get_session)):
    if not session.get(Pedido, dados.numero_pedido):
        raise HTTPException(404, "Pedido não encontrado")
    _validar_fup(dados)
    motivo_final = None if dados.situacao == "ok" else dados.motivo_atraso
    fup = FupRegistro(
        numero_pedido=dados.numero_pedido,
        data_referencia=dados.data_referencia,
        situacao=dados.situacao,
        motivo_atraso=motivo_final,
        observacao=dados.observacao,
    )
    session.add(fup)
    session.commit()

    # espelha a situação/motivo mais recente no pedido, para facilitar filtro/exibição
    pedido = session.get(Pedido, fup.numero_pedido)
    pedido.motivo_atraso_fup = _texto_situacao_exibicao(fup.situacao, fup.motivo_atraso, fup.observacao)
    session.add(pedido)
    session.commit()
    session.refresh(fup)  # por último: o commit acima expira os dados do fup, precisa recarregar antes de devolver
    return fup


@app.put("/api/fup/{fup_id}")
def editar_fup(fup_id: int, dados: FupRegistroCreate, session: Session = Depends(get_session)):
    fup = session.get(FupRegistro, fup_id)
    if not fup:
        raise HTTPException(404, "Registro de FUP não encontrado")
    _validar_fup(dados)
    fup.data_referencia = dados.data_referencia
    fup.situacao = dados.situacao
    fup.motivo_atraso = None if dados.situacao == "ok" else dados.motivo_atraso
    fup.observacao = dados.observacao
    session.add(fup)
    session.commit()
    _recalcular_motivo_espelhado(fup.numero_pedido, session)
    session.refresh(fup)  # por último: a linha acima faz commit e expira os dados do fup
    return fup


@app.delete("/api/fup/{fup_id}")
def apagar_fup(fup_id: int, session: Session = Depends(get_session)):
    fup = session.get(FupRegistro, fup_id)
    if not fup:
        raise HTTPException(404, "Registro de FUP não encontrado")
    numero_pedido = fup.numero_pedido
    session.delete(fup)
    session.commit()
    _recalcular_motivo_espelhado(numero_pedido, session)
    return {"ok": True}


# ---------------------------------------------------------------------
# Avisos — pedidos faturados, sem canhoto, além do prazo esperado pro tipo
# de entrega. Separado do FUP (contexto de negócio diferente).
#
# Um pedido com aviso_entrega=True pode estar em 2 estados:
#   - "avisos"   -> ainda sem nenhum registro de investigação, ou o registro
#                   mais recente tem uma "próxima data limite" que já passou
#                   (a soneca expirou e ele volta a pedir atenção)
#   - "tratados" -> tem um registro recente com próxima data limite no
#                   futuro (ou sem data limite nenhuma)
# Quando o canhoto chega, o pedido sai dos dois — mas o histórico de
# registros nunca é apagado, fica disponível pelo detalhe do pedido.
# ---------------------------------------------------------------------
def _estado_aviso(numero_pedido: str, session: Session) -> str:
    ultimo = session.exec(
        select(AvisoRegistro)
        .where(AvisoRegistro.numero_pedido == numero_pedido)
        .order_by(AvisoRegistro.data_registro.desc(), AvisoRegistro.id.desc())
    ).first()
    if ultimo and (ultimo.proxima_data_limite is None or ultimo.proxima_data_limite > date.today()):
        return "tratado"
    return "aviso"


@app.get("/api/avisos")
def listar_avisos(
    tipo_entrega: Optional[str] = None,
    data_de: Optional[date] = None,
    data_ate: Optional[date] = None,
    campo_data: str = Query("entrega"),
    busca: Optional[str] = None,
    session: Session = Depends(get_session),
):
    _recalcular_se_necessario(session)
    pedidos = listar_pedidos(
        aba="todos", tipo_entrega=tipo_entrega, status=None, apenas_atrasados=False,
        data_de=data_de, data_ate=data_ate, campo_data=campo_data, cliente=None, busca=busca, session=session,
    )  # type: ignore
    pedidos_com_aviso = [p for p in pedidos if p.aviso_entrega]

    avisos, tratados = [], []
    for p in pedidos_com_aviso:
        if _estado_aviso(p.numero_pedido, session) == "tratado":
            tratados.append(p)
        else:
            avisos.append(p)

    # histórico: TODOS os pedidos que já tiveram algum registro de aviso,
    # mesmo depois de Encerrado/Cancelado (sem isso, o pedido some da tela
    # assim que o canhoto chega, perdendo o rastro de que foi acompanhado)
    numeros_com_historico = session.exec(select(AvisoRegistro.numero_pedido).distinct()).all()
    historico = []
    for numero in numeros_com_historico:
        p = session.get(Pedido, numero)
        if p:
            historico.append(p)
    historico.sort(key=lambda p: p.data_emissao or date.min, reverse=True)

    return {"avisos": avisos, "tratados": tratados, "historico": historico}


@app.get("/api/avisos/registros")
def listar_avisos_registros(session: Session = Depends(get_session)):
    return session.exec(select(AvisoRegistro).order_by(AvisoRegistro.data_registro.desc())).all()


@app.post("/api/avisos/registros")
def criar_aviso_registro(dados: AvisoRegistroCreate, session: Session = Depends(get_session)):
    if not session.get(Pedido, dados.numero_pedido):
        raise HTTPException(404, "Pedido não encontrado")
    if not dados.motivo or not dados.motivo.strip():
        raise HTTPException(400, "Motivo é obrigatório")
    registro = AvisoRegistro(**dados.dict())
    session.add(registro)
    session.commit()
    session.refresh(registro)
    return registro


@app.put("/api/avisos/registros/{registro_id}")
def editar_aviso_registro(registro_id: int, dados: AvisoRegistroCreate, session: Session = Depends(get_session)):
    registro = session.get(AvisoRegistro, registro_id)
    if not registro:
        raise HTTPException(404, "Registro de aviso não encontrado")
    if not dados.motivo or not dados.motivo.strip():
        raise HTTPException(400, "Motivo é obrigatório")
    registro.data_registro = dados.data_registro
    registro.motivo = dados.motivo
    registro.proxima_data_limite = dados.proxima_data_limite
    session.add(registro)
    session.commit()
    session.refresh(registro)
    return registro


@app.delete("/api/avisos/registros/{registro_id}")
def apagar_aviso_registro(registro_id: int, session: Session = Depends(get_session)):
    registro = session.get(AvisoRegistro, registro_id)
    if not registro:
        raise HTTPException(404, "Registro de aviso não encontrado")
    session.delete(registro)
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------
# Terceirização — lead time de industrialização (ex: zincagem na JJ Leste).
# Totalmente independente do fluxo de Pedidos.
# ---------------------------------------------------------------------
FORNECEDOR_PADRAO = "JJ LESTE GALVANIZACAO LTDA"


@app.get("/api/terceirizacao/fornecedores")
def listar_fornecedores(session: Session = Depends(get_session)):
    """Lista os fornecedores já usados, pra alimentar sugestões na tela
    (além do padrão), preparando pra quando houver mais de um."""
    saidas = session.exec(select(NotaSaida.fornecedor).distinct()).all()
    retornos = session.exec(select(NotaRetorno.fornecedor).distinct()).all()
    fornecedores = sorted(set(saidas) | set(retornos) | {FORNECEDOR_PADRAO})
    return fornecedores


@app.get("/api/terceirizacao/saida/{numero_nota}")
def obter_nota_saida(numero_nota: str, session: Session = Depends(get_session)):
    nota = session.get(NotaSaida, numero_nota)
    if not nota:
        raise HTTPException(404, "Nota de saída não encontrada")
    return nota


@app.get("/api/terceirizacao/retorno/{numero_nota}")
def obter_nota_retorno(numero_nota: str, session: Session = Depends(get_session)):
    nota = session.get(NotaRetorno, numero_nota)
    if not nota:
        raise HTTPException(404, "Nota de retorno não encontrada")
    return nota


@app.get("/api/terceirizacao")
def obter_terceirizacao(
    fornecedor: Optional[str] = None,
    session: Session = Depends(get_session),
):
    dados = montar_pares(session, fornecedor=fornecedor)
    return dados


@app.post("/api/terceirizacao/saida")
def criar_nota_saida(dados: NotaSaidaCreate, session: Session = Depends(get_session)):
    if session.get(NotaSaida, dados.numero_nota):
        raise HTTPException(409, f"Já existe uma nota de saída com o número {dados.numero_nota}")
    nota = NotaSaida(**dados.dict())
    session.add(nota)
    session.commit()
    session.refresh(nota)
    return nota


@app.delete("/api/terceirizacao/saida/{numero_nota}")
def apagar_nota_saida(numero_nota: str, session: Session = Depends(get_session)):
    nota = session.get(NotaSaida, numero_nota)
    if not nota:
        raise HTTPException(404, "Nota de saída não encontrada")
    session.delete(nota)
    session.commit()
    return {"ok": True}


@app.put("/api/terceirizacao/saida/{numero_nota_atual}")
def editar_nota_saida(numero_nota_atual: str, dados: NotaSaidaEditar, session: Session = Depends(get_session)):
    nota = session.get(NotaSaida, numero_nota_atual)
    if not nota:
        raise HTTPException(404, "Nota de saída não encontrada")

    if dados.numero_nota != numero_nota_atual:
        # Trocou o número (o identificador) — precisa recriar com a nova
        # chave e atualizar os retornos que estavam vinculados à antiga,
        # pra não perder o vínculo.
        if session.get(NotaSaida, dados.numero_nota):
            raise HTTPException(409, f"Já existe uma nota de saída com o número {dados.numero_nota}")
        nova = NotaSaida(
            numero_nota=dados.numero_nota,
            data_nota=dados.data_nota,
            fornecedor=dados.fornecedor,
            created_at=nota.created_at,
        )
        session.add(nova)
        retornos_vinculados = session.exec(
            select(NotaRetorno).where(NotaRetorno.numero_nota_saida == numero_nota_atual)
        ).all()
        for r in retornos_vinculados:
            r.numero_nota_saida = dados.numero_nota
            session.add(r)
        session.delete(nota)
        session.commit()
        return nova

    nota.data_nota = dados.data_nota
    nota.fornecedor = dados.fornecedor
    session.add(nota)
    session.commit()
    return nota


@app.get("/api/terceirizacao/extrair-vinculo")
def extrair_vinculo(informacoes_adicionais: str = Query(...)):
    """Pré-visualização: extrai o número da nota de saída do texto colado,
    sem salvar nada — usado pra preencher o formulário automaticamente
    antes do usuário confirmar."""
    numero = extrair_numero_nota_saida(informacoes_adicionais)
    return {"numero_nota_saida": numero, "encontrado": numero is not None}


@app.post("/api/terceirizacao/retorno")
def criar_nota_retorno(dados: NotaRetornoCreate, session: Session = Depends(get_session)):
    if session.get(NotaRetorno, dados.numero_nota):
        raise HTTPException(409, f"Já existe uma nota de retorno com o número {dados.numero_nota}")

    numero_saida = dados.numero_nota_saida
    vinculo_manual = bool(numero_saida)
    if not numero_saida and dados.informacoes_adicionais:
        numero_saida = extrair_numero_nota_saida(dados.informacoes_adicionais)
        vinculo_manual = False

    nota = NotaRetorno(
        numero_nota=dados.numero_nota,
        data_nota=dados.data_nota,
        fornecedor=dados.fornecedor,
        numero_nota_saida=numero_saida,
        informacoes_adicionais=dados.informacoes_adicionais,
        vinculo_manual=vinculo_manual,
    )
    session.add(nota)
    session.commit()
    session.refresh(nota)
    return nota


@app.put("/api/terceirizacao/retorno/{numero_nota}/vincular")
def vincular_nota_retorno_manualmente(
    numero_nota: str,
    numero_nota_saida: str = Query(...),
    session: Session = Depends(get_session),
):
    """Permite vincular (ou corrigir o vínculo de) uma nota de retorno
    manualmente, pros casos em que a extração automática não encontrou nada
    ou encontrou errado."""
    nota = session.get(NotaRetorno, numero_nota)
    if not nota:
        raise HTTPException(404, "Nota de retorno não encontrada")
    if not session.get(NotaSaida, numero_nota_saida):
        raise HTTPException(404, f"Nota de saída {numero_nota_saida} não encontrada")
    nota.numero_nota_saida = numero_nota_saida
    nota.vinculo_manual = True
    session.add(nota)
    session.commit()
    return {"ok": True}


@app.delete("/api/terceirizacao/retorno/{numero_nota}")
def apagar_nota_retorno(numero_nota: str, session: Session = Depends(get_session)):
    nota = session.get(NotaRetorno, numero_nota)
    if not nota:
        raise HTTPException(404, "Nota de retorno não encontrada")
    session.delete(nota)
    session.commit()
    return {"ok": True}


@app.put("/api/terceirizacao/retorno/{numero_nota_atual}")
def editar_nota_retorno(numero_nota_atual: str, dados: NotaRetornoEditar, session: Session = Depends(get_session)):
    nota = session.get(NotaRetorno, numero_nota_atual)
    if not nota:
        raise HTTPException(404, "Nota de retorno não encontrada")
    if dados.numero_nota_saida and not session.get(NotaSaida, dados.numero_nota_saida):
        raise HTTPException(404, f"Nota de saída {dados.numero_nota_saida} não encontrada")

    if dados.numero_nota != numero_nota_atual:
        if session.get(NotaRetorno, dados.numero_nota):
            raise HTTPException(409, f"Já existe uma nota de retorno com o número {dados.numero_nota}")
        nova = NotaRetorno(
            numero_nota=dados.numero_nota,
            data_nota=dados.data_nota,
            fornecedor=dados.fornecedor,
            numero_nota_saida=dados.numero_nota_saida,
            informacoes_adicionais=dados.informacoes_adicionais,
            vinculo_manual=True,
            created_at=nota.created_at,
        )
        session.add(nova)
        session.delete(nota)
        session.commit()
        return nova

    nota.data_nota = dados.data_nota
    nota.fornecedor = dados.fornecedor
    nota.numero_nota_saida = dados.numero_nota_saida
    nota.informacoes_adicionais = dados.informacoes_adicionais
    nota.vinculo_manual = True
    session.add(nota)
    session.commit()
    return nota


# ---------------------------------------------------------------------
# Exportação para Excel — exporta exatamente o que está filtrado na tela,
# com colunas de FUP dinâmicas (FUP 1, FUP 2, ...) quando houver histórico
# ---------------------------------------------------------------------
@app.get("/api/exportar")
def exportar_excel(
    aba: str = Query("todos"),
    tipo_entrega: Optional[str] = None,
    status: Optional[str] = None,
    apenas_atrasados: bool = False,
    data_de: Optional[date] = None,
    data_ate: Optional[date] = None,
    campo_data: str = Query("entrega"),
    cliente: Optional[str] = None,
    busca: Optional[str] = None,
    session: Session = Depends(get_session),
):
    pedidos = listar_pedidos(
        aba=aba, tipo_entrega=tipo_entrega, status=status, apenas_atrasados=apenas_atrasados,
        data_de=data_de, data_ate=data_ate, campo_data=campo_data, cliente=cliente, busca=busca, session=session,
    )  # type: ignore

    # busca todos os FUPs dos pedidos filtrados de uma vez, ordenados por data (mais antigo primeiro)
    numeros = [p.numero_pedido for p in pedidos]
    fups_todos = session.exec(
        select(FupRegistro)
        .where(FupRegistro.numero_pedido.in_(numeros))
        .order_by(FupRegistro.data_referencia.asc(), FupRegistro.id.asc())
    ).all() if numeros else []

    fups_por_pedido: dict = {}
    for f in fups_todos:
        fups_por_pedido.setdefault(f.numero_pedido, []).append(f)

    max_fups = max((len(v) for v in fups_por_pedido.values()), default=0)

    linhas = []
    for p in pedidos:
        linha = {
            "Número do Pedido": p.numero_pedido,
            "Cliente": p.nome_cliente,
            "Data de Entrega Original": p.data_entrega_prevista.strftime("%d/%m/%Y") if p.data_entrega_prevista else "",
            "Nova Data de Entrega": p.nova_data_entrega.strftime("%d/%m/%Y") if p.nova_data_entrega else "",
            "Data Efetiva de Entrega": p.data_entrega_real.strftime("%d/%m/%Y") if p.data_entrega_real else "",
            "OE": p.numero_oe,
            "Status": p.status,
            "Tipo": p.tipo_entrega,
        }
        fups_desse_pedido = fups_por_pedido.get(p.numero_pedido, [])
        for i in range(max_fups):
            coluna = f"FUP {i+1}"
            linha[coluna] = _texto_motivo_exibicao(fups_desse_pedido[i].motivo_atraso, fups_desse_pedido[i].observacao) if i < len(fups_desse_pedido) else ""
        linhas.append(linha)

    df = pd.DataFrame(linhas)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Pedidos")
    buffer.seek(0)
    filename = f"flowlog_{aba}_{date.today().isoformat()}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------
# Dashboard — momento atual (foto de agora, sem filtro)
# ---------------------------------------------------------------------
@app.get("/api/dashboard/atual")
def dashboard_atual(session: Session = Depends(get_session)):
    _recalcular_se_necessario(session)
    pedidos = session.exec(select(Pedido)).all()

    status_count: dict = {}
    for p in pedidos:
        status_count[p.status or "Indefinido"] = status_count.get(p.status or "Indefinido", 0) + 1

    aviso_por_tipo: dict = {}
    for p in pedidos:
        if p.aviso_entrega:
            k = p.tipo_entrega or "Desconhecido"
            aviso_por_tipo[k] = aviso_por_tipo.get(k, 0) + 1

    atraso_producao_n = sum(1 for p in pedidos if p.atraso_producao)
    aviso_entrega_n = sum(1 for p in pedidos if p.aviso_entrega)

    dias_prod = [p.dias_atraso_producao for p in pedidos if p.atraso_producao]
    dias_aviso = [p.dias_uteis_desde_faturamento for p in pedidos if p.aviso_entrega]
    media_atraso_producao = round(sum(dias_prod) / len(dias_prod), 1) if dias_prod else 0
    media_dias_aviso = round(sum(dias_aviso) / len(dias_aviso), 1) if dias_aviso else 0

    atraso_por_cliente: dict = {}
    for p in pedidos:
        if p.atraso_producao or p.aviso_entrega:
            k = p.nome_cliente or "Desconhecido"
            atraso_por_cliente[k] = atraso_por_cliente.get(k, 0) + 1
    top_clientes = sorted(atraso_por_cliente.items(), key=lambda x: x[1], reverse=True)[:8]

    return {
        "status_count": status_count,
        "aviso_por_tipo": aviso_por_tipo,
        "atraso_producao_n": atraso_producao_n,
        "aviso_entrega_n": aviso_entrega_n,
        "media_atraso_producao": media_atraso_producao,
        "media_dias_aviso": media_dias_aviso,
        "top_clientes_atraso": top_clientes,
        "total_pedidos": len(pedidos),
    }


# ---------------------------------------------------------------------
# Dashboard — histórico permanente (nunca perde dado, aceita filtro de data)
# ---------------------------------------------------------------------
@app.get("/api/dashboard/historico")
def dashboard_historico(
    data_de: Optional[date] = None,
    data_ate: Optional[date] = None,
    agrupar_outros: bool = True,
    session: Session = Depends(get_session),
):
    fups = session.exec(select(FupRegistro)).all()
    if data_de:
        fups = [f for f in fups if f.data_referencia >= data_de]
    if data_ate:
        fups = [f for f in fups if f.data_referencia <= data_ate]

    def situacao_de(f) -> str:
        return f.situacao or "atraso"  # registros antigos sem situação = trata como atraso

    def label_motivo(f) -> Optional[str]:
        if not f.motivo_atraso:
            return None
        if f.motivo_atraso == "Outro" and not agrupar_outros and f.observacao:
            return f.observacao
        return f.motivo_atraso

    fups_problema = [f for f in fups if situacao_de(f) in ("atraso", "previsto_atraso")]

    motivos_count: dict = {}
    for f in fups_problema:
        label = label_motivo(f)
        if label:
            motivos_count[label] = motivos_count.get(label, 0) + 1
    motivos_ordenados = sorted(motivos_count.items(), key=lambda x: x[1], reverse=True)

    fup_por_data: dict = {}
    for f in fups:
        k = f.data_referencia.isoformat()
        fup_por_data[k] = fup_por_data.get(k, 0) + 1
    fup_timeline = sorted(fup_por_data.items())

    # Distribuição por situação (Ok / Previsto atraso / Atraso)
    distribuicao_situacao: dict = {"ok": 0, "previsto_atraso": 0, "atraso": 0}
    for f in fups:
        distribuicao_situacao[situacao_de(f)] = distribuicao_situacao.get(situacao_de(f), 0) + 1

    # Clientes com mais atraso — histórico completo (não é uma foto do momento)
    cliente_por_pedido = {
        p.numero_pedido: p.nome_cliente
        for p in session.exec(select(Pedido)).all()
    }
    atraso_por_cliente: dict = {}
    for f in fups_problema:
        nome = cliente_por_pedido.get(f.numero_pedido) or "Desconhecido"
        atraso_por_cliente[nome] = atraso_por_cliente.get(nome, 0) + 1
    top_clientes_historico = sorted(atraso_por_cliente.items(), key=lambda x: x[1], reverse=True)[:8]

    # Taxa de acerto do "Previsto atraso": de todos os pedidos que alguém
    # marcou como "vou atrasar", quantos realmente confirmaram o atraso
    # depois (um FUP de 'atraso' posterior, ou o pedido seguir atrasado hoje)?
    pedidos_previstos = {f.numero_pedido for f in fups if situacao_de(f) == "previsto_atraso"}
    pedidos_confirmados = set()
    for numero in pedidos_previstos:
        fups_do_pedido = sorted(
            [f for f in fups if f.numero_pedido == numero],
            key=lambda f: (f.data_referencia, f.id or 0),
        )
        teve_atraso_depois = any(situacao_de(f) == "atraso" for f in fups_do_pedido)
        pedido = session.get(Pedido, numero)
        ainda_atrasado = bool(pedido and pedido.atraso_producao)
        if teve_atraso_depois or ainda_atrasado:
            pedidos_confirmados.add(numero)
    taxa_acerto_previsto = (
        round(100 * len(pedidos_confirmados) / len(pedidos_previstos), 1) if pedidos_previstos else None
    )

    return {
        "motivos_atraso": motivos_ordenados,
        "fup_timeline": fup_timeline,
        "total_fups": len(fups),
        "distribuicao_situacao": distribuicao_situacao,
        "top_clientes_atraso_historico": top_clientes_historico,
        "taxa_acerto_previsto": {
            "percentual": taxa_acerto_previsto,
            "total_previstos": len(pedidos_previstos),
            "total_confirmados": len(pedidos_confirmados),
        },
    }


# ---------------------------------------------------------------------
# Cobrança — boletos vencidos, importados diariamente do relatório do banco.
# Totalmente independente do fluxo de Pedidos/Avisos/FUP.
# ---------------------------------------------------------------------
@app.post("/api/cobranca/importar")
async def importar_cobranca(file: UploadFile = File(...), session: Session = Depends(get_session)):
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Envie um arquivo Excel (.xlsx ou .xls)")
    content = await file.read()
    try:
        resultado = importar_boletos(io.BytesIO(content), session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            409,
            "Conflito ao salvar os dados — provavelmente duas importações "
            "aconteceram ao mesmo tempo. Aguarde um instante e tente de novo.",
        )
    return resultado


@app.get("/api/cobranca")
def listar_cobranca(session: Session = Depends(get_session)):
    boletos = session.exec(select(Boleto)).all()
    em_aberto = sorted(
        [b for b in boletos if b.status == "Em aberto"],
        key=lambda b: b.data_vencimento or date.max,
    )
    pagos = sorted(
        [b for b in boletos if b.status == "Pago"],
        key=lambda b: b.data_vencimento or date.max,
    )
    valor_em_aberto = sum(b.valor_titulo or 0 for b in em_aberto)
    valor_pago = sum(b.valor_titulo or 0 for b in pagos)
    stats = {
        "total_em_aberto": len(em_aberto),
        "total_pago": len(pagos),
        "valor_em_aberto": round(valor_em_aberto, 2),
        "valor_pago": round(valor_pago, 2),
        "reapareceram_n": sum(1 for b in em_aberto if b.reapareceu),
    }
    return {"em_aberto": em_aberto, "pago": pagos, "stats": stats}


@app.get("/api/cobranca/pendentes-contagem")
def contar_cobrancas_pendentes(session: Session = Depends(get_session)):
    """Quantos boletos em aberto já chegaram (ou passaram) da data marcada
    pra ligar de novo — usado pro sininho/contador na aba. Precisa vir
    ANTES da rota /api/cobranca/{seu_numero} nesse arquivo, senão
    "pendentes-contagem" seria interpretado como um número de boleto."""
    hoje = date.today()
    boletos = session.exec(select(Boleto).where(Boleto.status == "Em aberto")).all()
    pendentes = sum(1 for b in boletos if b.proxima_cobranca and b.proxima_cobranca <= hoje)
    return {"pendentes": pendentes}


@app.get("/api/cobranca/{seu_numero}")
def obter_boleto(seu_numero: str, session: Session = Depends(get_session)):
    boleto = session.get(Boleto, seu_numero)
    if not boleto:
        raise HTTPException(404, "Boleto não encontrado")
    registros = session.exec(
        select(CobrancaRegistro)
        .where(CobrancaRegistro.seu_numero == seu_numero)
        .order_by(CobrancaRegistro.data_registro.desc())
    ).all()
    return {"boleto": boleto, "registros": registros}


@app.put("/api/cobranca/{seu_numero}")
def editar_boleto(seu_numero: str, dados: BoletoEditar, session: Session = Depends(get_session)):
    boleto = session.get(Boleto, seu_numero)
    if not boleto:
        raise HTTPException(404, "Boleto não encontrado")
    boleto.status = dados.status
    if dados.data_vencimento is not None:
        boleto.data_vencimento = dados.data_vencimento
    if dados.valor_titulo is not None:
        boleto.valor_titulo = dados.valor_titulo
    if dados.valor_pago is not None:
        boleto.valor_pago = dados.valor_pago
    if dados.status == "Pago":
        boleto.data_pago_sistema = dados.data_pago_sistema or boleto.data_pago_sistema or date.today()
        boleto.reapareceu = False
    else:
        boleto.data_pago_sistema = None
    session.add(boleto)
    session.commit()
    return {"ok": True}


@app.delete("/api/cobranca/{seu_numero}")
def apagar_boleto(seu_numero: str, session: Session = Depends(get_session)):
    boleto = session.get(Boleto, seu_numero)
    if not boleto:
        raise HTTPException(404, "Boleto não encontrado")
    session.delete(boleto)
    session.commit()
    return {"ok": True}


def _recalcular_motivo_cobranca_espelhado(seu_numero: str, session: Session):
    ultimo = session.exec(
        select(CobrancaRegistro)
        .where(CobrancaRegistro.seu_numero == seu_numero)
        .order_by(CobrancaRegistro.data_registro.desc(), CobrancaRegistro.id.desc())
    ).first()
    boleto = session.get(Boleto, seu_numero)
    if boleto:
        boleto.motivo_cobranca_recente = ultimo.motivo if ultimo else None
        boleto.proxima_cobranca = ultimo.proxima_data_cobranca if ultimo else None
        session.add(boleto)
        session.commit()


@app.get("/api/cobranca-registros")
def listar_cobranca_registros(session: Session = Depends(get_session)):
    return session.exec(select(CobrancaRegistro).order_by(CobrancaRegistro.data_registro.desc())).all()


@app.post("/api/cobranca-registros")
def criar_cobranca_registro(dados: CobrancaRegistroCreate, session: Session = Depends(get_session)):
    if not session.get(Boleto, dados.seu_numero):
        raise HTTPException(404, "Boleto não encontrado")
    if not dados.motivo or not dados.motivo.strip():
        raise HTTPException(400, "Motivo é obrigatório")
    registro = CobrancaRegistro(**dados.dict())
    session.add(registro)
    session.commit()
    _recalcular_motivo_cobranca_espelhado(dados.seu_numero, session)
    session.refresh(registro)  # por último: a linha acima faz commit e expira os dados do registro
    return registro


@app.put("/api/cobranca-registros/{registro_id}")
def editar_cobranca_registro(registro_id: int, dados: CobrancaRegistroCreate, session: Session = Depends(get_session)):
    registro = session.get(CobrancaRegistro, registro_id)
    if not registro:
        raise HTTPException(404, "Registro de cobrança não encontrado")
    if not dados.motivo or not dados.motivo.strip():
        raise HTTPException(400, "Motivo é obrigatório")
    registro.data_registro = dados.data_registro
    registro.motivo = dados.motivo
    registro.proxima_data_cobranca = dados.proxima_data_cobranca
    session.add(registro)
    session.commit()
    _recalcular_motivo_cobranca_espelhado(registro.seu_numero, session)
    session.refresh(registro)  # por último: a linha acima faz commit e expira os dados do registro
    return registro


@app.delete("/api/cobranca-registros/{registro_id}")
def apagar_cobranca_registro(registro_id: int, session: Session = Depends(get_session)):
    registro = session.get(CobrancaRegistro, registro_id)
    if not registro:
        raise HTTPException(404, "Registro de cobrança não encontrado")
    seu_numero = registro.seu_numero
    session.delete(registro)
    session.commit()
    _recalcular_motivo_cobranca_espelhado(seu_numero, session)
    return {"ok": True}


# ---------------------------------------------------------------------
# Diagnóstico (temporário) — só leitura, não altera nada no banco.
# Mostra a estrutura real de cada tabela, pra investigar problemas de
# schema sem precisar adivinhar. Pode ser removido depois de resolvido.
# ---------------------------------------------------------------------
@app.get("/api/debug/schema")
def debug_schema(session: Session = Depends(get_session)):
    from sqlmodel import SQLModel
    from sqlalchemy import text as sql_text

    resultado = {}
    with engine.connect() as conn:
        for nome_tabela, tabela in SQLModel.metadata.tables.items():
            existe = conn.execute(
                sql_text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
                {"n": nome_tabela},
            ).fetchone()
            if not existe:
                resultado[nome_tabela] = {"existe": False}
                continue
            info = list(conn.execute(sql_text(f"PRAGMA table_info({nome_tabela})")))
            colunas_banco = [row[1] for row in info]
            pk_banco = [row[1] for row in info if row[5] > 0]
            colunas_model = [c.name for c in tabela.columns]
            pk_model = [c.name for c in tabela.columns if c.primary_key]
            total_linhas = conn.execute(sql_text(f"SELECT COUNT(*) FROM {nome_tabela}")).scalar()
            resultado[nome_tabela] = {
                "existe": True,
                "total_linhas": total_linhas,
                "colunas_banco": colunas_banco,
                "colunas_model": colunas_model,
                "colunas_sobrando_no_banco": list(set(colunas_banco) - set(colunas_model)),
                "colunas_faltando_no_banco": list(set(colunas_model) - set(colunas_banco)),
                "pk_banco": pk_banco,
                "pk_model": pk_model,
                "estrutura_bate": set(colunas_banco) == set(colunas_model) and set(pk_banco) == set(pk_model),
            }
    return resultado


# ---------------------------------------------------------------------
# Frontend estático
# ---------------------------------------------------------------------
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse(
        "static/index.html",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
