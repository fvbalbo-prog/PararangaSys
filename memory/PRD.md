# Marina Pararanga - App PRD

## Objetivo
Aplicativo mobile (React Native/Expo) para os proprietários de lanchas da Marina Pararanga registrarem e alterarem solicitações de descida (lançamento) e subida (retorno) das embarcações.

## Fluxos principais
1. **Login por CPF** — valida CPF pré-cadastrado (sem senha).
2. **Home Hub** — cabeçalho azul-marinho com nome do usuário e lancha; 4 cards em grid 2x2.
3. **Solicitar Descida** — campos: dia/horário (08:30–17:00), previsão de retorno (data/hora), destino, passageiros, responsável, observação.
4. **Solicitar Subida** — campos: data/hora do retorno (08:30–17:30).
5. **Alterar Descida / Alterar Subida** — lista todas as solicitações do dia por tipo; ao tocar em uma linha, abre o formulário correspondente pré-preenchido.

## Regras de negócio
- Horários da descida restritos a 08:30–17:00.
- Horários da subida restritos a 08:30–17:30.
- Campos obrigatórios da descida validados no cliente e no backend.
- CPFs são pré-cadastrados no MongoDB (seed no startup).

## Arquitetura
- **Backend**: FastAPI + MongoDB (coleções `users` e `requests`). Endpoints prefixados com `/api`.
- **Frontend**: Expo Router stack navigation, tema náutico (marine blue `#0B2545` + gold `#C5A059`).
- **Persistência local**: AsyncStorage armazena o usuário logado.

## CPFs de teste
- `11111111111` — João Silva — Netuno
- `22222222222` — Maria Santos — Poseidon
- `33333333333` — Carlos Oliveira — Aurora

## Estado atual
- MVP completo + 4 features (Cancelar, Histórico, Painel da Marina, Confirmar Retorno).
- Backend 25/25 testes passando; frontend verificado (filtro do painel corrigido e testado).

## Features adicionadas (2026-08-18)
- **Cancelar Solicitação**: status `cancelada` (soft), botão na lista do dia.
- **Confirmar Retorno**: status `concluida` + `returned_at`, botão na lista do dia.
- **Histórico** (`/historico`): todas as solicitações do usuário logado.
- **Painel da Marina** (`/admin`): acesso via CPF admin `00000000000`; navegação por dia, contadores (Descidas/Subidas/Retornos) e filtros (Todas/Descidas/Subidas).

## Features adicionadas (2026-08-18 - iteração 4)
- **Múltiplas lanchas por cliente**: `users.boats: List[str]`; dropdown de seleção de lancha nos formulários de descida e subida (SelectField). Seed: João=1, Maria=3, Carlos=2 lanchas.
- **Observação na subida**: campo de observação adicionado ao formulário de subida.
- **Quadro de Horários** (dentro do Painel da Marina): toggle Movimentação/Quadro; tabela Lancha / Horário descida / Horário de subida com as descidas do dia (subida = solicitação de subida da lancha ou previsão de retorno marcada com *).

## Features adicionadas (2026-08-18 - iteração 5)
- **Logo da empresa** (Pararanga Náutica) na tela de login.
- **Slots de meia em meia hora** com limite de **3 lanchas por horário** (exceto subida 17:30, ilimitado); se lotado, o backend indica o próximo horário disponível. Seletor de horário mostra disponibilidade por slot.
- **Maré automática (TábuaMaré API)**: `GET /api/tides/{date}` busca a tábua de São Sebastião-SP (porto `sp01`) com cache em Mongo (`tide_cache`); chave em `TABUAMARE_API_KEY` (funciona anônimo com limite menor). Os formulários de descida/subida mostram a altura da maré no horário escolhido, com cores (<0,5m vermelho, 0,5–0,8m amarelo, >0,8m verde) e salvam `tide_height` no registro.

## Features adicionadas (2026-08-18 - iteração 6)
- **Imagem de login** trocada para a foto oficial da Pararanga Náutica (removida a foto antiga do Pexels).
- **Botão Concluir/Cancelar no Painel admin**: cada linha "Aguardando" da Movimentação tem ações "Concluir" (PATCH /requests/{id}/complete → status concluída) e "Cancelar".
- **Alertas de Atraso**: banner no topo + destaque vermelho no Quadro e na Movimentação para subidas cujo horário passou +15 min sem status concluída (apenas no dia atual).
- **Cadastro de Lanchas** (`/admin-clientes`): admin lista clientes, adiciona/remove lanchas com **calado (m)** e **comprimento (pés)**, e cadastra novos clientes. Modelo `boats` migrado de string para objeto `{name, draft, length}` (com compatibilidade retroativa).

