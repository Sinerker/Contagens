/* =============================================
   cadastro-worker.js — lê os relatórios do sistema
   =============================================
   Roda fora da tela para o navegador não travar:
   são ~130 mil linhas de níveis e ~120 mil de EANs.

   Não devolve tudo de uma vez. Manda um bloco, espera
   a tela confirmar que enviou, manda o próximo. Assim
   a memória nunca segura o cadastro inteiro em forma
   de objeto — que é o que derruba aparelho fraco.

   O relatório de níveis traz UM código por produto,
   inclusive os que o relatório de EANs não traz (os
   gerados pelo sistema e os internos curtos). O de
   EANs traz TODOS os códigos de cada produto, com a
   embalagem certa. Os dois entram; quando o mesmo
   código vem dos dois, vale o do relatório de EANs.
   ============================================= */

const TAMANHO_BLOCO = 2000;
const DO_NIVEL = 1; // prioridade: perde para o relatório de EANs

let liberado = null;
let bytesLidos = 0;

self.onmessage = async (e) => {
  const { tipo } = e.data || {};
  if (tipo === "continuar") { if (liberado) liberado(); return; }
  if (tipo === "processar") {
    try { await processar(e.data); }
    catch (err) {
      self.postMessage({ tipo: "erro", mensagem: (err && err.message) || String(err) });
    }
  }
};

const esperarTela = () => new Promise((r) => { liberado = r; });

async function enviarBloco(destino, linhas) {
  self.postMessage({ tipo: "bloco", destino, linhas });
  await esperarTela();
}

// -----------------------------------------------
async function* linhasDe(origem) {
  if (typeof origem === "string") {
    bytesLidos += origem.length;
    let inicio = 0;
    while (inicio <= origem.length) {
      const corte = origem.indexOf("\n", inicio);
      if (corte === -1) { yield origem.slice(inicio); break; }
      yield origem.slice(inicio, corte);
      inicio = corte + 1;
    }
    return;
  }

  const leitor = origem.stream().getReader();
  let decoder = null;   // decidido no primeiro pedaço, ver acharCodificacao
  let resto = "";
  while (true) {
    const { done, value } = await leitor.read();
    if (value) {
      bytesLidos += value.byteLength;
      if (!decoder) decoder = new TextDecoder(acharCodificacao(value));
      resto += decoder.decode(value, { stream: true });
      let inicio = 0, corte = resto.indexOf("\n", inicio);
      while (corte !== -1) {
        yield resto.slice(inicio, corte);
        inicio = corte + 1;
        corte = resto.indexOf("\n", inicio);
      }
      if (inicio > 0) resto = resto.slice(inicio);
    }
    if (done) break;
  }
  if (decoder) resto += decoder.decode();
  if (resto) yield resto;
}

// O relatório nem sempre vem em UTF-8. O de níveis exportado em 07/10/2026
// veio em Windows-1252 (acento ocupa um byte só), e o decodificador de UTF-8
// troca cada acento por "\uFFFD": a descrição chega suja e ninguém percebe até
// alguém procurar "AÇÚCAR" e não achar. Então: tenta UTF-8 de verdade
// (fatal: true faz ele reclamar em vez de remendar) e, se o arquivo não for
// UTF-8 válido, lê como Windows-1252.
function acharCodificacao(bytes) {
  try {
    const amostra = bytes.subarray(0, Math.min(bytes.length, 65536));
    // Corta o final para não julgar um caractere partido no meio do pedaço.
    const ate = amostra.length > 4 ? amostra.length - 4 : amostra.length;
    new TextDecoder("utf-8", { fatal: true }).decode(amostra.subarray(0, ate));
    return "utf-8";
  } catch (_) {
    return "windows-1252";
  }
}

// O mesmo relatório sai com TAB numa exportação e com ponto e vírgula noutra.
// Decide pela primeira linha de dados e não se fala mais nisso.
function acharSeparador(linha) {
  return linha.indexOf("\t") !== -1 ? "\t" : ";";
}

function limpar(linha) {
  if (linha.charCodeAt(linha.length - 1) === 13) linha = linha.slice(0, -1);
  if (linha.charCodeAt(0) === 0xfeff) linha = linha.slice(1);
  return linha;
}

