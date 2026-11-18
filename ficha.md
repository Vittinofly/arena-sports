# Ficha do cliente: Arena Esporte

Fontes: Instagram @arenaesportesaoluis (prints enviados pelo Victor em 18/11/2026), perfil do Google Maps "Arena esporte" (texto colado pelo Victor), 7 fotos (drone, time masculino à noite, time feminino, quadras iluminadas, logo) e conversa com o Victor.

## DADOS DO NEGÓCIO
- Nome da empresa: Arena Esporte (Instagram e logo: "Arena Esporte"; a pasta do projeto chama "Arena Sports")
- Nicho: arena de futevôlei e vôlei de areia (Instagram: categoria "Esportes"; Google: "Quadra de esportes")
- Tipo: B2C
- Cidade/UF e bairro: São Luís de Montes Belos/GO, St. Central
- Endereço completo: Chácara Bom Jesus, abaixo da Fosbel (bio do Instagram). No Google: R. Jabaquara, St. Central, São Luís de Montes Belos - GO, 76100-000
- Plus Code: FJ8F+P6 São Luís de Montes Belos. Coordenadas calculadas a partir dele: -16.53319, -50.37694 [CONFIRMAR: conferir o pin no Maps]
- Área atendida: no local
- Horário: o Google mostrava "Fechado · Abre qua. às 17:00" (lido em 17/11/2026). O site começa com todos os dias das 17h às 23h [CONFIRMAR: dias e horário de fechamento; ajustar no painel em "Horário e regras"]
- WhatsApp: 5564984579527 (bio do Instagram)
- Mensagem padrão do WhatsApp: "Olá! Vim pelo site da Arena Esporte."
- Redes sociais: https://www.instagram.com/arenaesportesaoluis/ (297 posts, 1.071 seguidores em 18/11/2026; destaques "Jogadores", "Destaques" e "Jogos")
- CNPJ/Razão social: [PREENCHER]
- Tempo de mercado: [PREENCHER]
- Diferenciais reais (das fotos e da conversa):
  - 3 quadras de areia cercadas por tela, com rede (contadas no drone e confirmadas pelo Victor)
  - Refletores: jogos à noite (fotos noturnas)
  - Varanda coberta com mesas, cadeiras e tenda azul de sombra ao lado das quadras
  - Pátio para estacionar dentro da chácara
  - Times masculino e feminino jogam lá (fotos de turmas com uniforme)

## PÚBLICO E COMUNICAÇÃO
- Público-alvo: jogadores de futevôlei e vôlei de areia de São Luís de Montes Belos, duplas e turmas que jogam à noite depois do serviço, times que treinam toda semana
- Tom de voz: casual e direto, com "a gente" e "bora". A bio usa "venha jogar com seus amigos"
- Principal objeção: "tem horário livre?" e "como marco sem ficar esperando resposta?". Também: o acesso por estrada de terra (citado no Google)

## CONTEÚDO REAL DISPONÍVEL
- Serviços: aluguel de quadra por hora (futevôlei e vôlei de areia), horário fixo semanal, racha/torneio/confraternização com as 3 quadras
- Planos/preços: SEM TABELA. O valor da hora é cadastrado no painel; vazio aparece como "combinado na arena" [PREENCHER no painel]
- Pagamento: na arena (decidido com o Victor). Pix opcional fica pronto para ligar no painel
- Depoimentos reais: 1 avaliação do Google, de Caio Fleury (Local Guide): "Local com quadras de areia, boas quadras, bolas de qualidade, areia um pouco pesada, mas sem pedras." O mesmo texto cita como ponto negativo a estrada de terra com buracos em algumas épocas (usado com honestidade no FAQ). Nota no Google: 3,8 com 4 avaliações (não usada no site). Outros 2 cards do carrossel: [PREENCHER]
- Perguntas frequentes conhecidas: como marcar, preço, pagamento, quantas reservas, cancelamento, jogo à noite, feriado, como chegar
- Mídias: logo (só 150 × 150 px; pedir arquivo maior), 6 fotos tratadas em img/ (originais em img/originais/)

## ESTILO
- Estilo visual: "Fim de tarde na areia", tirado do logo. Azul-marinho da noite de jogo, amarelo do sol, creme e areia; a rede da quadra vira divisor entre seções
- Paleta: #0E1433 (marinho), #090E26 (fundo escuro), #2451A6 (azul do logo), #F5B731 (amarelo, ação principal), #FBF3E1 (creme), #F3E4C4 (areia)
- Modo base: claro (areia) com blocos escuros (noite)
- Tecnologia: CSS puro com :root
- Fontes: Archivo variável (condensada e pesada nos títulos, normal no texto), no próprio site, licença OFL
- Animação: moderada. Assinatura: a bola sobe em arco por cima das fotos do hero

## SISTEMA (decidido com o Victor em 18/11/2026)
- Páginas: landing (index.html), agendamento (agendar.html), minha reserva (reserva.html) e painel com login obrigatório (admin.html). App instalável no celular (PWA)
- Backend: Supabase, com as regras de negócio no banco. Sem chaves, roda em modo demonstração
- Quadras: 3, editáveis no painel (em uso / só no balcão)
- "Cliente agenda somente uma vez" = 1 reserva ativa por WhatsApp; ajustável no painel
- Reserva entra pendente e o ADM confirma pelo painel, com mensagem pronta de WhatsApp

## DEV
- Victor Hugo (Vittino Fly), https://vittinofly.netlify.app/
