/* =============================================
   fechamento.js — finalizar, fechar e entregar
   =============================================
   Três coisas acontecem aqui, nesta ordem, e a ordem
   importa:

   1. Cada contador diz que terminou a parte dele.
   2. Quando o último termina, o lote fecha.
   3. Do lote fechado saem o TXT e o CSV, por download
      e por e-mail.

   A regra que este arquivo existe para proteger: ninguém
   finaliza com contagem parada na fila. O servidor não
   sabe que elas existem — se a pessoa finalizar sem sinal
   e os outros também finalizarem, o lote fecha e o TXT
   sai sem esses lançamentos. Por isso o botão de
   finalizar sobe a fila primeiro e só libera com ela
   vazia.
   ============================================= */

const sessao = API.exigirLogin();
const loteId = Number(new URLSearchParams(location.search).get("lote"));

const $ = (id) => document.getElementById(id);
const numero = (n) => Number(n || 0).toLocaleString("pt-BR");

let lote = null;
let participantes = [];
let arquivos = null;   // o que gerar_arquivos devolveu

function quando(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function erro(msg) {
  $("erro").textContent = msg;
  $("erro").hidden = !msg;
  if (msg) window.scrollTo({ top: 0, behavior: "smooth" });
}

function recado(msg) {
  $("recado").textContent = msg;
  $("recado").hidden = !msg;
}

/* ---------- carregar ---------- */
async function carregar() {
  erro("");

  const [resumo, pessoas] = await Promise.all([
    API.selecionar("lote_resumo", `select=*&id=eq.${loteId}`),
    API.selecionar(
      "lote_participante",
      `select=perfil_id,entrou_em,finalizado_em,perfil(nome)&lote_id=eq.${loteId}`
    ),
  ]);

  if (!resumo.length) {
    erro("Inventário não encontrado.");
    return;
  }

  lote = resumo[0];
  participantes = pessoas;

  $("lote-nome").textContent = lote.nome;
  $("lote-loja").textContent = `${lote.loja_codigo} · ${lote.loja_nome}`;
  $("n-produtos").textContent = numero(lote.itens);
  $("n-lancamentos").textContent = numero(lote.lancamentos);
  $("n-contadores").textContent = numero(lote.participantes);

  const faltam = lote.participantes - lote.finalizados;
  $("situacao").textContent =
    lote.status === "fechado"
      ? `Fechado em ${quando(lote.fechado_em)}.`
      : faltam === 0
        ? "Todo mundo finalizou. Pode fechar."
        : `${faltam} de ${lote.participantes} ainda não finalizou.`;

  desenharPessoas();
  await desenharMinhaParte();
  desenharFechar();
  desenharArquivos();
  await desenharLimpeza();
}

function desenharPessoas() {
  if (!participantes.length) {
    $("pessoas").innerHTML = "<p class='cartao-ajuda'>Ninguém entrou neste inventário ainda.</p>";
    return;
  }
  $("pessoas").innerHTML = participantes
    .slice()
    .sort((a, b) => (a.perfil?.nome || "").localeCompare(b.perfil?.nome || ""))
    .map((p) => {
      const pronto = !!p.finalizado_em;
      return `
        <div class="pessoa">
          <span class="pessoa-bola" style="background:${pronto ? "var(--clr-success)" : "var(--clr-warning-border)"}"></span>
          <span class="pessoa-nome">${p.perfil?.nome || "—"}</span>
          <span class="pessoa-quando">${pronto ? "finalizou " + quando(p.finalizado_em) : "ainda contando"}</span>
        </div>`;
    })
    .join("");
}

/* ---------- minha parte ---------- */
function souParticipante() {
  return participantes.some((p) => p.perfil_id === sessao.usuario.id);
}

function jaFinalizei() {
  const eu = participantes.find((p) => p.perfil_id === sessao.usuario.id);
  return eu ? eu.finalizado_em : null;
}

async function pendentesDoLote() {
  const todas = await LOCAL.doLote(loteId);
  return todas.filter((c) => !c.enviado).length;
}

async function desenharMinhaParte() {
  const btnF = $("btn-finalizar");
  const btnV = $("btn-voltar-contar");
  btnF.hidden = true;
  btnV.hidden = true;

  if (!souParticipante()) {
    $("minha-parte").textContent = "Você não está participando deste inventário.";
    return;
  }

  const quandoFinalizei = jaFinalizei();
  const pendentes = await pendentesDoLote();

  if (lote.status === "fechado") {
    $("minha-parte").textContent = quandoFinalizei
      ? `Você finalizou em ${quando(quandoFinalizei)}.`
      : "O inventário foi fechado antes de você finalizar.";
    return;
  }

  if (quandoFinalizei) {
    $("minha-parte").textContent =
      `Você finalizou em ${quando(quandoFinalizei)}. Enquanto o inventário não fechar, ainda dá para voltar e contar mais.`;
    btnV.hidden = false;
    return;
  }

  if (pendentes > 0) {
    $("minha-parte").innerHTML =
      `<b>${numero(pendentes)} contagem(ns) ainda não subiram</b> deste aparelho. ` +
      `Elas estão guardadas aqui e não se perdem, mas finalizar agora deixaria o arquivo sair sem elas. ` +
      `Conecte à internet — a fila sobe sozinha e o botão libera.`;
  } else {
    $("minha-parte").textContent =
      "Tudo o que você contou já subiu. Ao finalizar, a lista de produtos sai deste aparelho para liberar espaço; suas contagens continuam guardadas.";
  }

  btnF.hidden = false;
  btnF.disabled = pendentes > 0;
  btnF.textContent = pendentes > 0
    ? `Aguardando ${numero(pendentes)} contagem(ns) subir…`
    : "Finalizei minha contagem";
}

async function finalizar() {
  const btn = $("btn-finalizar");
  erro("");
  recado("");

  if (!navigator.onLine) {
    erro("Finalizar precisa de internet: é assim que os outros ficam sabendo que você terminou.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Subindo o que falta…";

  try {
    // Última tentativa de esvaziar a fila antes de travar a decisão.
    await FILA.enviar();
    const pendentes = await pendentesDoLote();
    if (pendentes > 0) {
      // A ordem importa: carregar() limpa o aviso de erro, então a recusa
      // tem que ser escrita DEPOIS de redesenhar a tela. Ao contrário, a
      // pessoa clica, nada acontece e ela acha que finalizou.
      await carregar();
      erro(`Ainda faltam ${numero(pendentes)} contagem(ns) subir. Não dá para finalizar sem elas — o arquivo sairia incompleto.`);
      return;
    }

    btn.textContent = "Finalizando…";
    await API.rpc("finalizar_participacao", { p_lote: loteId });

    // A lista de produtos não serve mais para esta pessoa neste lote.
    // As contagens ficam.
    await LOCAL.soltarLista(loteId);

    recado("Sua parte está finalizada. A lista de produtos saiu deste aparelho e liberou o espaço dela.");
    await carregar();
  } catch (e) {
    erro(API.erro(e));
    await desenharMinhaParte();
  }
}

async function voltarAContar() {
  sessionStorage.setItem("loteAtivo", String(loteId));
  location.href = `contagens.html?lote=${loteId}`;
}

/* ---------- fechar ---------- */
function desenharFechar() {
  const mostrar = lote.status === "aberto" && (souParticipante() || sessao.usuario.admin);
  $("titulo-fechar").hidden = !mostrar;
  $("cartao-fechar").hidden = !mostrar;
  if (!mostrar) return;

  const faltam = lote.participantes - lote.finalizados;
  const btn = $("btn-fechar");

  if (faltam === 0) {
    $("ajuda-fechar").textContent =
      "Todos finalizaram. Fechar encerra o inventário e libera o TXT e o CSV. Depois de fechado, ninguém lança mais nada nele.";
    btn.disabled = false;
    btn.textContent = "Fechar e gerar os arquivos";
  } else if (sessao.usuario.admin) {
    $("ajuda-fechar").innerHTML =
      `<b>${faltam} pessoa(s) ainda não finalizou.</b> Como administrador você pode fechar mesmo assim — ` +
      `use isso quando alguém não tiver como finalizar. O que essa pessoa já lançou entra no arquivo; o que estiver parado no aparelho dela, não.`;
    btn.disabled = false;
    btn.textContent = "Fechar mesmo assim";
  } else {
    $("ajuda-fechar").textContent =
      `Ainda faltam ${faltam} de ${lote.participantes} finalizar. Só dá para fechar quando todos terminarem.`;
    btn.disabled = true;
    btn.textContent = "Fechar e gerar os arquivos";
  }
}

async function fechar() {
  const faltam = lote.participantes - lote.finalizados;
  const forcar = faltam > 0;

  const pergunta = forcar
    ? `Fechar com ${faltam} pessoa(s) sem finalizar? O que elas não subiram fica de fora do arquivo. Isso não tem volta.`
    : "Fechar o inventário? Depois disso ninguém lança mais nada nele.";
  if (!confirm(pergunta)) return;

  const btn = $("btn-fechar");
  btn.disabled = true;
  btn.textContent = "Fechando…";
  erro("");

  try {
    await API.rpc("fechar_lote", { p_lote: loteId, p_forcar: forcar });
    recado("Inventário fechado. Os arquivos estão prontos abaixo.");
    await carregar();
    await gerar();
  } catch (e) {
    erro(API.erro(e));
    desenharFechar();
  }
}

/* ---------- arquivos ---------- */
function apagado() {
  return !!lote.contagens_apagadas_em;
}

function desenharArquivos() {
  const mostrar = lote.status === "fechado";
  $("titulo-arquivos").hidden = !mostrar;
  $("cartao-arquivos").hidden = !mostrar;
  if (!mostrar) return;

  if (apagado()) {
    // Sem as contagens não há como remontar os arquivos. Melhor dizer isso
    // do que deixar três botões que só entregariam arquivo vazio.
    $("ajuda-arquivos").innerHTML =
      `As contagens deste inventário foram apagadas em <b>${quando(lote.contagens_apagadas_em)}</b> para liberar espaço. ` +
      `O TXT e o CSV saíram por e-mail antes disso — procure no e-mail ou no OneDrive.`;
    for (const b of ["btn-txt", "btn-csv", "btn-email"]) $(b).hidden = true;
    return;
  }
  for (const b of ["btn-txt", "btn-csv", "btn-email"]) $(b).hidden = false;
  if (!arquivos) $("ajuda-arquivos").textContent = "Montando os arquivos…";
}

async function gerar() {
  if (lote.status !== "fechado" || apagado()) return;
  try {
    arquivos = await API.rpc("gerar_arquivos", { p_lote: loteId });
    const avisos = [];
    if (arquivos.sem_codigo_lancamentos > 0) {
      avisos.push(
        `${numero(arquivos.sem_codigo_lancamentos)} lançamento(s) de produto sem código de barras ` +
        `(${numero(arquivos.sem_codigo_produtos)} produto(s)) ficaram de fora do TXT — o sistema importa por código. ` +
        `Eles estão no CSV.`
      );
    }
    $("ajuda-arquivos").innerHTML =
      `<b>${arquivos.arquivo}</b><br>` +
      `TXT: ${numero(arquivos.produtos)} códigos somados. CSV: ${numero(arquivos.lancamentos)} lançamentos.` +
      (avisos.length ? "<br><br>" + avisos.join(" ") : "");
  } catch (e) {
    $("ajuda-arquivos").textContent = "Não consegui montar os arquivos: " + API.erro(e);
  }
}

function baixar(conteudo, nome, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function baixarTxt() {
  if (!arquivos) await gerar();
  if (!arquivos) return;
  baixar(arquivos.txt, `${arquivos.arquivo}.txt`, "text/plain;charset=utf-8;");
}

async function baixarCsv() {
  if (!arquivos) await gerar();
  if (!arquivos) return;
  // O BOM é o que faz o Excel ler os acentos.
  baixar("﻿" + arquivos.csv, `${arquivos.arquivo}.csv`, "text/csv;charset=utf-8;");
}

async function enviarEmail() {
  const btn = $("btn-email");
  btn.disabled = true;
  btn.textContent = "Enviando…";
  erro("");
  try {
    const r = await API.funcao("enviar-arquivos", { lote_id: loteId });
    // O carimbo do envio é o que libera a limpeza automática. Sem ele, nada
    // é apagado sozinho — é a diferença entre liberar espaço e perder dado.
    try { await API.rpc("marcar_enviado", { p_lote: loteId }); } catch (_) {}
    recado(r.mensagem || "E-mail enviado com o TXT e o CSV em anexo.");
    await carregar();
  } catch (e) {
    erro("Não consegui enviar: " + API.erro(e) + " Os arquivos continuam disponíveis para baixar aqui.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Enviar por e-mail";
  }
}

/* ---------- apagar o inventário ---------- */
// Uma ação só, e ela leva tudo: os lançamentos e o inventário no servidor,
// e a lista e as contagens neste aparelho. O TXT e o CSV não ficam guardados
// em lugar nenhum — são montados na hora, a partir dos lançamentos. Então
// apagar é apagar a possibilidade de gerar os arquivos de novo, e por isso
// existe uma única condição, sem exceção: o e-mail precisa ter saído.
function diasDesde(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

async function desenharLimpeza() {
  const mostrar = lote.status === "fechado";
  $("titulo-limpeza").hidden = !mostrar;
  $("cartao-limpeza").hidden = !mostrar;
  if (!mostrar) return;

  const btn = $("btn-apagar-inventario");

  // O que este aparelho ainda guarda deste inventário
  const estado = await LOCAL.estado(loteId);
  const locais = await LOCAL.doLote(loteId);
  const pendentes = locais.filter((c) => !c.enviado).length;
  const guarda = [];
  if (estado.baixados > 0) guarda.push(`a lista de ${numero(estado.baixados)} produtos`);
  if (locais.length > 0) guarda.push(`${numero(locais.length)} contagem(ns)`);
  $("ajuda-espaco").textContent = guarda.length
    ? `Neste aparelho: ${guarda.join(" e ")}.`
    : "Este aparelho não guarda mais nada deste inventário.";

  // O e-mail é exigido enquanto houver o que perder. Inventário sem nenhum
  // lançamento — porque ninguém contou, ou porque já foram apagados antes —
  // não tem arquivo para proteger.
  const temOQuePerder = !apagado() && Number(lote.lancamentos || 0) > 0;

  if (temOQuePerder && !lote.enviado_em) {
    $("ajuda-limpeza").innerHTML =
      `<b>Só dá para apagar depois que o e-mail sair.</b> Os arquivos não ficam guardados no servidor — ` +
      `eles são montados na hora, a partir dos lançamentos. Enquanto o e-mail não for enviado, apagar ` +
      `deixaria você sem o TXT e sem o CSV, sem volta. Envie acima e o botão libera.`;
    btn.disabled = true;
    btn.textContent = "Apagar (bloqueado até enviar o e-mail)";
    return;
  }

  if (pendentes > 0) {
    $("ajuda-limpeza").innerHTML =
      `<b>${numero(pendentes)} contagem(ns) deste aparelho ainda não subiram.</b> ` +
      `Apagar agora perderia essas. Conecte à internet e espere a fila esvaziar.`;
    btn.disabled = true;
    btn.textContent = "Apagar (aguardando a fila subir)";
    return;
  }

  if (!temOQuePerder) {
    $("ajuda-limpeza").innerHTML = apagado()
      ? `As contagens deste inventário já foram apagadas em <b>${quando(lote.contagens_apagadas_em)}</b>. ` +
        `Sobrou só a casca dele aqui — apagar tira ela da lista de vez.`
      : `Este inventário não tem nenhum lançamento. Não há arquivo para proteger, então pode ser apagado direto.`;
    btn.disabled = false;
    btn.textContent = "Apagar este inventário";
    return;
  }

  const faltam = 7 - diasDesde(lote.enviado_em);
  $("ajuda-limpeza").innerHTML =
    `Enviado por e-mail em <b>${quando(lote.enviado_em)}</b>. ` +
    (faltam > 0
      ? `Se você não fizer nada, ele é apagado sozinho daqui a ${faltam} dia(s). `
      : `Já passou dos 7 dias — vai ser apagado na próxima limpeza da madrugada. `) +
    `Apagar agora tira ele do servidor e deste aparelho de uma vez.`;
  btn.disabled = false;
  btn.textContent = "Apagar este inventário";
}

async function apagarInventario() {

  const temOQuePerder = !apagado() && Number(lote.lancamentos || 0) > 0;
  if (!confirm(
    `Apagar o inventário "${lote.nome}" de vez?\n\n` +
    `Sai do servidor e deste aparelho: os lançamentos, a lista de produtos e o próprio inventário.\n\n` +
    (temOQuePerder
      ? `O TXT e o CSV já foram para o seu e-mail em ${quando(lote.enviado_em)} — depois de apagar, eles não podem mais ser gerados por ninguém. Isso não tem volta.`
      : `Este inventário não tem mais lançamentos, então não há arquivo a perder.`)
  )) return;

  const btn = $("btn-apagar-inventario");
  btn.disabled = true;
  btn.textContent = "Apagando…";
  erro("");

  try {
    // Servidor primeiro: se ele recusar, o aparelho fica intacto.
    const r = await API.rpc("apagar_inventario", { p_lote: loteId });
    // Só então o aparelho.
    try { await LOCAL.esquecerLote(loteId); } catch (_) {
      await LOCAL.limparPacotes(loteId);
    }
    sessionStorage.removeItem("loteAtivo");
    sessionStorage.setItem("recado", `<b>${r.nome}</b> foi apagado do servidor e deste aparelho.`);
    location.href = "lotes.html";
  } catch (e) {
    erro(API.erro(e));
    btn.disabled = false;
    await desenharLimpeza();
  }
}

/* ---------- ligação ---------- */
$("btn-finalizar").addEventListener("click", finalizar);
$("btn-voltar-contar").addEventListener("click", voltarAContar);
$("btn-fechar").addEventListener("click", fechar);
$("btn-txt").addEventListener("click", baixarTxt);
$("btn-csv").addEventListener("click", baixarCsv);
$("btn-email").addEventListener("click", enviarEmail);
$("btn-apagar-inventario").addEventListener("click", apagarInventario);

/* ---------- início ---------- */
(async function iniciar() {
  if (!sessao) return;
  if (!loteId) { location.href = "lotes.html"; return; }
  try {
    await carregar();
    if (lote && lote.status === "fechado" && !apagado()) await gerar();
  } catch (e) {
    erro(API.erro(e));
  }
  // A fila continua trabalhando enquanto a tela está aberta: é o que
  // faz o botão de finalizar liberar sozinho quando o sinal volta.
  FILA.aoMudar = () => desenharMinhaParte().catch(() => {});
  FILA.iniciar();
})();
