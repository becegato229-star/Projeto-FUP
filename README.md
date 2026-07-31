# FlowLog — Acompanhamento de Pedidos (versão independente)

Reconstrução do app FlowLog fora do Base44: Python + FastAPI, banco SQLite,
sem dependência de créditos mensais de nenhuma plataforma.

## O que o sistema faz

- Recebe upload das 3 planilhas (Follow up de vendas, OE, Pedidos Mubec)
- Cruza tudo pelo número do pedido (com a planilha "Pedidos Mubec" servindo de
  reserva para OE e data de entrega prevista, quando a planilha de OE não tiver o dado)
- Calcula automaticamente:
  - **Status**: Bloqueado / Aprovado / Faturado / Encerrado / Cancelado
  - **Atraso de produção**: pedido ainda não faturado e a data de entrega prevista já passou (em dias úteis)
  - **Atraso de entrega**: pedido faturado há mais de 2 dias úteis sem canhoto/entrega confirmada
- Mostra 4 abas: Todos / Antes de faturar / Depois de faturar / FUP
- Filtros por data, cliente, tipo de entrega (Entrega/Retira/Transportadora) e "só atrasados"
- Exportação para Excel
- Registro manual de FUP (motivo de atraso, previsão, observação)
- Cancelamento manual (motivo + data), quando o próprio ERP não trouxer isso

## Rodando localmente (pra testar antes do deploy)

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Depois acesse http://localhost:8000

## Deploy no Railway

1. Suba esta pasta para um repositório no GitHub (do jeito que você já faz nos
   outros projetos MUBEC).
2. No Railway, crie um novo projeto a partir desse repositório.
3. O Railway vai detectar o `requirements.txt` e o `Procfile` automaticamente.
4. **Importante — persistência do banco:** o SQLite (`flowlog.db`) é criado na
   pasta do projeto. No Railway, sem um volume persistente, os dados podem se
   perder a cada novo deploy. Recomendo adicionar um **Volume** no Railway
   (Settings → Volumes) montado em, por exemplo, `/data`, e configurar a
   variável de ambiente:
   ```
   FLOWLOG_DB_PATH=/data/flowlog.db
   ```
   Assim os pedidos importados não se perdem quando você atualizar o código.
5. Depois do deploy, acesse a URL pública gerada pelo Railway — é o próprio
   dashboard, pronto para uso por qualquer pessoa da empresa (sem login).

## Rotina de uso diária

1. Exportar as 3 planilhas do Mega Senior / sistema de expedição, como já é feito hoje.
2. Subir cada uma pelos botões no topo do dashboard (qualquer pessoa pode fazer isso).
3. O sistema recalcula status e atrasos automaticamente a cada importação.
4. Usar a aba FUP para registrar o acompanhamento diário e motivos de atraso.

## Próximos passos possíveis (quando quiser evoluir)

- Trocar SQLite por Postgres (Railway oferece um addon gratuito) se o volume
  de dados crescer muito além de ~1000 pedidos/mês.
- Automatizar a importação direto do ERP (se o Mega Senior tiver alguma
  exportação automática/API), removendo o passo manual.
- Gráficos de motivos de atraso mais recorrentes (hoje dá pra ver na aba FUP,
  mas dá pra evoluir para um gráfico dedicado).
- Adicionar feriados nacionais/de SP no cálculo de dias úteis (hoje considera
  só sábados e domingos como não-úteis).