// O relatório põe apóstrofo na frente de alguns campos
// (truque do Excel para não virar data). Não é do produto.
function limparTexto(t) {
  return String(t == null ? "" : t).trim().replace(/^'+/, "").trim();
}

// -----------------------------------------------
async function processar({ niveis, eans }) {
  const resumo = {
    niveis: 0, niveisDeclarado: null, semCaminho: 0,
    codigosDoNivel: 0, eans: 0, arquivosEans: 0,
    conflitos: 0, conflitosExemplos: [],
  };

  const donoDoCodigo = new Map(); // código -> produto, para achar conflito

  const anotar = (cod, seq) => {
    const dono = donoDoCodigo.get(cod);
    if (dono === undefined) { donoDoCodigo.set(cod, seq); return; }
    if (dono !== seq) {
      resumo.conflitos++;
      if (resumo.conflitosExemplos.length < 10) {
        resumo.conflitosExemplos.push(`${cod} (produtos ${dono} e ${seq})`);
      }
    }
  };

  const avisar = () => self.postMessage({
    tipo: "andamento", niveis: resumo.niveis,
    eans: resumo.eans + resumo.codigosDoNivel, bytes: bytesLidos,
  });

  // ---------- Níveis ----------
  let blocoNivel = [], blocoCodigo = [];

  if (niveis) {
    let primeira = true;
    let sep = null;
    for await (const bruta of linhasDe(niveis)) {
      const linha = limpar(bruta);
      if (!linha.trim()) continue;

      const total = linha.match(/TOTAL:\s*([\d.]+)\s*linhas/i);
      if (total) { resumo.niveisDeclarado = parseInt(total[1].replace(/\./g, ""), 10); continue; }

      if (sep === null) sep = acharSeparador(linha);
      const col = linha.split(sep);
      if (primeira) { primeira = false; if (!/^\d+$/.test(col[0].trim())) continue; }

      const seq = parseInt(col[0], 10);
      if (!Number.isFinite(seq)) continue;

      // Primeira coluna é o produto; as DUAS ÚLTIMAS são embalagem e código.
      // O que sobra no meio é "descrição : caminho" — e a descrição pode ter
      // o separador dentro dela, então ela é remontada, não recortada.
      const meio = (col.length >= 4 ? col.slice(1, col.length - 2).join(sep) : (col[1] || "")).trim();
      const colEmb = col.length >= 3 ? col[col.length - 2] : "";
      const colCod = col.length >= 4 ? col[col.length - 1] : "";
      // O caminho nunca tem " : ", a descrição às vezes tem.
      // Por isso o corte é no ÚLTIMO, não no primeiro.
      const corte = meio.lastIndexOf(" : ");
      const descricao = limparTexto(corte === -1 ? meio : meio.slice(0, corte));
      const caminho = corte === -1 ? "" : meio.slice(corte + 3).trim();
      if (!caminho) resumo.semCaminho++;

      blocoNivel.push({
        seqproduto: seq,
        descricao,
        caminho: caminho || null,
        embalagem_unitaria: limparTexto(colEmb) || null,
      });
      resumo.niveis++;

      const cod = limparTexto(colCod);
      if (cod) {
        anotar(cod, seq);
        blocoCodigo.push({
          seqproduto: seq, descricao, codacesso: cod,
          qtdembalagem: "1", prioridade: DO_NIVEL,
        });
        resumo.codigosDoNivel++;
      }

      if (blocoNivel.length >= TAMANHO_BLOCO) {
        await enviarBloco("niveis", blocoNivel); blocoNivel = []; avisar();
      }
      if (blocoCodigo.length >= TAMANHO_BLOCO) {
        await enviarBloco("eans", blocoCodigo); blocoCodigo = [];
      }
    }
    if (blocoNivel.length) await enviarBloco("niveis", blocoNivel);
    if (blocoCodigo.length) await enviarBloco("eans", blocoCodigo);
  }

  // ---------- EANs ----------
  let bloco = [];
  for (const arquivo of eans) {
    resumo.arquivosEans++;
    let primeira = true;
    let sepE = null;

    for await (const bruta of linhasDe(arquivo)) {
      const linha = limpar(bruta);
      if (!linha.trim()) continue;

      if (sepE === null) sepE = acharSeparador(linha);
      const p = linha.split(sepE);
      if (primeira) { primeira = false; if (!/^\d+$/.test(p[0].trim())) continue; }
      if (p.length < 4) continue;

      const seq = parseInt(p[0], 10);
      if (!Number.isFinite(seq)) continue;

      // Descrição com ";" no meio não pode empurrar as colunas:
      // código e embalagem são sempre as DUAS ÚLTIMAS.
      const qtd = p[p.length - 1].trim();
      const cod = limparTexto(p[p.length - 2]);
      const descricao = limparTexto(p.slice(1, p.length - 2).join(sepE));
      if (!cod) continue;

      anotar(cod, seq);
      bloco.push({
        seqproduto: seq, descricao, codacesso: cod,
        qtdembalagem: qtd.replace(",", ".") || "1", prioridade: 0,
      });
      resumo.eans++;

      if (bloco.length >= TAMANHO_BLOCO) {
        await enviarBloco("eans", bloco); bloco = []; avisar();
      }
    }
  }
  if (bloco.length) await enviarBloco("eans", bloco);

  resumo.codigosDistintos = donoDoCodigo.size;
  self.postMessage({ tipo: "fim", resumo });
}