## Features adicionadas (2026-08-18 - iteração 7)
- **Login por 5 dígitos**: login usa apenas os 5 primeiros números do CPF (match por prefixo).
- **Alerta de maré baixa no agendamento**: nos formulários, se a maré no horário for abaixo do seguro para o porte da lancha, mostra aviso vermelho e sugere o próximo horário com maré segura. Regras por comprimento (pés): ≤20 sem alerta; 20–28 <0,5m; 28–34 <0,8m; >34 <1,0m.
- **Painel de Funcionários** (`/staff`, CPF `55555555555`): acesso restrito — apenas confirmar (concluir) descidas/subidas.
- **Painel de Status (somente leitura)** (`/admin-status`, botão no painel admin): 2 seções por ordem de horário — Descidas solicitadas e Subidas solicitadas (Lancha/Horário/Status/Observação).
- **Rótulos**: cards da home renomeados para "Confirmar/Alterar Descida" e "Confirmar/Alterar Subida".

## Features adicionadas (2026-08-18 - iteração 8)
- **Login CPF (5) + Celular (4)**: exige os 5 primeiros dígitos do CPF e os 4 últimos do celular.
- **Menu do cliente** (`/menu`) após login: Descida/Subida (hub), Conveniência, Autorizar Entrada, Emergência (as 3 últimas são placeholders "Em breve").
- **Cliente não conclui**: removido o botão "Confirmar retorno" da tela do cliente (só Cancelar). Conclusão apenas no painel de funcionários.
- **Correção de status no painel de funcionários**: em itens concluídos, funcionário pode "Voltar p/ Aguardando" (PATCH /reopen) ou Cancelar.
- **Rótulos**: cards da home voltaram a "Alterar Descida"/"Alterar Subida"; removido o nome da lancha abaixo do nome do cliente.

## CPFs e perfis
- `11111` João (cliente) • `22222` Maria • `33333` Carlos • `00000` Admin (painel completo) • `55555` Funcionário (apenas confirmar).

## Backlog (solicitado, ainda pendente)
- (nenhum pendente)

## Features/correções (2026-06 - iteração 12)
- **Correção crítica**: `Alert.alert` com vários botões não aparecia no preview web → criado `AppDialog` (Modal cross-platform). Agora as confirmações e mensagens de sucesso aparecem em qualquer plataforma.
- **Emergência**: confirmação → "Mensagem enviada com sucesso!"; lista permite **cancelar solicitação** (`PATCH /api/emergencies/{id}/cancel`).
- **Conveniência**: confirmação → "Pedido realizado!"; pedido aparece em Meus pedidos e no painel admin.
- **Coordenadas da marina** atualizadas para -23.7980368, -45.3986618; reboque mostra estimativa + confirmação.
- **Confirmar entrada no app**: cliente vê "Entrada confirmada às HH:MM" quando a portaria faz o check-in.
- **Histórico de faturas**: navegação por mês em Minha Fatura.
- **Aviso de fatura nova**: badge "Novo" no menu quando a marina envia um resumo.
- **Painel funcionário**: removido o acesso a "Pedidos & Chamados" (agora só pelo admin).

## Features adicionadas (2026-06 - iteração 11)
- **Janela de agendamento**: descida/subida apenas para hoje ou amanhã, com mínimo de 1h de antecedência (validado no backend em BR_TZ; frontend limita data e marca slots "Cedo").
- **Autorizar Entrada**: campos "autorizado a descer a lancha (Sim/Não)" e "serviço a ser realizado".
- **Login**: removida a frase "Solicitações de descida e subida"; logo +10%.
- **Conveniência**: confirmação antes de enviar avisando que o valor vai para a fatura mensal.
- **Reboque via GPS**: `expo-location` obtém a posição do cliente; backend calcula a distância (haversine) até a marina (`MARINA_LAT`/`MARINA_LNG`, default -27.5969/-48.5495) e o valor.
- **Relatório mensal em PDF** (admin) + **Enviar resumo ao cliente** (`POST /api/statements/send`).
- **Excluir/Reativar acesso** (soft delete `PATCH /api/users/{cpf}/active`): login bloqueia inativos (403), registros mantidos; funcionários aparecem na lista com selo.
- **Minha Fatura** (cliente): consumo do mês + resumos enviados pela marina (`/api/statements`).
- Nota: no preview web os Alerts de confirmação (multi-botão) são silenciosos por limitação do react-native-web; funcionam normalmente no app iOS/Android.

