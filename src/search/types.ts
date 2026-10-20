// Types for AI Vault Search engine

export interface SearchMatch {
  caminho: string;
  nome: string;
  tags?: string[];
  up?: string[];
  modificada?: string;
  pontos?: number;
  linha?: number;
  trecho?: string;
  secao_titulo?: string;
  secao_linha?: number;
  secao_trecho?: string;
  skill?: boolean;
  efeito?: string;
  tipo?: "nota" | "pasta" | "arquivo";
  total_arquivos?: number;
  total_subpastas?: number;
  tamanho_bytes?: number;
  extensao?: string;
  conteudo?: string;
  cabecalhos_disponiveis?: { nivel: number; titulo: string; linha: number }[];
}

export interface SearchQueryParams {
  acao?: "buscar" | "listar_pastas" | "listar_arquivos" | "obter_secao" | "status";
  pasta?: string;
  extensao?: string;
  recursivo?: boolean;
  cabecalho?: string;
  termos?: string[];
  tag?: string;
  filhas?: string;
  arvore?: string;
  profundidade?: number;
  backlinks?: string;
  links?: string;
  prop?: string;
  nota?: string;
  recentes?: number;
  limite?: number;
  modo?: "hibrido" | "exato" | "semantico";
  secao?: boolean;
}

export interface SearchResultPayload {
  consulta: Record<string, unknown>;
  total: number;
  resultados: SearchMatch[];
  dicas?: string[];
  tempo_ms?: number;
  estatisticas?: Record<string, unknown>;
}
