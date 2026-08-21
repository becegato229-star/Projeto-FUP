import os
from sqlalchemy import text
from sqlmodel import SQLModel, create_engine, Session

DB_PATH = os.environ.get("FLOWLOG_DB_PATH", "flowlog.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 15},
)


def _info_tabela_real(conn, nome_tabela: str):
    """Retorna (existe, colunas_atuais, chave_primaria_atual) lendo o banco
    de verdade — nunca confia em suposição, sempre olha o estado real."""
    existe = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
        {"n": nome_tabela},
    ).fetchone()
    if not existe:
        return False, set(), set()
    info = list(conn.execute(text(f"PRAGMA table_info({nome_tabela})")))
    colunas_atuais = {row[1] for row in info}
    pk_atual = {row[1] for row in info if row[5] > 0}
    return True, colunas_atuais, pk_atual


def _ajustar_tabelas_ao_model():
    """Deixa a estrutura de cada tabela do banco igual ao model atual.

    Compara diretamente colunas e chave primária ANTES de fazer qualquer
    alteração — não depende de tentar uma operação e reagir a um erro
    específico do SQLite (que pode se comportar diferente entre versões).

    Regra:
    - Coluna nova no model, faltando no banco -> adiciona (sempre seguro).
    - Estrutura da tabela não bate mais com o model (coluna removida,
      chave primária mudou, etc.) E a tabela está vazia -> reconstrói do
      zero com a estrutura atual.
    - Estrutura não bate E a tabela tem dado de verdade -> não mexe.
      Nesse caso, colunas antigas que sobraram como NOT NULL podem seguir
      causando erro; precisaria de uma migração manual específica."""
    with engine.connect() as conn:
        for nome_tabela, tabela in SQLModel.metadata.tables.items():
            existe, colunas_atuais, pk_atual = _info_tabela_real(conn, nome_tabela)
            if not existe:
                continue  # tabela nova, o create_all() de fora cuida disso

            colunas_do_model = {c.name for c in tabela.columns}
            pk_do_model = {c.name for c in tabela.columns if c.primary_key}

            estrutura_bate = (colunas_atuais == colunas_do_model) and (pk_atual == pk_do_model)
            if estrutura_bate:
                continue

            total_linhas = conn.execute(text(f"SELECT COUNT(*) FROM {nome_tabela}")).scalar()
            if total_linhas == 0:
                # tabela vazia: mais simples e confiável reconstruir do zero
                # do que tentar consertar coluna por coluna
                conn.execute(text(f"DROP TABLE {nome_tabela}"))
                conn.commit()
                continue

            # tem dado de verdade: só adiciona o que falta (sempre seguro);
            # não tenta remover nada, pra nunca arriscar dado real
            for coluna in tabela.columns:
                if coluna.name not in colunas_atuais:
                    tipo_sql = str(coluna.type)
                    conn.execute(text(f"ALTER TABLE {nome_tabela} ADD COLUMN {coluna.name} {tipo_sql}"))
                    conn.commit()

    SQLModel.metadata.create_all(engine)  # recria qualquer tabela derrubada acima, com a estrutura atual


def init_db():
    SQLModel.metadata.create_all(engine)
    _ajustar_tabelas_ao_model()


def get_session():
    with Session(engine) as session:
        yield session
