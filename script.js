// Função para criar um nó da árvore
function createTreeNode(label, children = [], level = 0) {
  const node = document.createElement("div");
  node.classList.add("tree-node");

  const toggle = document.createElement("span");
  toggle.classList.add("toggle");
  toggle.addEventListener("click", () => {
    node.classList.toggle("expanded");
  });

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      displayCheckedContent(node, label, level);
    } else {
      removeUncheckedContent(node, label, level);
    }
  });

  const textLabel = document.createElement("label");
  textLabel.textContent = label;

  const childrenContainer = document.createElement("div");
  childrenContainer.classList.add("tree-children");

  children.forEach((child) => {
    childrenContainer.appendChild(
      createTreeNode(child.label, child.children, level + 1)
    );
  });

  node.appendChild(toggle);
  node.appendChild(checkbox);
  node.appendChild(textLabel);
  node.appendChild(childrenContainer);

  return node;
}

// Função para construir a árvore a partir dos dados
function buildTree(data) {
  const tree = [];

  data.forEach((item) => {
    let currentLevel = tree;

    for (let i = 6; i <= 13; i++) {
      // Níveis 0 a 7
      const levelName = item[`Nível ${i - 6}`];
      if (!levelName) break;

      let existingNode = currentLevel.find((node) => node.label === levelName);
      if (!existingNode) {
        existingNode = { label: levelName, children: [] };
        currentLevel.push(existingNode);
      }

      currentLevel = existingNode.children;
    }
  });

  return tree;
}

// Função para renderizar a árvore no DOM
function renderTree(treeData, container) {
  treeData.forEach((nodeData) => {
    const treeNode = createTreeNode(nodeData.label, nodeData.children);
    container.appendChild(treeNode);
  });
}

// Função para exibir os produtos do nível marcado com toda a linha do CSV
function displayCheckedContent(node, label, level) {
  const contentContainer = document.getElementById("content-display");

  // Adicionar as linhas completas do nível marcado
  const rows = window.treeDataRows.filter(
    (row) => row[`Nível ${level}`] === label
  );
  rows.forEach((row) => {
    // Identificador único agora inclui também o CODACESSO
    const rowId = `${row.SEQPRODUTO}-${row.CODACESSO}-${level}`;
    if (!document.getElementById(rowId)) {
      const rowContent = document.createElement("div");
      rowContent.id = rowId;
      rowContent.textContent = `${row.SEQPRODUTO};${row.DESCCOMPLETA};${row.CODACESSO};${row.EMB};${row.QTDEMBALAGEM};${row.Coluna9}`;
      rowContent.classList.add("row-content");
      contentContainer.appendChild(rowContent);
    }
  });

  const children = node.querySelectorAll(".tree-children > .tree-node");
  children.forEach((child) => {
    const childCheckbox = child.querySelector("input[type='checkbox']");
    const childLabel = child.querySelector("label").textContent;
    if (childCheckbox.checked) {
      displayCheckedContent(child, childLabel, level + 1);
    }
  });
}

// Função para remover os produtos do nível desmarcado de forma otimizada
function removeUncheckedContent(node, label, level) {
  const rows = window.treeDataRows.filter(
    (row) => row[`Nível ${level}`] === label
  );
  rows.forEach((row) => {
    // Identificador único agora inclui também o CODACESSO
    const rowId = `${row.SEQPRODUTO}-${row.CODACESSO}-${level}`;
    const rowElement = document.getElementById(rowId);
    if (rowElement) {
      rowElement.remove();
    }
  });
}

