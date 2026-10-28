// Telefone no formato do WhatsApp: 55 + DDD + número, só dígitos (ex.: 5531992233295).
// Aceita o que as pessoas digitam: "(31) 99223-3295", "031 99223 3295", "+55 31 9 9223-3295".

// DDDs em uso no Brasil
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

// { ok: true, numero } ou { ok: false, erro } (telefone vazio dá ok com numero "")
export function normalizarTelefone(entrada) {
  const bruto = String(entrada ?? "").trim();
  if (!bruto) return { ok: true, numero: "" };
  let d = bruto.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2); // discagem internacional
  else if (d.startsWith("0")) {
    d = d.slice(1); // 0 + DDD, ou 0 + operadora + DDD
    if ((d.length === 12 || d.length === 13) && !d.startsWith("55")) d = d.slice(2);
  }
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (!d.startsWith("55") || (d.length !== 12 && d.length !== 13)) {
    return { ok: false, erro: "Telefone incompleto ou de fora do Brasil. Use DDD + número, como (31) 99223-3295." };
  }
  const ddd = Number(d.slice(2, 4));
  if (!DDDS.has(ddd)) return { ok: false, erro: `O DDD ${d.slice(2, 4)} não existe. Confira o telefone.` };
  const n = d.slice(4);
  if (n.length === 9 && n[0] !== "9") return { ok: false, erro: "Celular com 9 dígitos precisa começar com 9. Confira o telefone." };
  if (n.length === 8 && n[0] < "2") return { ok: false, erro: "Telefone inválido. Confira o número." };
  return { ok: true, numero: d };
}

// para mostrar: 5531992233295 -> (31) 99223-3295
export function formatarTelefone(numero) {
  const d = String(numero || "");
  if (!/^55\d{10,11}$/.test(d)) return d;
  const n = d.slice(4);
  return `(${d.slice(2, 4)}) ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
}