## Features adicionadas (2026-06 - iteração 10)
- **Filtro por categoria na loja** (cliente `/conveniencia`): chips Todos/Bebidas/Sorvetes/Açaí/Outros com ícones.
- **Cadastro de funcionário** (`/admin-clientes`): toggle Cliente/Funcionário; funcionário (`is_staff`) acessa só o painel de funcionário; badge no card. `POST /api/users` aceita `is_staff`; `/api/users` lista funcionários.
- **Painel de status escuro** (`/admin-status`): fundo escuro + letras brancas para leitura em ambiente claro.
- **Relatório de consumo mensal** (`/admin-relatorio`, `GET /api/reports/consumo?month=YYYY-MM`): agrupa por cliente conveniência + reboque; pedidos lançados na conta assim que feitos; acesso pelo card Caixa em `/admin-solicitacoes`.
- **Aviso de emergência ao admin**: banner no painel (`/admin`) e tag vermelha "EMERGÊNCIA" + banner no painel de status.
- **Reboque** (`/emergencia`, aba Reboque): calcula valor pela tabela (≤25 pés base R$1.200 +R$120/MN; 26–35 R$1.800 +R$180/MN; 36+ R$2.500 +R$250/MN; 5 MN inclusas) usando o comprimento cadastrado da lancha; `GET /api/reboque/quote`, `POST /api/reboque`; admin lança o valor final na conta (`PATCH /api/emergencies/{id}/bill`).
- Formatação monetária pt-BR com separador de milhar (`src/format.ts`).

## Features adicionadas (2026-06 - iteração 9.2)
- **Resumo do Caixa**: card no topo da aba Conveniência (admin/staff) com totais de conveniência Hoje e Semana (pedidos não cancelados).
- **Aviso Sonoro de Emergência**: painel do funcionário e Pedidos & Chamados fazem polling (15s) e tocam alerta (expo-audio, `assets/sounds/alert.wav`) + vibração quando surge nova emergência aberta.
- **Confirmar Autorização na Portaria**: `PATCH /authorizations/{id}/checkin` grava `entered_at`; equipe registra a entrada e vê "Entrou às HH:MM".
- **Foto do Produto**: upload via Emergent Object Storage (`POST /api/products/{id}/image`, servido em `GET /api/files/{path}`); admin escolhe foto (expo-image-picker), cliente vê miniatura.
- **Categorias de Conveniência**: Bebidas, Sorvetes, Açaí, Outros (com ícones); produto tem campo `category`; loja do cliente agrupa por categoria.

## Features adicionadas (2026-06 - iteração 9.1)
- **Coluna Conveniência no PDF do Quadro** (total por lancha no dia) + total do dia; **Aviso de Emergência** no topo do painel do funcionário; **Estoque de Produtos** (`in_stock`); **Autorizações válidas hoje** (filtro padrão).


## Features adicionadas (2026-06 - iteração 9)
- **Exportar Quadro em PDF** (Painel da Marina): botão de impressão gera o quadro do dia (Lancha / Descida / Subida / Maré) em PDF via expo-print + expo-sharing, com destaque de lanchas atrasadas.
- **Busca por lancha** no Painel da Marina: filtra Movimentação e Quadro pelo nome da lancha.
- **Conveniência** (`/conveniencia`): cliente monta pedido a partir de catálogo pré-definido (admin gerencia em `/admin-produtos`), escolhe quantidades + observação; vê "Meus pedidos". Backend: `products`, `convenience_orders`.
- **Autorizar Entrada** (`/autorizar`): cliente autoriza terceiro a usar a lancha (nome + lancha + data); lista/cancela autorizações. Backend: `authorizations`.
- **Emergência** (`/emergencia`): botão SOS com confirmação, registra chamado (cliente + lancha + local/observação); cliente vê histórico. Backend: `emergencies`.
- **Pedidos & Chamados** (`/admin-solicitacoes`, acesso admin e funcionário): abas Conveniência / Autorizações / Emergências. Equipe entrega/cancela pedidos, cancela autorizações e marca emergências como atendidas (badge de emergências abertas).
- **Gestão de Produtos** (`/admin-produtos`): admin adiciona/remove produtos, ativa/desativa e define preços.

## CPF administrador
- `00000000000` — Administração Marina (redireciona para o Painel).

## Enhancement (próxima iteração sugerida)
- **Dashboard operacional (revenue booster)**: painel do administrador da marina para visualização diária e cobrança/relatório de utilização por lancha, permitindo tarifação de lançamento/retorno.
