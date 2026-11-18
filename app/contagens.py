"""v2 — números do menu lateral. Cada tela acrescenta a sua contagem aqui."""
from sqlmodel import Session, func, select

from .models import Pedido


def contar_menu(session: Session) -> dict:
    from .rotas_avisos import listar_avisos, listar_transportadora
    from .rotas_pedidos import tela_fup
    from .rotas_cobranca import contar_cobrar_hoje
    from .rotas_posvenda import contar_abertos
    atrasados = session.exec(select(func.count()).select_from(Pedido).where(Pedido.atraso_producao == True)).one()  # noqa: E712
    avisos = sum(1 for a in listar_avisos(session)["avisos"] if a["situacao"] == "atencao")
    transp = sum(1 for t in listar_transportadora(session)["itens"] if t["etapa"] in ("chamar", "chamada"))
    revisar = sum(1 for p in tela_fup(session)["pedidos"] if p["revisar"])
    return {"pedidos": atrasados or 0, "avisos": avisos, "transportadora": transp, "fup": revisar, "cobranca": contar_cobrar_hoje(session), "posvenda": contar_abertos(session)}