// Ajustar a inicialização para incluir as colunas adicionais do CSV
async function initializeTree() {
  try {
    const response = await fetch("FORAMATAÇÃO EANS.csv");
    if (!response.ok) {
      throw new Error(
        `Erro ao carregar o arquivo CSV: ${response.status} ${response.statusText}`
      );
    }

    const csvText = await response.text();

    const rows = csvText.split("\n").slice(1); // Ignorar cabeçalho

    const data = rows
      .filter((row) => row.trim() !== "") // Ignorar linhas vazias
      .map((row, index) => {
        const columns = row.split(";");
        if (columns.length < 14) {
          console.warn(`Linha ${index + 1} incompleta ou inválida:`, row);
        }
        return {
          SEQPRODUTO: columns[0]?.trim(),
          DESCCOMPLETA: columns[1]?.trim(),
          CODACESSO: columns[2]?.trim(),
          EMB: columns[3]?.trim(),
          QTDEMBALAGEM: columns[4]?.trim(),
          Coluna9: columns[5]?.trim(),
          "Nível 0": columns[6]?.trim(),
          "Nível 1": columns[7]?.trim(),
          "Nível 2": columns[8]?.trim(),
          "Nível 3": columns[9]?.trim(),
          "Nível 4": columns[10]?.trim(),
          "Nível 5": columns[11]?.trim(),
          "Nível 6": columns[12]?.trim(),
          "Nível 7": columns[13]?.trim(),
        };
      });

    window.treeDataRows = data; // Armazenar os dados globalmente

    const treeData = buildTree(data);

    const container = document.getElementById("tree-container");
    if (!container) {
      throw new Error("Elemento tree-container não encontrado no DOM");
    }

    renderTree(treeData, container);
  } catch (error) {
    console.error("Erro ao inicializar a árvore:", error);
  }
}

