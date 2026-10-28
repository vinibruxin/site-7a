// Leitura de planilha CSV (Excel em português usa ponto e vírgula; Google Planilhas, vírgula).

// texto -> linhas (listas de células); aceita aspas, aspas dobradas e quebra de linha dentro de aspas
export function lerCSV(texto) {
  const t = String(texto ?? "").replace(/^﻿/, "");
  const sep = separador(t);
  const linhas = [];
  let linha = [], cel = "", aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') { cel += '"'; i++; }
      else if (ch === '"') aspas = false;
      else cel += ch;
    } else if (ch === '"' && cel === "") aspas = true;
    else if (ch === sep) { linha.push(cel); cel = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(cel); cel = "";
      if (linha.some((c) => c.trim())) linhas.push(linha);
      linha = [];
    } else cel += ch;
  }
  linha.push(cel);
  if (linha.some((c) => c.trim())) linhas.push(linha);
  return linhas;
}

// o separador mais comum na primeira linha, fora das aspas
function separador(t) {
  const primeira = t.split(/\r?\n/, 1)[0] || "";
  let fora = "", aspas = false;
  for (const ch of primeira) {
    if (ch === '"') aspas = !aspas;
    else if (!aspas) fora += ch;
  }
  const conta = (c) => fora.split(c).length - 1;
  return [";", ",", "\t"].sort((a, b) => conta(b) - conta(a))[0];
}

export const chaveTexto = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// nomes de coluna aceitos para cada campo
const COLUNAS = {
  nome: ["nome", "estabelecimento", "nomedoestabelecimento", "casa", "nomedacasa", "contratante", "empresa", "local"],
  contato: ["contato", "responsavel", "nomedoresponsavel", "pessoadecontato", "pessoa", "nomedocontato"],
  telefone: ["telefone", "whatsapp", "celular", "fone", "tel", "telefoneouwhatsapp", "zap"],
  email: ["email", "correioeletronico"],
  cidade: ["cidade", "municipio"],
  uf: ["uf", "estado"],
  tipo: ["tipo", "categoria"],
  perfil: ["perfil", "perfilmusical", "estilo", "estilos", "estilomusical", "estilosmusicais"],
  instagram: ["instagram", "insta"],
  obs: ["obs", "observacoes", "observacao", "notas"],
};

// cabeçalho -> { campo: índice da coluna }
export function mapearColunas(cabecalho) {
  const mapa = {};
  cabecalho.forEach((h, i) => {
    const k = chaveTexto(h);
    for (const [campo, nomes] of Object.entries(COLUNAS)) if (!(campo in mapa) && nomes.includes(k)) mapa[campo] = i;
  });
  return mapa;
}

export function tipoDoTexto(s) {
  const k = chaveTexto(s);
  if (!k) return "casa";
  if (["casa", "bar", "casadeshow", "casadeshows", "baroucasadeshow", "pub", "boteco"].includes(k)) return "casa";
  if (k.startsWith("restaurante")) return "restaurante";
  if (k.startsWith("festival")) return "festival";
  if (k.startsWith("evento")) return "evento";
  if (k.startsWith("empresa") || k === "eventodeempresa" || k === "corporativo") return "empresa";
  if (k.includes("particular") || k.startsWith("festa") || k.includes("casamento") || k.includes("aniversario")) return "particular";
  return "outro";
}

export function perfilDoTexto(s) {
  const k = chaveTexto(s);
  if (!k) return "";
  if (k.includes("ambos") || (k.includes("autoral") && k.includes("classic"))) return "ambos";
  if (k.includes("autoral")) return "autoral";
  if (k.includes("classic") || k.includes("cover")) return "classicos";
  return "";
}
