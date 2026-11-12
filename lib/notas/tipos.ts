import type { Moeda } from "@/lib/carteira";

export type OperacaoNota = {
  /** Identificador estável da linha (evita importar duas vezes). */
  origem: string;
  ticker: string;
  nome: string;
  tipo: "compra" | "venda";
  /** Data do pregão, AAAA-MM-DD */
  data: string;
  quantidade: number;
  /** Preço unitário de execução, na moeda da nota */
  preco: number;
  /** Corretagem + taxas, na moeda da nota */
  taxas: number;
  /** Valor líquido da operação, na moeda da nota */
  liquido: number;
};

export type NotaLida = {
  formato: string;
  corretora: string;
  moeda: Moeda;
  operacoes: OperacaoNota[];
  avisos: string[];
};

export type CodigoErroNota = "senha" | "senha_errada" | "formato" | "vazio" | "pdf";
export class NotaErro extends Error {
  codigo: CodigoErroNota;
  constructor(message: string, codigo: CodigoErroNota) {
    super(message);
    this.codigo = codigo;
  }
}
