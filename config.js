/* =============================================
   config.js — para onde o site fala
   =============================================
   A chave abaixo é pública de propósito: ela só
   permite o que as regras de acesso do banco
   permitirem. A chave secreta não existe aqui.
   ============================================= */

const CONFIG = {
  url: "https://wgzxstcsnkdvgkcqbviq.supabase.co",
  chave: "sb_publishable_b8YG28lBJhzVKwFO1X4QmQ_ZJMGN2Ck",
  // O Supabase exige um identificador com cara de e-mail.
  // Ele nunca recebe nada: é só nome de usuário.
  dominio: "contagens.app",

  // O app dos postos (Rotta400) é outro projeto, com outro banco. O
  // cadastro de produtos é carregado aqui e vai para lá no fim da carga
  // — ver rotta400.js. Esta chave também é pública de propósito.
  rotta400: {
    url: "https://twplewtoroemdvrusptp.supabase.co",
    chave: "sb_publishable_44xTqaCIszjIoBW5Qk8gFg_Wc44DDPo",
  },
};
