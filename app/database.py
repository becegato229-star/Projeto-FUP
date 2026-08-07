import os
from sqlalchemy import text
from sqlmodel import SQLModel, create_engine, Session

DB_PATH = os.environ.get("FLOWLOG_DB_PATH", "flowlog.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 15},
)


def _migrar_colunas_faltando():
    """Adiciona colunas novas em tabelas que já existem no banco (SQLite não
    faz isso sozinho com create_all — só cria tabelas que ainda não existem).
    Sem isso, adicionar um campo novo num model quebra o banco em produção,
    onde a tabela já existe com dados reais."""
    with engine.connect() as conn:
        for nome_tabela, tabela in SQLModel.metadata.tables.items():
            existe = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
                {"n": nome_tabela},
            ).fetchone()
            if not existe:
                continue  # tabela nova será criada pelo create_all()
            colunas_atuais = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({nome_tabela})"))
            }
            for coluna in tabela.columns:
                if coluna.name not in colunas_atuais:
                    tipo_sql = str(coluna.type)
                    conn.execute(text(f"ALTER TABLE {nome_tabela} ADD COLUMN {coluna.name} {tipo_sql}"))
                    conn.commit()


def init_db():
    SQLModel.metadata.create_all(engine)
    _migrar_colunas_faltando()


def get_session():
    with Session(engine) as session:
        yield session
