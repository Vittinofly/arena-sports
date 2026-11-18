/* ============================================================
   Arena Esporte: configuração central
   ------------------------------------------------------------
   1. Crie o projeto no Supabase e rode supabase/schema.sql.
   2. Cole aqui a "Project URL" e a chave "anon public"
      (Supabase > Project Settings > API).
   Sem as duas chaves o site roda em MODO DEMONSTRAÇÃO: reservas,
   horários e feriados ficam salvos só no navegador de quem usa.

   Contatos, horários, quadras, preços e regras são editados no
   painel (admin.html). O que estiver salvo lá vale mais que isto.
   ============================================================ */
window.ARENA_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',

  // Endereço final do site, com barra no fim (links do WhatsApp e da reserva)
  siteUrl: 'https://arena-esporte.netlify.app/',

  // Login do painel SÓ no modo demonstração (sem Supabase). Troque antes de mostrar ao cliente.
  // Com o Supabase ligado isto é ignorado: o login é o usuário criado em Authentication > Users.
  demoAdmin: {
    email: 'admin@arenaesporte.com.br',
    senha: 'arena2026'
  },

  negocio: {
    nome: 'Arena Esporte',
    whatsapp: '5564984579527',
    telefone: '(64) 98457-9527',
    mensagemWhatsapp: 'Olá! Vim pelo site da Arena Esporte.',
    instagramUrl: 'https://www.instagram.com/arenaesportesaoluis/',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=FJ8F%2BP6%20S%C3%A3o%20Lu%C3%ADs%20de%20Montes%20Belos%2C%20GO',
    endereco: 'Chácara Bom Jesus, abaixo da Fosbel, R. Jabaquara, St. Central, São Luís de Montes Belos - GO, 76100-000'
  }
};
