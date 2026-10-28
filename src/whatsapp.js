// Camada do WhatsApp. Versão gratuita: só monta o link oficial wa.me com o texto pronto;
// quem envia é o operador, no próprio WhatsApp. Para usar a API oficial da Meta no futuro,
// troca-se este arquivo; as regras comerciais (src/mensagens.js, src/campanhas.js) não mudam.

import { normalizarTelefone } from "./telefone.js";

export const MODO = "link"; // "link" (wa.me, gratuito) | "api" (Meta, versão paga, não implementada)

// { ok: true, link } ou { ok: false, erro } — recusa antes de montar qualquer link
export function montarLinkWhatsApp(telefone, texto) {
  const tel = normalizarTelefone(telefone);
  if (!tel.ok) return { ok: false, erro: tel.erro };
  if (!tel.numero) return { ok: false, erro: "Este contratante não tem telefone. Cadastre o WhatsApp antes." };
  const t = String(texto ?? "").trim();
  if (!t) return { ok: false, erro: "A mensagem está vazia." };
  if (/\{\{|\}\}/.test(t)) return { ok: false, erro: "A mensagem ainda tem variável sem preencher, entre {{ }}." };
  return { ok: true, numero: tel.numero, link: `https://wa.me/${tel.numero}?text=${encodeURIComponent(t)}` };
}