// Função para inicializar o IndexedDB
function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("LoteDB", 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("lotes")) {
        db.createObjectStore("lotes", { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

// Função para salvar o lote no IndexedDB
async function salvarLote(produtos) {
  const db = await initIndexedDB();
  const transaction = db.transaction("lotes", "readwrite");
  const store = transaction.objectStore("lotes");
  store.add({ produtos });

  transaction.oncomplete = () => {
    window.location.href = "contagens.html"; // Redirecionar para a página de contagens
  };

  transaction.onerror = (event) => {
    console.error("Erro ao salvar o lote:", event.target.error);
  };
}

// Inicializar IndexedDB para contagens
function initIndexedDBContagens() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("contagensDeEstoqueDB", 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("contagensDeEstoque")) {
        db.createObjectStore("contagensDeEstoque", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

// Função para salvar contagens no IndexedDB
async function salvarContagem(contagem) {
  const db = await initIndexedDBContagens();
  const transaction = db.transaction("contagensDeEstoque", "readwrite");
  const store = transaction.objectStore("contagensDeEstoque");

  // Verificar se já existe uma contagem para o mesmo código, corredor, coluna, andar E tipoContagem
  const getAllRequest = store.getAll();
  getAllRequest.onsuccess = function () {
    const todasContagens = getAllRequest.result;
    const existente = todasContagens.find(
      (item) =>
        item.codigo === contagem.codigo &&
        item.corredor === contagem.corredor &&
        item.coluna === contagem.coluna &&
        item.andar === contagem.andar &&
        item.tipoContagem === contagem.tipoContagem
    );
    if (existente) {
      // Atualizar a quantidade existente
      const novaQuantidade =
        (parseFloat(existente.quantidade) || 0) +
        (parseFloat(contagem.quantidade) || 0);
      existente.quantidade = novaQuantidade;
      // Atualizar o registro existente
      const updateRequest = store.put(existente);
      updateRequest.onsuccess = function () {
        console.log("Contagem atualizada com sucesso.");
      };
      updateRequest.onerror = function (event) {
        console.error("Erro ao atualizar a contagem:", event.target.error);
      };
    } else {
      // Adicionar nova contagem
      store.add(contagem);
    }
  };
  getAllRequest.onerror = function (event) {
    console.error("Erro ao buscar contagens:", event.target.error);
  };
}

// Ajustar a lógica de busca para verificar tanto o nome quanto o código
async function buscarProduto(termo) {
  const db = await initIndexedDB();
  const transaction = db.transaction("lotes", "readonly");
  const store = transaction.objectStore("lotes");
  const request = store.getAll();

  request.onsuccess = async (event) => {
    const lotes = event.target.result;
    const resultado = document.getElementById("resultado");
    resultado.innerHTML = "";

    const termoLower = termo.toLowerCase();
    const palavrasBusca = termoLower.split(/\s+/).filter(Boolean);
    const produtosEncontrados = [];
    let encontrouPorCodigo = false;
    let codAcessoEncontrado = null;

    lotes.forEach((lote) => {
      lote.produtos.forEach((produto) => {
        // Corrigir: produto pode ser uma linha CSV completa
        const campos = produto
          .split(";")
          .map((c) => c.trim().replace(/^['"]+|['"]+$/g, ""));
        const codigo = campos[0] || "";
        const nome = campos[1] || "";
        const codAcesso = campos[2] || "";

        // Busca exata pelo código de barras (CODACESSO), ignorando apóstrofos, aspas e espaços
        if (termo.match(/^\d+$/)) {
          if (codAcesso.replace(/[^\d]/g, "") === termo.replace(/[^\d]/g, "")) {
            produtosEncontrados.push(produto);
            encontrouPorCodigo = true;
            codAcessoEncontrado = codAcesso;
          }
        } else {
          // Busca pela sequência das palavras na ordem digitada
          const nomeLower = nome.toLowerCase();
          // Monta uma expressão regular para as palavras na ordem, permitindo qualquer coisa entre elas
          const regexSeq = new RegExp(
            palavrasBusca
              .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join(".*"),
            "i"
          );
          if (regexSeq.test(nomeLower)) {
            produtosEncontrados.push(produto);
          }
        }
      });
    });

    if (produtosEncontrados.length > 0) {
      // Se for busca por código, já exibe normalmente
      if (encontrouPorCodigo) {
        produtosEncontrados.forEach((produto) => {
          // produto é uma string CSV, igual ao caso da busca por nome
          const campos = produto.split(";").map((c) => c.trim());
          const codigo = campos[0] || "";
          const nome = campos[1] || "";
          const codAcesso = campos[2] || "";
          const emb1 = campos[5] || ""; // Coluna 9 (EMB. 1)
          // Cria o cartão estilizado
          const produtoDiv = document.createElement("div");
          produtoDiv.className = "produto-encontrado";
          produtoDiv.title = "Produto encontrado";
          // Header compacto
          const headerDiv = document.createElement("div");
          headerDiv.className = "produto-header";
          const spanCodigo = document.createElement("span");
          spanCodigo.className = "produto-codigo";
          spanCodigo.textContent = codigo;
          const spanEmb1 = document.createElement("span");
          spanEmb1.className = "produto-emb1";
          spanEmb1.textContent = emb1;
          const spanCodAcesso = document.createElement("span");
          spanCodAcesso.className = "produto-codacesso";
          spanCodAcesso.textContent = codAcesso;
          headerDiv.appendChild(spanCodigo);
          headerDiv.appendChild(spanEmb1);
          headerDiv.appendChild(spanCodAcesso);
          // Nome em linha separada
          const spanNome = document.createElement("span");
          spanNome.className = "produto-nome";
          spanNome.textContent = nome;
          produtoDiv.appendChild(headerDiv);
          produtoDiv.appendChild(spanNome);
          resultado.appendChild(produtoDiv);
        });

        // Buscar quantidade salva no banco para este código/corredor/coluna/andar e tipoContagem
        const quantidadeInput = document.getElementById("quantidade");
        const codigoInput = document.getElementById("codigo");
        const corredorElement = document.getElementById("corredor");
        const colunaElement = document.getElementById("coluna");
        const andarElement = document.getElementById("andar");
        const tipoContagemRadio = document.querySelector(
          'input[name="tipo-contagem"]:checked'
        );
        const tipoContagem = tipoContagemRadio
          ? tipoContagemRadio.value.toUpperCase()
          : "";
        const corredor = corredorElement
          ? corredorElement.value.trim().toUpperCase()
          : "";
        const coluna = colunaElement
          ? colunaElement.value.trim().toUpperCase()
          : "";
        const andar = andarElement
          ? andarElement.value.trim().toUpperCase()
          : "";

        // Buscar no banco de contagens
        const dbCont = await initIndexedDBContagens();
        const transCont = dbCont.transaction("contagensDeEstoque", "readonly");
        const storeCont = transCont.objectStore("contagensDeEstoque");
        const getAllCont = storeCont.getAll();
        getAllCont.onsuccess = function () {
          const todasContagens = getAllCont.result;
          // Procurar por código de barras, corredor, coluna, andar e tipoContagem
          const contagemExistente = todasContagens.find(
            (item) =>
              item.codigo &&
              codAcessoEncontrado &&
              item.codigo.replace(/[^\d]/g, "") ===
                codAcessoEncontrado.replace(/[^\d]/g, "") &&
              item.corredor === corredor &&
              item.coluna === coluna &&
              item.andar === andar &&
              (item.tipoContagem || "").toUpperCase() === tipoContagem
          );
          if (contagemExistente && quantidadeInput) {
            quantidadeInput.value = contagemExistente.quantidade;
            quantidadeInput.focus();
            quantidadeInput.select();
          } else if (quantidadeInput) {
            quantidadeInput.value = "";
            quantidadeInput.focus();
            quantidadeInput.select();
          }
        };
        getAllCont.onerror = function (event) {
          if (quantidadeInput) {
            quantidadeInput.focus();
            quantidadeInput.select();
          }
        };
      } else {
        // Busca por nome: usuário deve clicar em um item para selecionar
        produtosEncontrados.forEach((produto) => {
          const campos = produto.split(";").map((c) => c.trim());
          const codigo = campos[0] || "";
          const nome = campos[1] || "";
          const codAcesso = campos[2] || "";
          const emb1 = campos[5] || ""; // Coluna 9 (EMB. 1)
          // Cria o cartão estilizado
          const produtoDiv = document.createElement("div");
          produtoDiv.className = "produto-encontrado";
          produtoDiv.title = "Clique para selecionar este produto";
          // Header compacto
          const headerDiv = document.createElement("div");
          headerDiv.className = "produto-header";
          const spanCodigo = document.createElement("span");
          spanCodigo.className = "produto-codigo";
          spanCodigo.textContent = codigo;
          const spanEmb1 = document.createElement("span");
          spanEmb1.className = "produto-emb1";
          spanEmb1.textContent = emb1;
          const spanCodAcesso = document.createElement("span");
          spanCodAcesso.className = "produto-codacesso";
          spanCodAcesso.textContent = codAcesso;
          headerDiv.appendChild(spanCodigo);
          headerDiv.appendChild(spanEmb1);
          headerDiv.appendChild(spanCodAcesso);
          // Nome em linha separada
          const spanNome = document.createElement("span");
          spanNome.className = "produto-nome";
          spanNome.textContent = nome;
          produtoDiv.appendChild(headerDiv);
          produtoDiv.appendChild(spanNome);
          produtoDiv.addEventListener("click", () => {
            // Ao clicar, preenche o campo de código com o CODACESSO e refaz a busca
            const codigoInput = document.getElementById("codigo");
            if (codigoInput) {
              codigoInput.value = codAcesso;
              buscarProduto(codAcesso);
            }
          });
          resultado.appendChild(produtoDiv);
        });
        // Limpa o campo de quantidade para impedir salvar sem seleção
        const quantidadeInput = document.getElementById("quantidade");
        if (quantidadeInput) quantidadeInput.value = "";
      }
    } else {
      const mensagem = document.createElement("div");
      mensagem.textContent = "Nenhum produto encontrado.";
      resultado.appendChild(mensagem);
    }
  };

  request.onerror = (event) => {
    console.error("Erro ao buscar produto:", event.target.error);
  };
}

// Adicionar evento para buscar produto na página de contagens
if (window.location.pathname.includes("contagens.html")) {
  document.getElementById("codigo").addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      const termo = event.target.value;
      buscarProduto(termo);
    }
  });
}

// Consolidar eventos DOMContentLoaded
window.addEventListener("DOMContentLoaded", () => {
  // Inicializar a árvore
  initializeTree();

  // Adicionar evento ao botão "Criar Lote"
  const criarLoteButton = document.getElementById("criar-lote");
  if (criarLoteButton) {
    criarLoteButton.addEventListener("click", () => {
      const produtosSelecionados = [];

      // Coletar produtos selecionados
      document.querySelectorAll(".row-content").forEach((row) => {
        produtosSelecionados.push(row.textContent);
      });

      salvarLote(produtosSelecionados);
    });
  }

  // Adicionar um contêiner para exibir o conteúdo
  const contentDisplay = document.createElement("div");
  contentDisplay.id = "content-display";
  contentDisplay.classList.add("content-display");
  document.body.appendChild(contentDisplay);

  // Adicionar evento ao campo de quantidade
  if (window.location.pathname.includes("contagens.html")) {
    const quantidadeInput = document.getElementById("quantidade");
    const codigoInput = document.getElementById("codigo");

    if (quantidadeInput && codigoInput) {
      window.bloqueiaValidacaoCorredor = false;

      // Elemento para exibir o último item contado
      let ultimoItemDiv = document.getElementById("ultimo-item-contado");
      if (!ultimoItemDiv) {
        ultimoItemDiv = document.createElement("div");
        ultimoItemDiv.id = "ultimo-item-contado";
        ultimoItemDiv.style.marginTop = "12px";
        quantidadeInput.parentNode.insertBefore(
          ultimoItemDiv,
          quantidadeInput.nextSibling
        );
      }

      // Função para buscar produto pelo código digitado
      async function buscarProdutoPorCodigo(codigo) {
        const db = await initIndexedDB();
        const transaction = db.transaction("lotes", "readonly");
        const store = transaction.objectStore("lotes");
        const request = store.getAll();
        return new Promise((resolve) => {
          request.onsuccess = (event) => {
            const lotes = event.target.result;
            let encontrado = null;
            lotes.forEach((lote) => {
              lote.produtos.forEach((produto) => {
                // produto é string CSV
                const campos = produto.split(";").map((c) => c.trim());
                const seqProduto = (campos[0] || "").toLowerCase();
                const codAcesso = (campos[2] || "").toLowerCase();
                if (codAcesso === codigo.toLowerCase() || seqProduto === codigo.toLowerCase()) {
                  encontrado = {
                    SEQPRODUTO: campos[0] || "",
                    DESCCOMPLETA: campos[1] || "",
                    CODACESSO: campos[2] || "",
                    EMB: campos[3] || "",
                    QTDEMBALAGEM: campos[4] || "",
                    Coluna9: campos[5] || ""
                  };
                }
              });
            });
            resolve(encontrado);
          };
          request.onerror = () => resolve(null);
        });
      }

      // Função para exibir o último produto contado de forma estilizada
      function exibirUltimoProdutoContado(produto, quantidade) {
  ultimoItemDiv.innerHTML = "";
  if (!produto) return;
  const div = document.createElement("div");
  div.className = "produto-encontrado produto-ultimo-contado";
  const header = document.createElement("div");
  header.className = "produto-header";
  const codigo = document.createElement("span");
  codigo.className = "produto-codigo";
  codigo.textContent = produto.SEQPRODUTO || "";
  // Exibir EMB. 1 (Coluna9)
  const emb1 = document.createElement("span");
  emb1.className = "produto-emb1";
  emb1.textContent = produto.Coluna9 || "";
  const codAcesso = document.createElement("span");
  codAcesso.className = "produto-codacesso";
  codAcesso.textContent = produto.CODACESSO || "";
  header.appendChild(codigo);
  if (produto.Coluna9) header.appendChild(emb1);
  if (produto.CODACESSO) header.appendChild(codAcesso);
  const nome = document.createElement("div");
  nome.className = "produto-nome";
  nome.textContent = produto.DESCCOMPLETA || "";
  const qtd = document.createElement("div");
  qtd.style.fontWeight = "bold";
  qtd.style.color = "#05b814";
  qtd.style.marginTop = "4px";
  qtd.textContent = `Quantidade: ${quantidade}`;
  div.appendChild(header);
  div.appendChild(nome);
  div.appendChild(qtd);
  ultimoItemDiv.appendChild(div);
      }

      // Função para tratar mudança de quantidade
      const handleQuantidadeChange = async (event) => {
        if (window.bloqueiaValidacaoCorredor) return;
        let quantidadeStr = quantidadeInput.value;
        if (quantidadeStr == null) quantidadeStr = "";
        quantidadeStr = quantidadeStr.replace(/\s+/g, "");
        if (quantidadeStr === "") {
          alert("O campo Quantidade não pode ser vazio.");
          quantidadeInput.focus();
          return;
        }
        const quantidade = parseFloat(quantidadeStr);
        const codigo = codigoInput ? codigoInput.value : "";
        // Verifica se o código é um código de barras válido (só números e tamanho típico de EAN)
        if (!codigo.match(/^\d{8,14}$/)) {
          alert("Selecione um produto da lista antes de salvar a contagem!");
          codigoInput.focus();
          return;
        }
        const colunaElement = document.getElementById("coluna");
        const coluna = colunaElement ? colunaElement.value.trim() : "";
        const andarElement = document.getElementById("andar");
        const andar = andarElement ? andarElement.value.trim() : "";

        // Buscar o produto para exibir estilizado
        const produto = await buscarProdutoPorCodigo(codigo);
        exibirUltimoProdutoContado(produto, quantidade);

        const contagem = {
          tipoContagem: (
            document.querySelector('input[name="tipo-contagem"]:checked')
              ?.value || ""
          ).toUpperCase(),
          corredor: (
            document.getElementById("corredor")?.value || ""
          ).toUpperCase(),
          coluna: (coluna || "").toUpperCase(),
          andar: (andar || "").toUpperCase(),
          codigo: (codigo || "").toUpperCase(),
          quantidade: (quantidade || "").toString().toUpperCase(),
          descricao: (produto && produto.DESCCOMPLETA ? produto.DESCCOMPLETA : "").toUpperCase(),
        };

        await salvarContagem(contagem);

        // Limpar campos e focar no código
        quantidadeInput.value = "";
        if (codigoInput) {
          codigoInput.value = "";
          codigoInput.focus();
        }

        if (resultado) resultado.innerHTML = "";
      };

      // Remover listeners antigos antes de adicionar
      quantidadeInput.oninput = null;
      quantidadeInput.onkeypress = null;
      quantidadeInput.removeEventListener("input", handleQuantidadeChange);
      quantidadeInput.removeEventListener("keypress", handleQuantidadeChange);

      // Adicionar listeners
      quantidadeInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleQuantidadeChange(event);
        }
      });
    }
  }

  // Botão de exportação de contagens
  const exportarBtn = document.getElementById("exportar-contagens");
  if (exportarBtn) {
    exportarBtn.addEventListener("click", async () => {
      let usuario = (
        localStorage.getItem("usuario") || "USUARIO"
      ).toUpperCase();
      let loja = (localStorage.getItem("loja") || "LOJA").toUpperCase();
      if (!usuario)
        usuario = (
          prompt("Digite o nome do usuário para o arquivo:") || "USUARIO"
        ).toUpperCase();
      if (!loja)
        loja = (
          prompt("Digite a loja para o arquivo:") || "LOJA"
        ).toUpperCase();

      // Capturar o valor do LOCAL (opção radio selecionada na tela de contagens)
      let local = "";
      const localRadio = document.querySelector(
        'input[name="tipo-contagem"]:checked'
      );
      if (localRadio) {
        // Exibir como LOJA ou DEPOSITO, sempre em maiúsculo
        local = localRadio.value.toUpperCase();
      } else {
        local = "LOCAL";
      }

      const db = await initIndexedDBContagens();
      const transaction = db.transaction("contagensDeEstoque", "readonly");
      const store = transaction.objectStore("contagensDeEstoque");
      const getAllRequest = store.getAll();
      getAllRequest.onsuccess = function () {
        const todasContagens = getAllRequest.result;
        // Cabeçalho solicitado
        let txt =
          "USUARIO;LOCAL;CORREDOR;COLUNA;ANDAR;EAN;SISTEMA;DESCRIÇÃO;EMBALAGEM;CONTAGEM\n";
        todasContagens.forEach((item) => {
          let sistema = "";
          let descricao = "";
          let embalagem = "";
          if (item.descricao) {
            const partes = item.descricao.split(";");
            sistema = (partes[0] || "").toUpperCase();
            descricao = (partes[1] || "").toUpperCase();
            embalagem = (partes[2] || "").toUpperCase();
          }
          // Usar o tipoContagem salvo como LOCAL
          txt +=
            [
              usuario,
              (item.tipoContagem || "").toUpperCase(),
              (item.corredor || "").toUpperCase(),
              (item.coluna || "").toUpperCase(),
              (item.andar || "").toUpperCase(),
              (item.codigo || "").toUpperCase(),
              sistema,
              descricao,
              embalagem,
              (item.quantidade || "").toString().toUpperCase(),
            ].join(";") + "\n";
        });
        const data = new Date();
        const dia = String(data.getDate()).padStart(2, "0");
        const mes = String(data.getMonth() + 1).padStart(2, "0");
        const ano = data.getFullYear();
        const nomeArquivo = `${usuario}_${loja}_${dia}-${mes}-${ano}.txt`;
        const blob = new Blob([txt], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      };
      getAllRequest.onerror = function (event) {
        alert("Erro ao exportar contagens: " + event.target.error);
      };
    });
  }
});
