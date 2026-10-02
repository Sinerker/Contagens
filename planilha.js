/* =============================================
   planilha.js — monta o XLSX na mão
   =============================================
   Por que à mão: o XLSX é um ZIP com meia dúzia de XML dentro. Uma
   biblioteca de planilha pesa quase um megabyte e traz um mundo de
   recursos que este site não usa — e seria a primeira dependência
   externa do projeto, num app que precisa abrir sem internet.

   Por que XLSX e não só CSV: no CSV quem decide o tipo de cada coluna é
   o Excel, na hora de abrir. Código de barras de 13 dígitos vira número
   e aparece como 7,89199E+12; código que começa com zero perde o zero.
   Aqui cada célula diz o que é: código é TEXTO, quantidade é NÚMERO.

   ATENÇÃO: existe uma cópia deste código dentro da função de e-mail
   (Edge Function `enviar-arquivos`), porque ela roda no servidor, em
   outro ambiente. Mexeu aqui, mexa lá — os dois geram o mesmo arquivo.
   ============================================= */

const PLANILHA = (function () {
  "use strict";

  const TEXTO = "texto";
  const NUMERO = "numero";

  // ---------------------------------------------
  // XML
  // ---------------------------------------------
  function escapar(v) {
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Caractere de controle quebra o arquivo inteiro no Excel. Some.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }

  function letraColuna(n) {
    let s = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = (n - r - 1) / 26;
    }
    return s;
  }

  function celula(ref, valor, tipo, estilo) {
    if (valor === null || valor === undefined || valor === "") return "";
    const s = estilo ? ` s="${estilo}"` : "";
    if (tipo === NUMERO) {
      const n = Number(String(valor).replace(",", "."));
      if (Number.isFinite(n)) return `<c r="${ref}"${s}><v>${n}</v></c>`;
    }
    // Texto vai embutido na própria célula: sem tabela de textos
    // compartilhados, que é mais um arquivo e mais uma chance de erro.
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`;
  }

  function folha(cabecalho, linhas, tipos, larguras) {
    const partes = [];
    partes.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    partes.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    partes.push(`<dimension ref="A1:${letraColuna(cabecalho.length)}${linhas.length + 1}"/>`);
    // Cabeçalho congelado: rolar mil linhas sem perder de vista a coluna.
    partes.push('<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>');
    partes.push('<sheetFormatPr defaultRowHeight="15"/>');

    if (larguras && larguras.length) {
      partes.push("<cols>" + larguras.map((l, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${l}" customWidth="1"/>`).join("") + "</cols>");
    }

    partes.push("<sheetData>");

    partes.push('<row r="1">' + cabecalho.map((t, i) =>
      celula(letraColuna(i + 1) + "1", t, TEXTO, 1)).join("") + "</row>");

    for (let k = 0; k < linhas.length; k++) {
      const r = k + 2;
      const linha = linhas[k];
      const celulas = [];
      for (let c = 0; c < cabecalho.length; c++) {
        celulas.push(celula(letraColuna(c + 1) + r, linha[c], tipos[c], 0));
      }
      partes.push(`<row r="${r}">` + celulas.join("") + "</row>");
    }

    partes.push("</sheetData></worksheet>");
    return partes.join("");
  }

  const CONTEUDO =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";

  const RAIZ_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const LIVRO_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  // Dois estilos só: 0 normal, 1 negrito (o cabeçalho).
  const ESTILOS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  function livro(aba) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${escapar(aba).replace(/"/g, "&quot;")}" sheetId="1" r:id="rId1"/></sheets>` +
      "</workbook>";
  }

  // ---------------------------------------------
  // ZIP
  // ---------------------------------------------
  const TABELA_CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function comprimir(bytes) {
    // Sem compressão o arquivo sai 5 a 10 vezes maior — o XML é repetitivo.
    // Se o navegador não tiver o compressor, grava "armazenado": fica
    // grande, mas abre igual. Melhor grande que quebrado.
    try {
      if (typeof CompressionStream === "undefined") return { metodo: 0, dados: bytes };
      const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const buf = await new Response(fluxo).arrayBuffer();
      return { metodo: 8, dados: new Uint8Array(buf) };
    } catch (_) {
      return { metodo: 0, dados: bytes };
    }
  }

  function escrever32(v) {
    return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  }
  function escrever16(v) {
    return [v & 0xff, (v >>> 8) & 0xff];
  }

  async function zipar(arquivos) {
    const codificador = new TextEncoder();
    const locais = [];
    const central = [];
    let posicao = 0;

    for (const arq of arquivos) {
      const nome = codificador.encode(arq.nome);
      const cru = codificador.encode(arq.texto);
      const { metodo, dados } = await comprimir(cru);
      const soma = crc32(cru);

      const cabecalho = [].concat(
        escrever32(0x04034b50), escrever16(20), escrever16(0), escrever16(metodo),
        escrever16(0), escrever16(0),                    // hora e data fixas
        escrever32(soma), escrever32(dados.length), escrever32(cru.length),
        escrever16(nome.length), escrever16(0)
      );
      locais.push(new Uint8Array(cabecalho), nome, dados);

      central.push(new Uint8Array([].concat(
        escrever32(0x02014b50), escrever16(20), escrever16(20), escrever16(0), escrever16(metodo),
        escrever16(0), escrever16(0),
        escrever32(soma), escrever32(dados.length), escrever32(cru.length),
        escrever16(nome.length), escrever16(0), escrever16(0),
        escrever16(0), escrever16(0), escrever32(0), escrever32(posicao)
      )), nome);

      posicao += cabecalho.length + nome.length + dados.length;
    }

    const tamanhoCentral = central.reduce((s, p) => s + p.length, 0);
    const fim = new Uint8Array([].concat(
      escrever32(0x06054b50), escrever16(0), escrever16(0),
      escrever16(arquivos.length), escrever16(arquivos.length),
      escrever32(tamanhoCentral), escrever32(posicao), escrever16(0)
    ));

    const pedacos = locais.concat(central, [fim]);
    const total = pedacos.reduce((s, p) => s + p.length, 0);
    const saida = new Uint8Array(total);
    let onde = 0;
    for (const p of pedacos) { saida.set(p, onde); onde += p.length; }
    return saida;
  }

  // ---------------------------------------------
  // A planilha
  // ---------------------------------------------
  // aba       — nome da guia
  // cabecalho — array com os títulos
  // linhas    — array de arrays, na mesma ordem do cabeçalho
  // tipos     — "texto" ou "numero" para cada coluna
  // larguras  — opcional
  async function montar({ aba, cabecalho, linhas, tipos, larguras }) {
    return zipar([
      { nome: "[Content_Types].xml", texto: CONTEUDO },
      { nome: "_rels/.rels", texto: RAIZ_RELS },
      { nome: "xl/workbook.xml", texto: livro(aba) },
      { nome: "xl/_rels/workbook.xml.rels", texto: LIVRO_RELS },
      { nome: "xl/styles.xml", texto: ESTILOS },
      { nome: "xl/worksheets/sheet1.xml", texto: folha(cabecalho, linhas, tipos, larguras) },
    ]);
  }

  return { montar, TEXTO, NUMERO };
})();

// Deixa o Node (e o Deno) importarem o mesmo arquivo nos testes, sem
// atrapalhar o navegador, que só usa a variável global acima.
if (typeof module !== "undefined" && module.exports) module.exports = PLANILHA;
