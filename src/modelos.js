// Modelos de mensagem: variáveis {{nome}} e valor reserva {{nome|reserva}}.
// Funções puras, usadas pelo servidor e repetidas no painel só para a prévia.

export const VARIAVEIS = {
  primeiro_nome: "Primeiro nome da pessoa de contato",
  nome_contato: "Nome completo da pessoa de contato",
  casa: "Nome do estabelecimento",
  cidade: "Cidade",
  site: "Endereço do site da 7A",
};
export const SITE = "https://7aprodutora.com.br";
export const LIMITE_TEXTO = 1500;

// confere um texto de modelo; devolve a lista de erros (vazia quando está tudo certo)
export function validarModelo(texto) {
  const t = String(texto ?? "");
  const erros = [];
  if (!t.trim()) erros.push("Escreva o texto da mensagem.");
  if (t.length > LIMITE_TEXTO) erros.push(`O texto passou de ${LIMITE_TEXTO} caracteres.`);
  // percorre as chaves na ordem: cada {{ precisa fechar com }} antes da próxima {{
  let i = 0;
  while (i < t.length) {
    const abre = t.indexOf("{{", i);
    const fecha = t.indexOf("}}", i);
    if (abre === -1 && fecha === -1) break;
    if (abre === -1 || (fecha !== -1 && fecha < abre)) {
      erros.push("Tem um }} sem o {{ de abertura.");
      break;
    }
    const proxAbre = t.indexOf("{{", abre + 2);
    if (fecha === -1 || (proxAbre !== -1 && proxAbre < fecha)) {
      erros.push("Tem uma variável aberta com {{ e não fechada com }}.");
      break;
    }
    const dentro = t.slice(abre + 2, fecha);
    const [nome] = dentro.split("|");
    const chave = nome.trim();
    if (!chave) erros.push("Tem uma variável vazia: {{}}.");
    else if (!VARIAVEIS[chave]) erros.push(`Variável desconhecida: {{${chave}}}. Use ${Object.keys(VARIAVEIS).map((v) => `{{${v}}}`).join(", ")}.`);
    i = fecha + 2;
  }
  return [...new Set(erros)];
}

// valores das variáveis para um contratante
export function valoresDe(c) {
  const contato = String(c?.contato ?? "").trim();
  return {
    primeiro_nome: contato.split(/\s+/)[0] || "",
    nome_contato: contato,
    casa: String(c?.nome ?? "").trim(),
    cidade: String(c?.cidade ?? "").trim(),
    site: SITE,
  };
}

// preenche as variáveis; o que faltar sem reserva entra em "faltando" e a mensagem não pode sair
export function preencher(texto, valores) {
  const faltando = [];
  const pronto = String(texto ?? "").replace(/\{\{([^{}]*)\}\}/g, (todo, dentro) => {
    const [nome, ...resto] = dentro.split("|");
    const chave = nome.trim();
    const reserva = resto.join("|").trim();
    const v = String(valores?.[chave] ?? "").trim();
    if (v) return v;
    if (reserva) return reserva;
    faltando.push(chave);
    return todo;
  });
  return { texto: pronto.trim(), faltando: [...new Set(faltando)] };
}

const NOMES_FALTA = { primeiro_nome: "nome do contato", nome_contato: "nome do contato", casa: "nome da casa", cidade: "cidade", site: "site" };
export const descreverFalta = (faltando) => "Falta " + faltando.map((f) => NOMES_FALTA[f] || f).join(" e ") + " para preencher o texto.";
