#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## user_problem_statement: "App Marina Pararanga — iteração 9: PDF do quadro (admin), busca por lancha (admin), e 3 novas features: Conveniência (loja com catálogo), Autorizar Entrada (terceiros na lancha), Emergência (SOS)."

## backend:
##   - task: "Conveniência: produtos + pedidos"
##     implemented: true
##     working: "NA"
##     file: "backend/server.py"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Endpoints GET/POST/PUT/DELETE /products, POST/GET /convenience/orders, PATCH /convenience/orders/{id}/status. Seed de 6 produtos."
##   - task: "Autorizações"
##     implemented: true
##     working: "NA"
##     file: "backend/server.py"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "POST/GET /authorizations, PATCH /authorizations/{id}/cancel."
##   - task: "Emergências"
##     implemented: true
##     working: "NA"
##     file: "backend/server.py"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "POST/GET /emergencies, PATCH /emergencies/{id}/resolve."

## frontend:
##   - task: "Admin PDF export + busca por lancha"
##     implemented: true
##     working: "NA"
##     file: "frontend/app/admin.tsx"
##     needs_retesting: true
##   - task: "Telas Conveniência / Autorizar / Emergência (cliente)"
##     implemented: true
##     working: "NA"
##     file: "frontend/app/conveniencia.tsx, autorizar.tsx, emergencia.tsx"
##     needs_retesting: true
##   - task: "Pedidos & Chamados (admin/staff) + Produtos (admin)"
##     implemented: true
##     working: "NA"
##     file: "frontend/app/admin-solicitacoes.tsx, admin-produtos.tsx"
##     needs_retesting: true

## metadata:
##   created_by: "main_agent"
##   version: "1.9"
##   test_sequence: 9

## test_plan:
##   current_focus:
##     - "Conveniência: produtos + pedidos"
##     - "Autorizações"
##     - "Emergências"
##     - "Telas Conveniência / Autorizar / Emergência (cliente)"
##     - "Pedidos & Chamados (admin/staff) + Produtos (admin)"
##   stuck_tasks: []
##   test_all: false
##   test_priority: "high_first"

## agent_communication:
##     -agent: "main"
##     -message: "Iteração 9 implementada. Testar backend (produtos, pedidos, autorizações, emergências CRUD) e frontend (fluxos cliente das 3 telas; admin/staff Pedidos & Chamados; admin Produtos; PDF/busca do quadro). Credenciais: Admin 00000/0000, Staff 55555/0055, Cliente 11111/1111."

## agent_communication (iteração 9.1):
##     -agent: "main"
##     -message: "Iteração 9.1: (1) PDF do quadro agora inclui coluna Conveniência (total de pedidos por lancha no dia) + linha de total do dia; (2) Banner de emergência no topo do painel do funcionário (staff.tsx) quando há emergência aberta, com contagem e navegação; (3) Estoque de produtos: campo in_stock (admin toggle em admin-produtos com ícone cube; cliente vê 'Sem estoque' e não consegue pedir; backend rejeita pedido de item sem estoque/inativo); (4) Autorizações: aba em admin-solicitacoes agora tem filtro 'Válidas hoje' (padrão) x 'Todas' mostrando só ativas com date==hoje. Testar backend (stock validation já validado via curl: rejeita sem estoque) e frontend flows."

## agent_communication (iteração 9.2):
##     -agent: "main"
##     -message: "Iteração 9.2: (1) Resumo do Caixa - card no topo da aba Conveniência (admin-solicitacoes) com totais Hoje e Semana (testID caixa-hoje/caixa-semana); (2) Aviso Sonoro de Emergência - staff.tsx e admin-solicitacoes.tsx fazem polling a cada 15s e tocam som (expo-audio, assets/sounds/alert.wav) + vibração quando a contagem de emergências abertas AUMENTA; (3) Confirmar Autorização na Portaria - backend PATCH /authorizations/{id}/checkin seta entered_at; admin-solicitacoes mostra botão auth-checkin-{id} e exibe 'Entrou às HH:MM'; (4) Foto do Produto - Emergent Object Storage: POST /api/products/{id}/image (multipart) + GET /api/files/{path}; admin-produtos permite escolher foto (expo-image-picker, permissão tratada) e cliente vê thumbnail; (5) Categorias - Bebidas/Sorvetes/Açaí/Outros com ícones; produto tem campo category; conveniencia agrupa por categoria; admin-produtos tem chips de categoria (produto-cat-{cat}). Object storage upload+serve JA validado via curl (status 200, image/png). Credenciais: Admin 00000/0000, Staff 55555/0055, Cliente 11111 (CPF completo 11111111111)/1111."

## agent_communication (iteração 10):
##     -agent: "main"
##     -message: "Iteração 10 (6 pedidos do usuário): (1) FILTRO DE CATEGORIA na loja do cliente (/conveniencia) - chips 'Todos' + Bebidas/Sorvetes/Açaí/Outros (testID cat-filter-*); (2) CADASTRO DE FUNCIONÁRIO em /admin-clientes - modal com toggle Cliente/Funcionário (testID role-cliente/role-funcionario), cria user is_staff=true que acessa só painel funcionário; badge 'Funcionário' no card; POST /api/users aceita is_staff; /api/users agora lista staff também; (3) PAINEL STATUS DARK (/admin-status) fundo escuro letras brancas; (4) RELATÓRIO DE CONSUMO /admin-relatorio (GET /api/reports/consumo?month=YYYY-MM) agrupa por cliente conveniência+reboque, navegação por mês; acessível tocando no card Caixa em /admin-solicitacoes; conveniência lançada na conta assim que o pedido é feito; (5) EMERGÊNCIA -> admin recebe banner no painel (/admin, testID admin-emergency-banner) E no painel status aparece tag vermelha 'EMERGÊNCIA' ao lado da lancha (testID status-emergency-{id}) + banner; (6) REBOQUE na tela /emergencia - aba Socorro/Reboque (tab-socorro/tab-reboque); reboque usa comprimento da lancha (pés) e distância em MN, mostra cotação (GET /api/reboque/quote, POST /api/reboque). Tabela: <=25pés base1200 +120/MN; 26-35 base1800 +180/MN; 36+ base2500 +250/MN; primeiras 5MN inclusas. Admin lança valor final na conta pela aba Emergências (testID reboque-bill-{id}, PATCH /api/emergencies/{id}/bill). Validado via curl: quote 24ft/8NM=1560, 40ft/10NM=3750; staff user criado; reboque criado est=1560. Credenciais: Admin 00000/0000, Staff 55555/0055, Cliente 11111 (CPF 11111111111)/1111."
