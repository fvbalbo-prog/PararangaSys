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

## CPF administrador
- `00000000000` — Administração Marina (redireciona para o Painel).

## Enhancement (próxima iteração sugerida)
- **Dashboard operacional (revenue booster)**: painel do administrador da marina para visualização diária e cobrança/relatório de utilização por lancha, permitindo tarifação de lançamento/retorno.
